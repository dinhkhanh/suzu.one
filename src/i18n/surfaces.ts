// Which words each part of the product is allowed to ship to the browser.
//
// `NextIntlClientProvider` in the root layout **serialises whatever the request config returns into
// the page**, where anyone holding the URL can read it. The catalogue is half a megabyte of the
// company's internal vocabulary — payroll screens, salary fields, everybody's job titles, the
// permission names — and two of the product's pages are open to the internet: the careers page
// (FR-REC-03) and the client's review link (D24, FR-PJM-51a). Neither has any business handing a
// stranger the rest.
//
// So the surface is decided **from the path**, here, and the decision is written down in one table
// that both the proxy (which knows the path) and `request.ts` (which chooses the messages) read.
//
// Two rules make it hold:
//
//   · **The whole catalogue is opt-in.** `request.ts` hands over everything only for a request the
//     proxy marked `app` **and** that has a real session behind it. A path the proxy never saw — an
//     unmatched route, a matcher edited carelessly, a dynamic segment that happens to end in `.png`
//     — gets the public vocabulary and nothing else, and so does a stranger who simply invented a
//     session cookie, since the proxy's check of one is deliberately optimistic. The failure is
//     then a page missing its words inside the company, which is noticed in a minute, and never a
//     catalogue leaving it, which is noticed by nobody.
//   · **Public surfaces are named by prefix, not by what they look like.** `/careers`,
//     `/preview/<token>`, the sign-in page and the public site (the home page, `/privacy`,
//     `/terms`) are the pages a signed-out visitor may open, and each names the namespaces it
//     needs. The home page is the one `exact` entry: a prefix of `/` would be every path.

/** The header the proxy writes the surface it read off the path onto. Set on every request it sees. */
export const SURFACE_HEADER = "x-surface";

/**
 * The header the proxy writes "1" onto for a request on the public domain (PUBLIC_SITE_URL, see
 * `src/lib/site-routing.ts`) and "0" otherwise — always written, never taken from the caller. The
 * root layout reads it to leave out everything that names the internal app.
 */
export const PUBLIC_SITE_HEADER = "x-public-site";

/** The surface every page inside the company runs on: the whole catalogue, to a signed-in browser. */
export const APP_SURFACE = "app";

type Surface = { prefix: string; name: string; namespaces: readonly string[]; exact?: boolean };

/** The public site: what the product is, and the policies Google's OAuth review reads. */
const SITE_NAMESPACES = ["app", "site", "legal", "theme"] as const;

/**
 * The pages a stranger may open, with the words each one needs. A namespace can be a path
 * (`recruit.careers`), which is how the careers pages get their own words without the rest of
 * recruitment — pipelines, candidates, scorecards — going with them.
 */
export const PUBLIC_SURFACES: readonly Surface[] = [
  /** The client's review link (D24, FR-PJM-51a), unauthenticated by design. */
  { prefix: "/preview", name: "preview", namespaces: ["preview", "theme"] },
  /** The careers page and the take-home brief (FR-REC-03). */
  { prefix: "/careers", name: "careers", namespaces: ["recruit.careers", "recruit.assignment", "theme"] },
  /** The public domain's own home page: the company, not the app (`src/lib/site-routing.ts`). */
  { prefix: "/portfolio", name: "portfolio", namespaces: ["portfolio", "theme"] },
  /** Nobody is signed in here either, by definition. */
  { prefix: "/sign-in", name: "signIn", namespaces: ["app", "signIn", "theme"] },
  /** The home page a signed-out visitor sees; a signed-in one is sent on to the app. */
  { prefix: "/", exact: true, name: "site", namespaces: SITE_NAMESPACES },
  { prefix: "/privacy", name: "site", namespaces: SITE_NAMESPACES },
  { prefix: "/terms", name: "site", namespaces: SITE_NAMESPACES },
];

const matches = (pathname: string, { prefix, exact }: Surface) => pathname === prefix || (!exact && pathname.startsWith(`${prefix}/`));

/** The surface a path belongs to. Everything that is not one of the public pages is the app. */
export function surfaceForPath(pathname: string): string {
  return PUBLIC_SURFACES.find((surface) => matches(pathname, surface))?.name ?? APP_SURFACE;
}

/** Whether a path is open to a visitor with no session (so the proxy must not send them to sign in). */
export const isPublicPath = (pathname: string): boolean => surfaceForPath(pathname) !== APP_SURFACE;

/**
 * Everything any public page needs. What an unmarked request falls back to — and what an app path
 * with nobody behind it gets, since the proxy's cookie check is optimistic (see `request.ts`).
 */
export const PUBLIC_FALLBACK: readonly string[] = [...new Set(PUBLIC_SURFACES.flatMap((surface) => surface.namespaces))];

/**
 * The namespaces a request may receive; `null` means the whole catalogue, and only the app gets
 * that. An unknown or missing marker is treated as public — see the second rule above.
 */
export function namespacesForSurface(surface: string | null | undefined): readonly string[] | null {
  if (surface === APP_SURFACE) return null;
  return PUBLIC_SURFACES.find((known) => known.name === surface)?.namespaces ?? PUBLIC_FALLBACK;
}

/**
 * The catalogue cut down to those namespaces, keeping the shape a dotted one names, so
 * `recruit.careers` arrives as `{ recruit: { careers: … } }` and `t("recruit.careers.brand")`
 * still finds it. A namespace the catalogue does not have is simply absent.
 */
export function pickMessages(all: Record<string, unknown>, namespaces: readonly string[]): Record<string, unknown> {
  const picked: Record<string, unknown> = {};
  for (const namespace of namespaces) {
    const path = namespace.split(".");
    let from: unknown = all;
    for (const key of path) from = from && typeof from === "object" ? (from as Record<string, unknown>)[key] : undefined;
    if (from === undefined) continue;
    let into = picked;
    for (const key of path.slice(0, -1)) into = (into[key] ??= {}) as Record<string, unknown>;
    into[path[path.length - 1]] = from;
  }
  return picked;
}
