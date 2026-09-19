import { getCurrentUser } from "@/modules/platform/auth/session";
import { canViewPage, findPageFile, kbViewerOf, pageFileLink } from "@/modules/kb/service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Pictures and attachments of a knowledge-base page. The address is stable (it sits in the page's
// document); what it answers with is a one-minute signed link, made only after the KB policy has
// said this viewer may see the page the file belongs to. Anything else is "not found".
export async function GET(_request: Request, context: RouteContext<"/api/kb/files/[fileId]">) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { fileId } = await context.params;
  const found = UUID.test(fileId) ? await findPageFile(fileId) : undefined;
  if (!found || !canViewPage(kbViewerOf(user), found.loaded.facts, found.loaded.pageFacts)) return new Response("Not found", { status: 404 });
  const url = await pageFileLink(found.file, { personId: user.person.id, email: user.email }, user.request);
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, no-store" } });
}
