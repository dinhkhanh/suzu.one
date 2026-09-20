import { type NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/modules/platform/audit/service";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { markReauthenticated, openPendingStepUp, STEP_UP_STATE_COOKIE, stepUpDriver, verifyGoogleStepUp } from "@/modules/platform/auth/step-up";

// Google sends the person back here after they signed in again (FR-PLT-06). Untested: see step-up.ts.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  const actor = { userId: user.userId, personId: user.person.id, email: user.email };

  const refuse = async (reason: string) => {
    await recordAudit({ action: "auth.step_up.rejected", actor, request: user.request, summary: reason });
    const response = NextResponse.redirect(new URL("/step-up?error=1", request.url));
    response.cookies.delete({ name: STEP_UP_STATE_COOKIE, path: "/api/step-up" });
    return response;
  };

  if (stepUpDriver() !== "google") return refuse("driver");
  const pending = openPendingStepUp(request.cookies.get(STEP_UP_STATE_COOKIE)?.value);
  const code = request.nextUrl.searchParams.get("code");
  if (!pending || !code || pending.state !== request.nextUrl.searchParams.get("state")) return refuse("state");
  // The proof belongs to the session that asked for it, not to whichever session arrives here.
  if (pending.sessionId !== user.sessionId) return refuse("session");

  const verdict = await verifyGoogleStepUp(code, pending, user.email);
  if (!verdict.ok) return refuse(verdict.reason);

  await markReauthenticated(user.sessionId);
  await recordAudit({ action: "auth.step_up", actor, request: user.request, summary: "google" });
  const response = NextResponse.redirect(new URL(pending.next, request.url));
  response.cookies.delete({ name: STEP_UP_STATE_COOKIE, path: "/api/step-up" });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
