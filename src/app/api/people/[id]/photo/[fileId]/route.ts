import { findCurrentPhoto, readPhoto } from "@/modules/core-hr/photo";
import { canSeePhoto } from "@/modules/core-hr/policy";
import { getPersonTarget } from "@/modules/core-hr/service";
import { getCurrentUser } from "@/modules/platform/auth/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A person's profile picture (FR-CHR-01), for whoever sees their directory entry. The address
// names the picture itself, so a new picture is a new address and the browser may keep this one
// for a week without asking again; a picture since replaced is "not found". The app passes the
// bytes on rather than redirecting to a signed link: a directory page shows dozens at once.
export async function GET(_request: Request, context: RouteContext<"/api/people/[id]/photo/[fileId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, fileId } = await context.params;
  const found = UUID.test(id) && UUID.test(fileId) ? await findCurrentPhoto(id, fileId) : null;
  if (!found || !canSeePhoto(user.principal, await getPersonTarget(id), found.status)) return new Response("Not found", { status: 404 });
  const body = await readPhoto(found.file);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": found.file.contentType,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    },
  });
}
