import { getCurrentUser } from "@/modules/platform/auth/session";
import { loadViewer, searchTasks } from "@/modules/work/service";

// Command palette search. Read-only: the work service answers as the signed-in person, so a task
// in a project they cannot open never shows up.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const query = new URL(request.url).searchParams.get("q") ?? "";
  const hits = await searchTasks(await loadViewer(user), query);
  return Response.json({ hits }, { headers: { "Cache-Control": "private, no-store" } });
}
