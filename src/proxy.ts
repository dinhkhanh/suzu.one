import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isPublicPath, PUBLIC_SITE_HEADER, SURFACE_HEADER, surfaceForPath } from "@/i18n/surfaces";
import { contentSecurityPolicy, CSP_HEADER, CSP_REPORT_ONLY_HEADER, newNonce, originOf, sentryCsp } from "@/lib/csp";
import { env, isDevelopmentEnvironment } from "@/lib/env";
import { publicSite } from "@/lib/site";
import { routeRequest } from "@/lib/site-routing";

/**
 * The page's Content-Security-Policy (`src/lib/csp.ts`), with a nonce of this request's own; null
 * when `CSP_MODE` is `off`. Report-only unless the configuration says to enforce.
 */
function pagePolicy(surface: string) {
  const { CSP_MODE, r2Endpoint, NEXT_PUBLIC_SENTRY_DSN, SENTRY_DSN } = env();
  // The browser SDK posts to the DSN inlined at build time; the server's is the same project where both are set.
  return contentSecurityPolicy(CSP_MODE, { nonce: newNonce(), surface, development: isDevelopmentEnvironment(), storageOrigin: originOf(r2Endpoint), sentry: sentryCsp(NEXT_PUBLIC_SENTRY_DSN || SENTRY_DSN) });
}

/**
 * Four jobs, read off the host and the path and nothing else.
 *
 * **Which domain this is.** With a public domain configured (PUBLIC_SITE_URL), it serves only the
 * review links, the careers pages and a home page of its own, and the app's domain sends those
 * pages over to it — the table is `src/lib/site-routing.ts`. Whether the request is on the public
 * domain is written onto it too (`PUBLIC_SITE_HEADER`), so the root layout can leave out what
 * names the app.
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
 *
 * **Saying what the page may load** (NFR-SEC-01). Every page gets the Content-Security-Policy,
 * with a nonce made here. It is written onto the request — Next reads the nonce off that header
 * and puts it on the scripts it writes — and onto the response, for the browser. Like the surface,
 * it is never copied from what the caller sent. The paths let past untouched below (the API routes
 * that authenticate for themselves, the service worker, which has a policy of its own in
 * `next.config.ts`) answer no page and get none.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const site = publicSite();
  const route = routeRequest({ host: request.headers.get("host") ?? request.nextUrl.host, pathname, publicHost: site?.host ?? null });
  if (route.kind === "pass") return NextResponse.next();
  if (route.kind === "notFound") return new NextResponse(null, { status: 404 });
  // 308: a client's decision posted to an old address arrives as the POST it was.
  if (route.kind === "redirect") return NextResponse.redirect(new URL(`${route.path}${search}`, site!.origin), 308);

  const served = route.kind === "public" && route.rewrite ? route.rewrite : pathname;
  const surface = surfaceForPath(served);
  const headers = new Headers(request.headers);
  headers.set(SURFACE_HEADER, surface);
  headers.set(PUBLIC_SITE_HEADER, route.kind === "public" ? "1" : "0");
  const policy = pagePolicy(surface);
  headers.delete(CSP_HEADER);
  headers.delete(CSP_REPORT_ONLY_HEADER);
  if (policy) headers.set(policy.name, policy.value);
  const withPolicy = (response: NextResponse) => {
    if (policy) response.headers.set(policy.name, policy.value);
    return response;
  };
  if (served !== pathname) return withPolicy(NextResponse.rewrite(new URL(`${served}${search}`, request.url), { request: { headers } }));

  // The public surfaces have nobody signed in and never will: they check their own credential —
  // a token in the path, or none at all — in the data layer, like everything else.
  if (!isPublicPath(pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/sign-in", request.url));
  }
  return withPolicy(NextResponse.next({ request: { headers } }));
}

/**
 * Everything but the files that are served as they are. It deliberately does **not** skip whole
 * words like "careers", and does not skip a path for ending in an image extension: `/preview/a.png`
 * and `/careers` are pages, they render with words in them, and skipping them here is what once
 * sent an anonymous visitor the entire internal catalogue. The exclusions below name actual files
 * — Next's own assets, the icons, `robots.txt`. The service worker, the offline page, the manifest
 * and the two API routes that authenticate for themselves do come through, but only so the public
 * domain can refuse them: on the app's domain they are let past untouched (`routeRequest`).
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|icons/|favicon\\.ico|robots\\.txt|[^/]+\\.svg$).*)"],
};
