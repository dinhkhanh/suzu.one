// Copies every stored file from Supabase Storage into the R2 bucket, once, for the move to R2
// (README, "File storage"). Safe to run again: an object R2 already holds is skipped, so a second
// run after the deployment picks up only what was uploaded in between.
//
//   pnpm storage:to-r2 --dry-run   # what would be copied
//   pnpm storage:to-r2
//
// Reads the old store with SUPABASE_URL + SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) and
// SUPABASE_STORAGE_BUCKET (default suzu-private); writes with the app's own R2 variables. Every
// object gets its file's download name as it lands (R2 cannot be told one when a link is made).
// Rejected uploads are left behind: nothing ever reads them.
import { AwsClient } from "aws4fetch";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local" });

const dryRun = process.argv.includes("--dry-run");

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

const encodePath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");

function attachmentDisposition(fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

async function main() {
  const databaseUrl = required("POSTGRES_URL", process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL);
  const supabase = `${required("SUPABASE_URL", process.env.SUPABASE_URL).replace(/\/$/, "")}/storage/v1`;
  const supabaseKey = required("SUPABASE_SECRET_KEY", process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY);
  const sourceBucket = process.env.SUPABASE_STORAGE_BUCKET ?? "suzu-private";
  const targetBucket = process.env.STORAGE_BUCKET ?? "suzu-private";
  // As the app reads it (src/lib/env.ts `r2EndpointFor`): a pasted bucket URL loses its bucket.
  const endpoint = process.env.R2_ENDPOINT ? process.env.R2_ENDPOINT.replace(/\/+$/, "").replace(new RegExp(`/${targetBucket}$`), "") : `https://${required("CLOUDFLARE_ACCOUNT_ID", process.env.CLOUDFLARE_ACCOUNT_ID)}.r2.cloudflarestorage.com`;
  const r2 = new AwsClient({ accessKeyId: required("R2_ACCESS_KEY_ID", process.env.R2_ACCESS_KEY_ID), secretAccessKey: required("R2_SECRET_ACCESS_KEY", process.env.R2_SECRET_ACCESS_KEY), service: "s3", region: "auto" });
  const target = (objectPath: string) => `${endpoint.replace(/\/$/, "")}/${targetBucket}/${encodePath(objectPath)}`;

  const sql = postgres(databaseUrl, { prepare: false, max: 1 });
  const files = await sql<{ id: string; objectPath: string; fileName: string; contentType: string }[]>`
    select id, object_path as "objectPath", file_name as "fileName", content_type as "contentType"
    from stored_file where status <> 'rejected' order by created_at`;
  console.log(`${files.length} files known; copying from Supabase "${sourceBucket}" to R2 "${targetBucket}"${dryRun ? " (dry run)" : ""}.`);

  const tally = { copied: 0, present: 0, missing: 0, failed: 0 };
  for (const file of files) {
    const head = await r2.fetch(target(file.objectPath), { method: "HEAD" });
    if (head.ok) {
      tally.present++;
      continue;
    }
    const source = await fetch(`${supabase}/object/authenticated/${sourceBucket}/${encodePath(file.objectPath)}`, { headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` } });
    // A pending upload that never arrived, or bytes the retention purge already removed.
    if (source.status === 404 || source.status === 400) {
      tally.missing++;
      continue;
    }
    if (!source.ok) {
      tally.failed++;
      console.error(`  ${file.objectPath}: Supabase answered ${source.status}`);
      continue;
    }
    if (dryRun) {
      tally.copied++;
      await source.body?.cancel();
      continue;
    }
    const bytes = new Uint8Array(await source.arrayBuffer());
    const put = await r2.fetch(target(file.objectPath), { method: "PUT", headers: { "content-type": file.contentType, "content-disposition": attachmentDisposition(file.fileName) }, body: bytes });
    if (!put.ok) {
      tally.failed++;
      console.error(`  ${file.objectPath}: R2 answered ${put.status} ${(await put.text()).slice(0, 200)}`);
      continue;
    }
    tally.copied++;
    if (tally.copied % 50 === 0) console.log(`  ${tally.copied} copied…`);
  }
  if (!dryRun && targetBucket !== sourceBucket) await sql`update stored_file set bucket = ${targetBucket} where bucket = ${sourceBucket}`;
  await sql.end();
  console.log(`${dryRun ? "Would copy" : "Copied"} ${tally.copied}; already in R2 ${tally.present}; not in Supabase ${tally.missing}; failed ${tally.failed}.`);
  if (tally.failed) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
