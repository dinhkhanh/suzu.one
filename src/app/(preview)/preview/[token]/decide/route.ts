import { visitorOf } from "@/lib/public-action";
import { decideOnPreviewLink } from "@/modules/work/service";

/**
 * Where the client's decision arrives (D24, FR-PJM-51a). The third — and last — unauthenticated
 * write endpoint in the product, written to the same rules as the careers form and the take-home:
 *
 *   · the body is refused **before it is read** if `content-length` says it is too big, so a large
 *     upload costs one header and not the memory — and counted as it is read, because a chunked
 *     request declares no length at all and a declared one is only what the sender claims;
 *   · nothing is decided here: the values go to `decideOnPreviewLink`, a `createPublicAction` that
 *     rate-limits, checks the honeypot, validates, records the decision and writes the audit row;
 *   · the answer is always a redirect. No JSON, no ids, no stack traces; a failure carries a
 *     **message key** in the query string and nothing else.
 */

/** A name and a comment. There is no upload on this page, so anything larger is not a form. */
const MAX_BODY_BYTES = 64 * 1024;

/** Reading one row and writing a decision. */
export const maxDuration = 15;

const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

/**
 * The body, read a chunk at a time and abandoned the moment it passes `max` — the only guard that
 * holds for a sender who declares nothing, declares a lie, or sends the whole thing in pieces.
 * `null` means it was too big; the bytes are handed back so the form parser sees exactly what was
 * counted and nothing is read twice.
 */
async function readBodyWithin(request: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
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

export async function POST(request: Request, context: RouteContext<"/preview/[token]/decide">) {
  const { token } = await context.params;
  // The token is used to build the redirect, so it is encoded on the way back out; it is never
  // printed into a page and never reaches SQL except as a bound parameter.
  const back = (error?: string) => seeOther(`/preview/${encodeURIComponent(token)}${error ? `?error=${encodeURIComponent(error)}` : ""}`);

  const declared = Number(request.headers.get("content-length") ?? "");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return back("failed");

  const body = await readBodyWithin(request, MAX_BODY_BYTES);
  if (!body) return back("failed");

  let form: FormData;
  try {
    // Parsed from the bytes that were counted, with the request's own content type so the multipart
    // boundary is still read. A body that is not a form at all lands in the catch, and a probe
    // learns nothing from the parser.
    form = await new Response(body, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return back("failed");
  }

  const text = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : "";
  };

  const result = await decideOnPreviewLink(
    { token, website: text("website"), version: text("version"), decision: text("decision"), decidedByName: text("decidedByName"), comment: text("comment") },
    visitorOf(request),
  );

  // The link is spent, so the page it goes back to is the closed one; `sent` is what turns its
  // sentence into a thank-you. Nothing of the decision travels in the URL.
  if (result.ok) return seeOther(`/preview/${encodeURIComponent(token)}?sent=1`);
  return back(result.message ?? result.error);
}

/** Nothing to GET here: the form lives on the preview page. */
export async function GET(_request: Request, context: RouteContext<"/preview/[token]/decide">) {
  const { token } = await context.params;
  return seeOther(`/preview/${encodeURIComponent(token)}`);
}
