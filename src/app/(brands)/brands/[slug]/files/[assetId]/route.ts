import { visitorOf } from "@/lib/public-action";
import { servePublicBrandFile } from "@/modules/brand/public";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

/** Reading two cached lists and signing one link. Anything slower is broken, not busy. */
export const maxDuration = 15;

/** One answer for everything that cannot be had, so nothing can be told apart by how it was refused. */
const notFound = () => new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });

// A file of a published brand kit (FR-BRD-04), for anybody: a redirect to a five-minute signed
// link on the storage's domain, where the object is stored as an attachment. `?preview=1` is a
// picture drawn on the page (not counted, and only ever a picture); without it the visitor pressed
// Download (counted). Everything that cannot be had — a hidden kit, a private file, a file a rule
// cites that is not a picture, an id from another kit — is the same 404. Each request is counted
// against its visitor before anything is read or signed, and past the hour's allowance is a 429.
// The address deliberately never ends in a file extension: the proxy's matcher passes `*.svg`
// untouched, and this route must go through it like every other public page.
export async function GET(request: Request, context: RouteContext<"/brands/[slug]/files/[assetId]">) {
  const { slug, assetId } = await context.params;
  if (!SLUG.test(slug) || !UUID.test(assetId)) return notFound();
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const outcome = await servePublicBrandFile(slug, assetId, preview ? "preview" : "download", visitorOf(request));
  if (!outcome.ok) return new Response("Too many requests", { status: 429, headers: { "retry-after": String(outcome.retryAfterSeconds), "cache-control": "no-store", "x-robots-tag": "noindex" } });
  const { url } = outcome;
  if (!url) return notFound();
  return new Response(null, {
    status: 302,
    headers: {
      location: url,
      // A picture may be kept for a few minutes (the link behind it lives five); a download is
      // asked for afresh, so each press is counted.
      "cache-control": preview ? "public, max-age=240" : "no-store",
      "x-robots-tag": "noindex",
      "referrer-policy": "no-referrer",
    },
  });
}
