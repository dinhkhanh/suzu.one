// Puts files back into a bucket from a backup (docs/runbooks/restore.md, "Files"):
//
//   pnpm tsx --require ./scripts/server-only-shim.cjs scripts/backup/restore-files.ts [--dry-run]
//
// Which files: every live file record (`stored_file`, ready and not purged) in RESTORE_DATABASE_URL
// — production, or a backup restored by restore-local.sh to bring files back to that day. A file
// already in the target bucket is left alone, so it repairs a partial loss and is safe to run again.
//
// From (FROM):
//   r2  (default) FILES_BACKUP_BUCKET on R2_ENDPOINT, with R2_BACKUP_KEY_ID / R2_BACKUP_SECRET:
//       current/<key>, or the newest deleted/<date>/<key> for a file production no longer has.
//   gcs GCS_BUCKET's files/<key>.age through a signed-in gcloud, decrypted with AGE_IDENTITY.
// To: TARGET_ENDPOINT (an S3 endpoint without the bucket), TARGET_BUCKET, TARGET_ACCESS_KEY_ID,
// TARGET_SECRET_ACCESS_KEY — the production bucket, or a new one if Cloudflare is gone.
//
// The backups hold bytes only. Each object is written with the headers the app gives it — its
// content type, and the download name it carries as `Content-Disposition` — from its record.
import { spawn } from "node:child_process";
import { AwsClient } from "aws4fetch";
import postgres from "postgres";
import { attachmentDisposition } from "../../src/modules/platform/files/storage";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (see the header of this script)`);
  return value;
}

type S3 = { client: AwsClient; base: string };
const s3 = (endpoint: string, bucket: string, accessKeyId: string, secretAccessKey: string): S3 => ({
  client: new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" }),
  base: `${endpoint.replace(/\/+$/, "")}/${bucket}`,
});
const objectUrl = (store: S3, key: string) => `${store.base}/${key.split("/").map(encodeURIComponent).join("/")}`;

/** Every key in a bucket under a prefix, following the pages. */
async function listKeys(store: S3, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const url = new URL(store.base);
    url.searchParams.set("list-type", "2");
    url.searchParams.set("prefix", prefix);
    if (token) url.searchParams.set("continuation-token", token);
    const response = await store.client.fetch(url);
    if (!response.ok) throw new Error(`listing ${prefix}: ${response.status}`);
    const xml = await response.text();
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.push(decodeXml(match[1]));
    token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? decodeXml(/<NextContinuationToken>([^<]*)</.exec(xml)?.[1] ?? "") : undefined;
  } while (token);
  return keys;
}
const decodeXml = (text: string) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[entity] ?? "");

/** A command's standard output, all of it; fails with its standard error. */
function run(command: string, args: string[], input?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${command} exited ${code}: ${Buffer.concat(err).toString().trim()}`))));
    child.stdin.end(input);
  });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const from = process.env.FROM ?? "r2";
  const target = s3(required("TARGET_ENDPOINT"), required("TARGET_BUCKET"), required("TARGET_ACCESS_KEY_ID"), required("TARGET_SECRET_ACCESS_KEY"));

  const sql = postgres(required("RESTORE_DATABASE_URL"), { max: 1, onnotice: () => {} });
  const records = await sql<{ objectPath: string; fileName: string; contentType: string }[]>`
    select object_path as "objectPath", file_name as "fileName", content_type as "contentType"
    from public.stored_file where status = 'ready' and purged_at is null order by object_path`;
  await sql.end();

  let fetchBytes: (key: string) => Promise<Buffer | null>;
  if (from === "r2") {
    const backup = s3(required("R2_ENDPOINT"), required("FILES_BACKUP_BUCKET"), required("R2_BACKUP_KEY_ID"), required("R2_BACKUP_SECRET"));
    // Where each key is: current/ first, otherwise the newest deleted/<date>/.
    const where = new Map<string, string>();
    for (const key of (await listKeys(backup, "deleted/")).sort()) where.set(key.replace(/^deleted\/[^/]+\//, ""), key);
    for (const key of await listKeys(backup, "current/")) where.set(key.slice("current/".length), key);
    fetchBytes = async (key) => {
      const at = where.get(key);
      if (!at) return null;
      const response = await backup.client.fetch(objectUrl(backup, at));
      if (!response.ok) throw new Error(`reading ${at}: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    };
  } else if (from === "gcs") {
    const bucket = required("GCS_BUCKET");
    const identity = required("AGE_IDENTITY");
    const listed = (await run("gcloud", ["storage", "ls", `gs://${bucket}/files/**`])).toString();
    const present = new Set(listed.split("\n").map((line) => line.replace(`gs://${bucket}/files/`, "").replace(/\.age$/, "")));
    fetchBytes = async (key) => {
      if (!present.has(key)) return null;
      const encrypted = await run("gcloud", ["storage", "cat", `gs://${bucket}/files/${key}.age`]);
      return run("age", ["-d", "-i", identity], encrypted);
    };
  } else {
    throw new Error("FROM is r2 or gcs");
  }

  let present = 0;
  let restored = 0;
  const missing: string[] = [];
  for (const record of records) {
    const head = await target.client.fetch(objectUrl(target, record.objectPath), { method: "HEAD" });
    if (head.ok) {
      present++;
      continue;
    }
    const bytes = await fetchBytes(record.objectPath);
    if (!bytes) {
      missing.push(record.objectPath);
      continue;
    }
    if (!dryRun) {
      const put = await target.client.fetch(objectUrl(target, record.objectPath), {
        method: "PUT",
        headers: { "content-type": record.contentType, "content-disposition": attachmentDisposition(record.fileName) },
        body: new Uint8Array(bytes),
      });
      if (!put.ok) throw new Error(`writing ${record.objectPath}: ${put.status} ${(await put.text()).slice(0, 200)}`);
    }
    restored++;
  }

  console.log(`${records.length} file records: ${present} already in place, ${restored} ${dryRun ? "would be restored" : "restored"}, ${missing.length} in no backup.`);
  for (const key of missing) console.log(`  not in the backup: ${key}`);
  if (missing.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
