// Which domain answers which path, when the product runs on two of them.
//
// The internal app lives on its own domain (suzu.one). The links the company hands to outsiders —
// a client's review link (/preview, D24) and the careers pages (/careers, FR-REC-03) — live on a
// public one (PUBLIC_SITE_URL, e.g. suzu.vn), so a client or a candidate never learns the app's
// address. The public domain answers those two prefixes and a company home page of its own at `/`,
// and **nothing else**: not the sign-in page, not the app's home, not its API. The app's domain
// sends those two prefixes over, so an old link keeps working and lands on the public address.
//
// Pure, so the whole table is tested (site-routing.test.ts); `src/proxy.ts` acts on the answer.

/** The only paths the public domain serves, besides its own home page. */
export const PUBLIC_SITE_PREFIXES = ["/preview", "/careers"] as const;

/**
 * Where the public domain's home page actually lives. The public domain rewrites `/` here; with no
 * public domain configured it is simply a page of the one domain (handy on a laptop).
 */
export const PORTFOLIO_PATH = "/portfolio";

/**
 * Files and endpoints the proxy lets through on the app's domain untouched: they authenticate for
 * themselves (`/api/auth/`, `/api/cron/`, Meta's signed `/api/messenger/`) or are the installable app's own files. On the public
 * domain they do not exist.
 */
const APP_PASS_THROUGH = ["/api/auth/", "/api/cron/", "/api/messenger/", "/sw.js", "/offline.html", "/manifest.webmanifest"];

/** Vercel's own endpoints (analytics, speed insights), which every domain needs. */
const PLATFORM_PREFIX = "/_vercel/";

const under = (pathname: string, prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
const passesThrough = (pathname: string, list: readonly string[]) => list.some((entry) => (entry.endsWith("/") ? pathname.startsWith(entry) : pathname === entry));

/** Whether a path belongs on the public domain. */
export const isPublicSitePath = (pathname: string): boolean => PUBLIC_SITE_PREFIXES.some((prefix) => under(pathname, prefix));

export type SiteRoute =
  /** Leave it alone: no surface, no session check (a file or a self-authenticating endpoint). */
  | { kind: "pass" }
  /** A page on the app's domain: the usual surface and session check. */
  | { kind: "app" }
  /** A page on the public domain, served at `rewrite` when that differs from the path asked for. */
  | { kind: "public"; rewrite?: string }
  /** Belongs on the public domain: send the browser there, to `path`. */
  | { kind: "redirect"; path: string }
  /** The public domain has nothing here. */
  | { kind: "notFound" };

/**
 * Decide what a request is. `host` is the Host header as the browser sent it and `publicHost` the
 * configured public domain's host (with a port if it names one), or `null` when there is none — in
 * which case one domain serves everything, exactly as before there were two.
 */
export function routeRequest({ host, pathname, publicHost }: { host: string | null; pathname: string; publicHost: string | null }): SiteRoute {
  if (publicHost && host?.toLowerCase() === publicHost) {
    if (pathname === "/") return { kind: "public", rewrite: PORTFOLIO_PATH };
    if (isPublicSitePath(pathname)) return { kind: "public" };
    if (pathname.startsWith(PLATFORM_PREFIX)) return { kind: "pass" };
    return { kind: "notFound" };
  }
  if (publicHost && isPublicSitePath(pathname)) return { kind: "redirect", path: pathname };
  if (publicHost && under(pathname, PORTFOLIO_PATH)) return { kind: "redirect", path: "/" };
  if (passesThrough(pathname, APP_PASS_THROUGH) || pathname.startsWith(PLATFORM_PREFIX)) return { kind: "pass" };
  return { kind: "app" };
}
