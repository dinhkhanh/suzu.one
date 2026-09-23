import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * The header a public surface is marked with on its way in. `src/i18n/request.ts` reads it and
 * hands that request **only that surface's** messages, so a page the internet can fetch does not
 * ship the whole product's vocabulary — payroll, HR, everybody's screen names — to a stranger's
 * browser. It is set here and nowhere else, and cleared on every other request, so a spoofed one
 * cannot reach the internal pages.
 */
export const PUBLIC_SURFACE_HEADER = "x-public-surface";

/** `/preview/<token>`: the client's review link (D24), unauthenticated by design. */
const PUBLIC_SURFACES: Record<string, string> = { "/preview": "preview" };

// Optimistic check only: it looks for a session cookie so signed-out visitors go straight to
// the sign-in page. Real authentication and authorization happen in the data layer
// (getCurrentUser / createAction), never here.
export function proxy(request: NextRequest) {
  const surface = Object.entries(PUBLIC_SURFACES).find(([prefix]) => request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`))?.[1];
  // A request that says it is public when it is not would otherwise get a page with no words on it.
  const headers = new Headers(request.headers);
  if (surface) headers.set(PUBLIC_SURFACE_HEADER, surface);
  else headers.delete(PUBLIC_SURFACE_HEADER);

  // The public surfaces have nobody signed in and never will: they check their own credential —
  // a token in the path — in the data layer, like everything else.
  if (!surface && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api/auth|api/cron|sign-in|careers|_next/static|_next/image|favicon.ico|sw.js|offline.html|.*\\.(?:svg|png|jpg|ico|webmanifest)$).*)"],
};
