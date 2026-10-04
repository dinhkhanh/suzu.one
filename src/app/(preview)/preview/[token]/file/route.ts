import { visitorOf } from "@/lib/public-action";
import { openPreviewFile } from "@/modules/work/service";

/**
 * The file of the one version a review link is for (D24, FR-PJM-51a) — where the page's file link
 * and its inline picture point. The page prints no storage URL: a signed one runs out a minute
 * after it is made, and a client who reads the note before tapping the file would find it dead.
 * So the address on the page is this one, which is good for as long as the review link is, and the
 * signing happens here, at the moment of asking.
 *
 * Written to the same rules as the page and the decision endpoint next door:
 *
 *   · nothing is decided here: the token and the visitor go to `openPreviewFile`, which asks
 *     everything the page asks — the token's shape, the rate limits, the hash compare, expiry,
 *     revocation, "already decided", a version the company has taken back — on **every** request;
 *   · a fetch is not a view: the page that shows a picture and the client who taps it are one
 *     visit, and the link's count is not touched;
 *   · the answer never has a body worth reading. A file that may be had is a redirect to storage;
 *     a link that is closed in any way is a redirect to the page, which says its one sentence and
 *     never why; the rest is a bare status;
 *   · never indexed, never stored, and the address is never passed on as a referrer: the URL *is*
 *     the credential (`next.config.ts` says the same for all of `/preview/*`).
 *
 * The address deliberately does not end in the file's name or extension: it would put a piece of
 * the client's work in every log line, and nothing here is served as a static file.
 */

/** Reading one row and signing one URL. Anything slower than this is broken, not busy. */
export const maxDuration = 15;

const GUARDED = { "cache-control": "private, no-store, max-age=0", "x-robots-tag": "noindex, nofollow, noarchive, nosnippet", "referrer-policy": "no-referrer" };

const redirect = (status: 302 | 303, location: string) => new Response(null, { status, headers: { ...GUARDED, location } });
const refused = (status: 404 | 429 | 503) => new Response(null, { status, headers: GUARDED });

export async function GET(request: Request, context: RouteContext<"/preview/[token]/file">) {
  const { token } = await context.params;
  const outcome = await openPreviewFile(token, visitorOf(request));
  if (outcome.ok) return redirect(302, outcome.url);
  switch (outcome.reason) {
    // Unknown, expired, revoked, already decided, taken back: the page is where that is said, in
    // the client's language, and it says the same for all of them. The token is encoded on the
    // way back out, as the decision endpoint does.
    case "closed":
      return redirect(303, `/preview/${encodeURIComponent(token)}`);
    case "rate_limited":
      return refused(429);
    // Storage could not sign: worth trying again in a moment.
    case "unavailable":
      return refused(503);
    // The version is a link, or its file is gone.
    default:
      return refused(404);
  }
}
