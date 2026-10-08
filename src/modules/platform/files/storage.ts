import "server-only";
import { AwsClient } from "aws4fetch";
import { env } from "@/lib/env";

// A thin client for Cloudflare R2 over its S3-compatible API: only what the files service needs,
// signed with SigV4 (aws4fetch, the signer Cloudflare documents for R2), no SDK. The access keys
// never leave the server; browsers only ever get short-lived presigned URLs.
//
// The bucket is private and made ahead of time (README, "File storage"), with a CORS rule that
// lets the app's origin PUT to it. Unlike Supabase Storage, R2 cannot be asked for a filename at
// download time (GetObject takes no `response-content-disposition`), so every object carries its
// own `Content-Disposition`: set on the server-side write, and set on a browser upload by
// `finalizeObject` once its bytes have been checked.

export class StorageError extends Error {}

type Config = { client: AwsClient; base: string; bucket: string };
let configured: Config | undefined;

function config(): Config {
  if (configured) return configured;
  const { R2_ACCESS_KEY_ID: accessKeyId, R2_SECRET_ACCESS_KEY: secretAccessKey, STORAGE_BUCKET: bucket, r2Endpoint: endpoint } = env();
  if (!endpoint || !accessKeyId || !secretAccessKey) throw new StorageError("storage_not_configured");
  // No retries of our own making: a failed call surfaces as the error it is, as it always has.
  const client = new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto", retries: 0 });
  return (configured = { client, base: `${endpoint.replace(/\/$/, "")}/${bucket}`, bucket });
}

const encodePath = (objectPath: string) => objectPath.split("/").map(encodeURIComponent).join("/");
const objectUrl = (objectPath: string) => `${config().base}/${encodePath(objectPath)}`;

function call(objectPath: string, init: RequestInit = {}): Promise<Response> {
  return config().client.fetch(objectUrl(objectPath), { ...init, signal: AbortSignal.timeout(15_000) });
}

async function fail(response: Response, what: string): Promise<never> {
  throw new StorageError(`${what}: ${response.status} ${(await response.text()).slice(0, 200)}`);
}

/**
 * `attachment` under the file's own name: RFC 6266's `filename*` carries the Vietnamese, and a
 * plain-ASCII `filename` stands in for a client that reads only that.
 */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * A URL the browser can PUT one file to within two hours, with exactly this `Content-Type` (it is
 * part of the signature). R2 cannot cap the size of a presigned PUT; `completeUpload` measures
 * what arrived and removes what is too large.
 */
export async function createSignedUploadUrl(objectPath: string, contentType: string): Promise<string> {
  const url = new URL(objectUrl(objectPath));
  url.searchParams.set("X-Amz-Expires", String(2 * 60 * 60));
  const signed = await config().client.sign(url, { method: "PUT", headers: { "content-type": contentType }, aws: { signQuery: true, allHeaders: true } });
  return signed.url;
}

/**
 * Bytes the **server** already holds, written straight into the bucket. Used by the one upload
 * path that cannot be given a signed URL: the public careers form (FR-REC-03). An unauthenticated
 * visitor must never be handed a capability to write into private storage, so their file arrives
 * inside the request, is checked in memory, and only then lands here.
 */
export async function putObject(objectPath: string, bytes: Uint8Array, contentType: string, fileName: string): Promise<void> {
  const response = await call(objectPath, {
    method: "PUT",
    // `If-None-Match: *` — an object path is a fresh uuid, so a collision means something is wrong.
    headers: { "content-type": contentType, "content-disposition": attachmentDisposition(fileName), "if-none-match": "*" },
    body: new Uint8Array(bytes),
  });
  if (response.status === 413) throw new StorageError("file_storage_limit");
  if (!response.ok) await fail(response, "put object");
}

/** Size of the stored object and its first bytes, or null when nothing was uploaded. */
export async function inspectObject(objectPath: string, headBytes = 512): Promise<{ sizeBytes: number; head: Uint8Array } | null> {
  const response = await call(objectPath, { headers: { range: `bytes=0-${headBytes - 1}` } });
  if (response.status === 404) return null;
  if (!response.ok) await fail(response, "inspect");
  const head = new Uint8Array(await response.arrayBuffer()).slice(0, headBytes);
  // "bytes 0-511/12345" when the range was honoured; otherwise the whole object came back.
  const total = response.headers.get("content-range")?.split("/")[1];
  const sizeBytes = total && total !== "*" ? Number(total) : Number(response.headers.get("content-length") ?? head.length);
  return { sizeBytes, head };
}

/**
 * Gives a checked browser upload its type and download name. A copy of the object onto itself
 * with its metadata replaced: server-side, so the bytes do not travel.
 */
export async function finalizeObject(objectPath: string, contentType: string, fileName: string): Promise<void> {
  const { bucket } = config();
  const response = await call(objectPath, {
    method: "PUT",
    headers: { "x-amz-copy-source": `/${bucket}/${encodePath(objectPath)}`, "x-amz-metadata-directive": "REPLACE", "content-type": contentType, "content-disposition": attachmentDisposition(fileName) },
  });
  if (!response.ok) await fail(response, "finalize");
}

/** A link that works for `expiresInSeconds`; the object's own `Content-Disposition` makes it a download. */
export async function createSignedDownloadUrl(objectPath: string, expiresInSeconds: number): Promise<string> {
  const url = new URL(objectUrl(objectPath));
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));
  const signed = await config().client.sign(url, { method: "GET", aws: { signQuery: true } });
  return signed.url;
}

/** The object's bytes as a stream, for the server to pass on; null when there is no such object. */
export async function readObject(objectPath: string): Promise<ReadableStream<Uint8Array> | null> {
  const response = await call(objectPath);
  if (response.status === 404) return null;
  if (!response.ok) await fail(response, "read");
  return response.body;
}

export async function removeObject(objectPath: string): Promise<void> {
  const response = await call(objectPath, { method: "DELETE" });
  if (!response.ok && response.status !== 404) await fail(response, "remove");
}

export const currentBucket = () => config().bucket;
