import { publicBrandFileLink } from "@/modules/brand/public";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9-]{1,80}$/;

/** Reading two cached lists and signing one link. Anything slower is broken, not busy. */
export const maxDuration = 15;

// A file of a published brand kit (FR-BRD-04), for anybody: a redirect to a five-minute signed
// link on the storage's domain, where the object is stored as an attachment. `?preview=1` is a
// picture drawn on the page (not counted); without it the visitor pressed Download (counted).
// Everything that cannot be had — a hidden kit, a private file, an id from another kit — is the
// same 404. The address deliberately never ends in a file extension: the proxy's matcher passes
// `*.svg` untouched, and this route must go through it like every other public page.
export async function GET(request: Request, context: RouteContext<"/brands/[slug]/files/[assetId]">) {
  const { slug, assetId } = await context.params;
  if (!SLUG.test(slug) || !UUID.test(assetId)) return new Response("Not found", { status: 404 });
  const preview = new URL(request.url).searchParams.get("preview") === "1";
  const url = await publicBrandFileLink(slug, assetId, preview ? "preview" : "download");
  if (!url) return new Response("Not found", { status: 404, headers: { "x-robots-tag": "noindex" } });
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
