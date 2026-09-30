import { getCurrentUser } from "@/modules/platform/auth/session";
import { canViewProject, loadViewer, projectFacts } from "@/modules/work/service";
import { findCurrentPoster, readPoster } from "@/modules/work/poster";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A project's poster, for whoever may open the project. As with a profile picture, the address names
// the picture itself, so a new poster is a new address and the browser may keep this one for a week;
// a poster since replaced, or a project the viewer may not open, is "not found".
export async function GET(_request: Request, context: RouteContext<"/api/work/projects/[id]/poster/[fileId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id, fileId } = await context.params;
  const current = UUID.test(id) && UUID.test(fileId) ? await findCurrentPoster(id, fileId) : null;
  if (!current || !canViewProject(await loadViewer(user), projectFacts(current.found.project, current.found.team))) return new Response("Not found", { status: 404 });
  const body = await readPoster(current.file);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(body, {
    headers: {
      "content-type": current.file.contentType,
      "content-disposition": "inline",
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=604800, immutable",
    },
  });
}
