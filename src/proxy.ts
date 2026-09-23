import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath, SURFACE_HEADER, surfaceForPath } from "@/i18n/surfaces";

/**
 * Two jobs, both read off the path and nothing else.
 *
 * **Which surface this is.** `src/i18n/surfaces.ts` decides it from the path and this writes the
 * answer onto the request, where `src/i18n/request.ts` reads it to choose the words the page may
 * ship to the browser. It is written on *every* request that reaches here and never copied from
 * what the caller sent, so a request claiming to be an internal page cannot talk itself into the
 * catalogue — and a request that never reaches here gets the public vocabulary, not everything
 * (see `namespacesForSurface`).
 *
 * **Sending signed-out visitors to sign in.** An optimistic check only: it looks for a session
 * cookie. Real authentication and authorization happen in the data layer (getCurrentUser /
 * createAction), never here.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const headers = new Headers(request.headers);
  headers.set(SURFACE_HEADER, surfaceForPath(pathname));

  // The public surfaces have nobody signed in and never will: they check their own credential —
  // a token in the path, or none at all — in the data layer, like everything else.
  if (!isPublicPath(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return NextResponse.next({ request: { headers } });
}

/**
 * Everything but the files that are served as they are. It deliberately does **not** skip whole
 * words like "careers", and does not skip a path for ending in an image extension: `/preview/a.png`
 * and `/careers` are pages, they render with words in them, and skipping them here is what once
 * sent an anonymous visitor the entire internal catalogue. The exclusions below name actual files
 * — Next's own assets, the icons, the service worker, the offline page, the manifest — and the two
 * API routes that authenticate for themselves.
 */
export const config = {
  matcher: ["/((?!api/auth/|api/cron/|_next/static|_next/image|icons/|favicon\\.ico|sw\\.js|offline\\.html|manifest\\.webmanifest|[^/]+\\.svg$).*)"],
};
