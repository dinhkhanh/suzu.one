import { canManageBrandKit } from "@/modules/brand/policy";
import { findBrandAsset, findBrandKit } from "@/modules/brand/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { createDownloadLink, findFile } from "@/modules/platform/files/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A file of a brand kit for its keeper's own screen — the picture beside each row, a hidden kit's
// or a private file's included. A redirect to a one-minute signed link on the storage's domain,
// never the bytes from ours: a kit may hold an SVG, and an SVG served from this origin could run.
export async function GET(_request: Request, context: RouteContext<"/admin/brands/[id]/files/[assetId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, assetId } = await context.params;
  if (!UUID.test(id) || !UUID.test(assetId)) return new Response("Not found", { status: 404 });
  const [kit, asset] = await Promise.all([findBrandKit(id), findBrandAsset(assetId)]);
  if (!kit || asset?.brandId !== kit.id || !canManageBrandKit(user.principal, kit)) return new Response("Not found", { status: 404 });
  const file = await findFile(asset.fileId);
  if (!file) return new Response("Not found", { status: 404 });
  const url = await createDownloadLink(file, { personId: user.person.id, email: user.email });
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, max-age=50", "referrer-policy": "no-referrer" } });
}
