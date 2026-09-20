import { getCurrentUser } from "@/modules/platform/auth/session";
import { listCreateTargets, loadViewer } from "@/modules/work/service";

// Quick-create: the teams and projects the signed-in person may file a task in. Read-only.
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  return Response.json(await listCreateTargets(await loadViewer(user)), { headers: { "Cache-Control": "private, no-store" } });
}
