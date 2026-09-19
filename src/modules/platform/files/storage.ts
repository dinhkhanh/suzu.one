import "server-only";
import { env } from "@/lib/env";

// A thin client for Supabase Storage's REST API: only what the files service needs, no SDK.
// The service-role key never leaves the server; browsers only ever get short-lived signed URLs.

export class StorageError extends Error {}

function config() {
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key, STORAGE_BUCKET: bucket } = env();
  if (!url || !key) throw new StorageError("storage_not_configured");
  return { base: `${url.replace(/\/$/, "")}/storage/v1`, key, bucket };
}

const encodePath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");

async function call(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { base, key } = config();
  const { json, ...rest } = init;
  return fetch(`${base}${path}`, {
    ...rest,
    headers: { apikey: key, authorization: `Bearer ${key}`, ...(json === undefined ? {} : { "content-type": "application/json" }), ...rest.headers },
    body: json === undefined ? rest.body : JSON.stringify(json),
    signal: AbortSignal.timeout(15_000),
  });
}

async function fail(response: Response, what: string): Promise<never> {
  throw new StorageError(`${what}: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

let bucketReady: Promise<void> | undefined;

/** Creates the private bucket on first use. Safe to race: "already exists" is success. */
function ensureBucket(maxFileBytes: number): Promise<void> {
  return (bucketReady ??= (async () => {
    const { bucket } = config();
    const response = await call("/bucket", { method: "POST", json: { id: bucket, name: bucket, public: false, file_size_limit: maxFileBytes } });
    if (response.ok || response.status === 409) return;
    const body = await response.text();
    if (/exist/i.test(body)) return;
    throw new StorageError(`create bucket: ${response.status} ${body.slice(0, 200)}`);
  })().catch((error) => {
    bucketReady = undefined;
    throw error;
  }));
}

/** A URL the browser can PUT one file to, once, within two hours. */
export async function createSignedUploadUrl(objectPath: string, maxFileBytes: number): Promise<string> {
  await ensureBucket(maxFileBytes);
  const { base, bucket } = config();
  const response = await call(`/object/upload/sign/${bucket}/${encodePath(objectPath)}`, { method: "POST" });
  if (!response.ok) await fail(response, "sign upload");
  const { url } = (await response.json()) as { url: string };
  return `${base}${url}`;
}

/** Size of the stored object and its first bytes, or null when nothing was uploaded. */
export async function inspectObject(objectPath: string, headBytes = 512): Promise<{ sizeBytes: number; head: Uint8Array } | null> {
  const { bucket } = config();
  const response = await call(`/object/authenticated/${bucket}/${encodePath(objectPath)}`, { headers: { range: `bytes=0-${headBytes - 1}` } });
  if (response.status === 404 || response.status === 400) return null;
  if (!response.ok) await fail(response, "inspect");
  const head = new Uint8Array(await response.arrayBuffer()).slice(0, headBytes);
  // "bytes 0-511/12345" when the range was honoured; otherwise the whole object came back.
  const total = response.headers.get("content-range")?.split("/")[1];
  const sizeBytes = total && total !== "*" ? Number(total) : Number(response.headers.get("content-length") ?? head.length);
  return { sizeBytes, head };
}

/** A link that works for `expiresInSeconds` and downloads under `fileName` instead of opening in the page. */
export async function createSignedDownloadUrl(objectPath: string, fileName: string, expiresInSeconds: number): Promise<string> {
  const { base, bucket } = config();
  const response = await call(`/object/sign/${bucket}/${encodePath(objectPath)}`, { method: "POST", json: { expiresIn: expiresInSeconds } });
  if (!response.ok) await fail(response, "sign download");
  const { signedURL } = (await response.json()) as { signedURL: string };
  return `${base}${signedURL}&download=${encodeURIComponent(fileName)}`;
}

export async function removeObject(objectPath: string): Promise<void> {
  const { bucket } = config();
  const response = await call(`/object/${bucket}/${encodePath(objectPath)}`, { method: "DELETE" });
  if (!response.ok && response.status !== 404 && response.status !== 400) await fail(response, "remove");
}

export const currentBucket = () => config().bucket;
