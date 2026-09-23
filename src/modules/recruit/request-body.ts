import "server-only";
// Reading an unauthenticated request body without trusting what it says about itself. Used by the
// two careers endpoints (the application form and the take-home); the same guard as the preview
// link's decision route.

/**
 * The body, read a chunk at a time and abandoned the moment it passes `max` — the only guard that
 * holds for a sender who declares nothing, declares a lie, or sends the whole thing in pieces.
 * `null` means it was too big; the bytes are handed back so the form parser sees exactly what was
 * counted and nothing is read twice.
 */
export async function readBodyWithin(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array(new ArrayBuffer(0));
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(new ArrayBuffer(total));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/**
 * A multipart form of at most `max` bytes, or the reason there is none: `too_large` when the
 * declared length or the bytes actually sent pass `max`, `failed` when it is not a form at all.
 * Parsed from the counted bytes with the request's own content type, so the boundary still reads.
 */
export async function readFormWithin(request: Request, max: number): Promise<FormData | "too_large" | "failed"> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return "too_large";
  const body = await readBodyWithin(request, max);
  if (!body) return "too_large";
  try {
    return await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return "failed";
  }
}
