import { type NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { googleStepUpUrl, sealPendingStepUp, STEP_UP_STATE_COOKIE, stepUpDriver } from "@/modules/platform/auth/step-up";

// Starts the Google re-authentication round trip (FR-PLT-06). Untested: see step-up.ts.
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(new URL("/sign-in", request.url));
  // A borrowed session (FR-PLT-40) has nothing of its own to prove: the page explains.
  if (stepUpDriver() !== "google" || user.impersonator) return NextResponse.redirect(new URL("/step-up", request.url));

  const { cookie, pending } = sealPendingStepUp({ next: request.nextUrl.searchParams.get("next") ?? "/home", sessionId: user.sessionId });
  const response = NextResponse.redirect(googleStepUpUrl(pending, user.email));
  response.cookies.set(STEP_UP_STATE_COOKIE, cookie, { httpOnly: true, secure: true, sameSite: "lax", path: "/api/step-up", maxAge: 600 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
