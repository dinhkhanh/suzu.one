// What an anonymous visitor's browser is given.
//
// The product has two pages the internet can open — the careers page (FR-REC-03) and the client's
// review link (D24, FR-PJM-51a) — plus the public site (the home page and the two policies Google's
// OAuth review reads) and the sign-in page a signed-out person lands on. The
// root layout's `NextIntlClientProvider` **serialises whatever `src/i18n/request.ts` returns into
// the page**, so the whole internal vocabulary (payroll screens, salary fields, everybody's job
// titles, the permission names) would otherwise arrive in the browser of a stranger holding a
// review link — half a megabyte of it.
//
// These tests hold the two halves of the answer: that the surface is read off the **path**, for
// every path a page can be served at, and that the messages a public request is handed are that
// page's own and nothing else.
//
// And one thing only the proxy can do for the review link (R14): a `HEAD` and a browser's
// fetch-ahead are not a client opening it, and a page cannot tell — it never learns the method.
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

/** What the proxy wrote on the request, swapped per test. */
const surfaceHeader = { current: null as string | null };

// On the server `getRequestConfig` is the identity function — it exists to type the callback — but
// the package resolves to its client shim outside a React Server environment, and that shim throws.
// Mocking it is what lets the test call **the real callback**, which is the thing that decides.
vi.mock("next-intl/server", () => ({ getRequestConfig: (callback: unknown) => callback }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers(surfaceHeader.current ? { "x-surface": surfaceHeader.current } : {}),
  cookies: async () => ({ get: () => undefined }),
}));

/** Whether there is really somebody behind the request, swapped per test — and the language on their account, if any. */
const signedIn = { current: true, locale: null as string | null };
vi.mock("@/modules/platform/auth/session", () => ({
  getCurrentUser: async () => (signedIn.current ? { userId: "u1", preferences: { locale: signedIn.locale, theme: null } } : null),
}));

/** The public domain, when a test gives the product one (`src/lib/site.ts` reads it from the environment). */
const publicDomain = { current: null as { origin: string; host: string } | null };
vi.mock("@/lib/site", () => ({ publicSite: () => publicDomain.current }));

// The proxy also writes the page's Content-Security-Policy (`tests/proxy-csp.test.ts` covers it),
// which reads the configuration; this file is about surfaces, so the policy is off.
vi.mock("@/lib/env", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/env")>()), env: () => ({ CSP_MODE: "off" }) }));

import { config, proxy } from "@/proxy";
import requestConfig from "@/i18n/request";
import { namespacesForSurface, pickMessages, SURFACE_HEADER, surfaceForPath } from "@/i18n/surfaces";
import catalogue from "../messages/vi.json";

/** The namespaces nothing outside the company may ever be handed. */
const INTERNAL = ["payroll", "people", "rbac", "roles", "audit", "work", "projects", "daily", "leave", "attendance", "assets", "performance", "recruit"] as const;

/** The namespaces every public page carries besides its own: the theme switch, and the words inside a select. */
const THEME = "theme";
const CONTROLS = "controls";

/** The messages the real request config returns for a request the proxy marked `surface`. */
async function messagesFor(surface: string | null, session = true): Promise<Record<string, unknown>> {
  surfaceHeader.current = surface;
  signedIn.current = session;
  const result = await requestConfig({ locale: undefined, requestLocale: Promise.resolve(undefined) });
  return (result.messages ?? {}) as Record<string, unknown>;
}

describe("which language a request is in", () => {
  /** The locale the request config settles on, for a request the proxy marked `surface`. */
  async function localeFor(surface: string | null, accountLocale: string | null): Promise<string> {
    surfaceHeader.current = surface;
    signedIn.current = true;
    signedIn.locale = accountLocale;
    try {
      return (await requestConfig({ locale: undefined, requestLocale: Promise.resolve(undefined) })).locale;
    } finally {
      signedIn.locale = null;
    }
  }

  it("follows the account of a signed-in person, so the choice reaches every device", async () => {
    expect(await localeFor("app", "en")).toBe("en");
    expect(await localeFor("app", "vi")).toBe("vi");
  });

  it("falls back to the default where the account never chose (the cookie is empty here)", async () => {
    expect(await localeFor("app", null)).toBe("vi");
  });

  it("never looks the person up for a public page, so the account cannot decide there", async () => {
    expect(await localeFor("preview", "en")).toBe("vi");
  });
});

describe("which surface a path is", () => {
  it("reads the public pages off the path, however the path ends", () => {
    expect(surfaceForPath("/preview/AbC-123_xyz")).toBe("preview");
    // The one that leaked: `[token]` matches anything, and a token ending in an image extension
    // used to slip past the proxy's matcher and be served the whole catalogue.
    expect(surfaceForPath("/preview/anything.png")).toBe("preview");
    // The file behind a review link is a route of the same surface, checked by the same token.
    expect(surfaceForPath("/preview/AbC-123_xyz/file")).toBe("preview");
    expect(surfaceForPath("/preview/AbC-123_xyz/decide")).toBe("preview");
    expect(surfaceForPath("/careers")).toBe("careers");
    expect(surfaceForPath("/careers/video-editor/apply")).toBe("careers");
    expect(surfaceForPath("/careers/assignment/AbC")).toBe("careers");
    expect(surfaceForPath("/sign-in")).toBe("signIn");
    // The public site Google's OAuth review reads: the home page and the two policies.
    expect(surfaceForPath("/")).toBe("site");
    expect(surfaceForPath("/privacy")).toBe("site");
    expect(surfaceForPath("/terms")).toBe("site");
    // The public domain's own home page (src/lib/site-routing.ts).
    expect(surfaceForPath("/portfolio")).toBe("portfolio");
    // The check-in kiosk on a wall tablet: whoever opened it was signed out in the same step.
    expect(surfaceForPath("/kiosk")).toBe("kiosk");
    // The brand guidelines and their downloads (FR-BRD-04); the editor under /admin stays the app.
    expect(surfaceForPath("/brands")).toBe("brands");
    expect(surfaceForPath("/brands/suzu-coffee/files/0a1b")).toBe("brands");
  });

  it("calls everything else the app, and nothing else public", () => {
    // The home page is public only as itself: `/` is not a prefix of every path.
    for (const path of ["/today", "/work/tasks/abc", "/payroll/runs/1", "/previewing", "/careersy", "/kiosks", "/attendance/kiosk", "/privacy-settings", "/termsheet", "//", "/brandsx", "/admin/brands"]) {
      expect(surfaceForPath(path), path).toBe("app");
    }
  });

  it("is looked for on every path a page can be served at", () => {
    // Next's matcher is a plain pattern over the pathname here, with no parameters in it.
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of [
      "/",
      "/today",
      "/preview/abc",
      "/preview/anything.png",
      "/preview/abc/file",
      "/preview/anything.png/file",
      "/careers",
      "/careers/video-editor",
      "/sign-in",
      "/privacy",
      "/terms",
      "/portfolio",
      "/brands/suzu-coffee",
      "/brands/suzu-coffee/files/0a1b",
      "/api/cronies",
    ]) {
      expect(matcher.test(path), path).toBe(true);
    }
    // The installable app's files and the two routes that authenticate for themselves come through
    // too, so the public domain can refuse them; the app's domain lets them past (site-routing.ts).
    for (const path of ["/sw.js", "/offline.html", "/manifest.webmanifest", "/api/auth/callback", "/api/cron/work-preview-sweep"]) {
      expect(matcher.test(path), path).toBe(true);
    }
    // Files that are served as they are.
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/icons/icon-192.png", "/favicon.ico", "/robots.txt", "/next.svg"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});

describe("a review link asked for by something that is not a person (R14)", () => {
  afterEach(() => {
    publicDomain.current = null;
  });

  const BROWSER = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const ask = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(url, { method: init.method ?? "GET", headers: { "user-agent": BROWSER, ...init.headers } }));
  /** Whether the proxy handed the request on to a page or a route, rather than answering it. */
  const passedOn = (response: Response) => response.headers.get("x-middleware-next") === "1";
  const guarded = (response: Response) => ({ cache: response.headers.get("cache-control"), robots: response.headers.get("x-robots-tag"), referrer: response.headers.get("referrer-policy") });
  const GUARDED = { cache: "private, no-store, max-age=0", robots: "noindex, nofollow, noarchive, nosnippet", referrer: "no-referrer" };

  it("answers a HEAD itself: no page is rendered, so nothing is counted as a view", async () => {
    for (const path of ["/preview/AbC-123_xyz", "/preview/AbC-123_xyz/file", "/preview/anything.png"]) {
      const response = ask(`https://suzu.one${path}`, { method: "HEAD" });
      expect([response.status, passedOn(response), response.headers.get("location")], path).toEqual([200, false, null]);
      expect(guarded(response), path).toEqual(GUARDED);
      expect(await response.text()).toBe("");
    }
  });

  it("declines a browser fetching ahead of its person, so what it shows them later is the page and not a stale answer", async () => {
    const aheadOfTheirPerson: Record<string, string>[] = [{ "sec-purpose": "prefetch" }, { "sec-purpose": "prefetch;prerender" }, { purpose: "prefetch" }, { "x-moz": "prefetch" }];
    for (const headers of aheadOfTheirPerson) {
      const response = ask("https://suzu.one/preview/AbC-123_xyz", { headers });
      expect([response.status, passedOn(response)], JSON.stringify(headers)).toEqual([503, false]);
      expect(guarded(response)).toEqual(GUARDED);
      expect(await response.text()).toBe("");
    }
  });

  it("hands everything else on: a person's GET, a chat app's (the page decides what it is shown), and the client's answer", () => {
    for (const init of [{}, { headers: { "user-agent": "facebookexternalhit/1.1" } }, { method: "POST" }]) {
      const response = ask("https://suzu.one/preview/AbC-123_xyz", init);
      expect(passedOn(response), JSON.stringify(init)).toBe(true);
      expect(response.headers.get("x-middleware-request-x-surface")).toBe("preview");
    }
  });

  it("is the review link's rule and nobody else's", () => {
    // The careers page is an advertisement: a crawler's HEAD and a prefetch are welcome to it.
    expect(passedOn(ask("https://suzu.one/careers", { method: "HEAD" }))).toBe(true);
    expect(passedOn(ask("https://suzu.one/careers", { headers: { "sec-purpose": "prefetch" } }))).toBe(true);
    // Inside the app a HEAD without a session is sent to sign in, like anything else.
    const inside = ask("https://suzu.one/today", { method: "HEAD" });
    expect(inside.headers.get("location")).toBe("https://suzu.one/sign-in");
  });

  it("holds on the public domain, and the app's domain still sends the link over first", () => {
    publicDomain.current = { origin: "https://suzu.vn", host: "suzu.vn" };
    expect(ask("https://suzu.vn/preview/AbC-123_xyz", { method: "HEAD" }).status).toBe(200);
    expect(ask("https://suzu.vn/preview/AbC-123_xyz", { headers: { "sec-purpose": "prefetch" } }).status).toBe(503);
    const moved = ask("https://suzu.one/preview/AbC-123_xyz", { method: "HEAD" });
    expect([moved.status, moved.headers.get("location")]).toEqual([308, "https://suzu.vn/preview/AbC-123_xyz"]);
  });
});

describe("which words a request is handed", () => {
  it("gives a client on a review link the review page's namespace and nothing else", async () => {
    const messages = await messagesFor("preview");
    expect(Object.keys(messages)).toEqual(["preview", THEME, CONTROLS]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
    // Not a word of the compensation screens travels with it, at any depth.
    expect(JSON.stringify(messages)).not.toContain(JSON.stringify(catalogue.payroll).slice(0, 120));
    // It is the page's own vocabulary, not a subset of the catalogue by accident.
    expect(messages.preview).toEqual(catalogue.preview);
  });

  it("gives a candidate the careers pages' words, without the rest of recruitment", async () => {
    const messages = await messagesFor("careers");
    expect(Object.keys(messages)).toEqual(["recruit", THEME, CONTROLS]);
    expect(Object.keys(messages.recruit as object).sort()).toEqual(["assignment", "careers"]);
  });

  it("gives a partner on the brand guidelines their words, without the editor's", async () => {
    const messages = await messagesFor("brands", false);
    expect(Object.keys(messages).sort()).toEqual(["brands", CONTROLS, THEME]);
    expect(Object.keys(messages.brands as object)).toEqual(["public"]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
  });

  it("gives a visitor to the public site its own words and the policies, nothing internal", async () => {
    const messages = await messagesFor("site", false);
    expect(Object.keys(messages).sort()).toEqual(["app", CONTROLS, "legal", "site", THEME]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
    expect(messages.legal).toEqual(catalogue.legal);
  });

  it("gives the maintenance page its two sentences and nothing of the app", async () => {
    const messages = await messagesFor("maintenance", false);
    expect(Object.keys(messages).sort()).toEqual([CONTROLS, "maintenance", THEME]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
  });

  it("gives the kiosk on the wall its screen's words and nothing of the app", async () => {
    const messages = await messagesFor("kiosk", false);
    expect(Object.keys(messages).sort()).toEqual([CONTROLS, "kiosk", THEME]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
    expect(messages.kiosk).toEqual(catalogue.kiosk);
  });

  it("gives a visitor to the public domain's home page its words and nothing of the app", async () => {
    const messages = await messagesFor("portfolio", false);
    expect(Object.keys(messages).sort()).toEqual([CONTROLS, "portfolio", THEME]);
    expect(messages.portfolio).toEqual(catalogue.portfolio);
  });

  it("hands the whole catalogue only to the app's own pages", async () => {
    const app = await messagesFor("app");
    expect(Object.keys(app)).toEqual(Object.keys(catalogue));
    // And what that means in kilobytes, which is the reason any of this exists.
    const publicSize = JSON.stringify(await messagesFor("preview")).length;
    expect(publicSize * 20).toBeLessThan(JSON.stringify(app).length);
  });

  it("keeps the catalogue from an internal path that nobody is actually signed in on", async () => {
    // The proxy only looks for a session *cookie*, so a stranger who invents one reaches an
    // internal path; the page redirects them to sign in, but Next sends the rendered layout with
    // that redirect — half a megabyte of payroll, salary and permission vocabulary — unless the
    // words wait for a session that exists.
    const messages = await messagesFor("app", false);
    for (const namespace of INTERNAL.filter((name) => name !== "recruit")) expect(messages[namespace], namespace).toBeUndefined();
    expect(Object.keys(messages).sort()).toEqual(["app", "brands", CONTROLS, "kiosk", "legal", "maintenance", "portfolio", "preview", "recruit", "signIn", "site", THEME]);
    // Recruitment only as far as the careers pages: no pipelines, no candidates, no scorecards.
    expect(Object.keys(messages.recruit as object).sort()).toEqual(["assignment", "careers"]);
    // And the page they were on is a redirect to sign-in, whose words are among the ones left.
    expect(messages.signIn).toEqual(catalogue.signIn);
  });

  it("treats a request the proxy never marked as public, not as the app", async () => {
    for (const marker of [null, "", "unknown", "APP", "app-ish"]) {
      const messages = await messagesFor(marker);
      expect(JSON.stringify(messages), String(marker)).not.toContain('"payroll":');
      expect(Object.keys(messages).sort(), String(marker)).toEqual(["app", "brands", CONTROLS, "kiosk", "legal", "maintenance", "portfolio", "preview", "recruit", "signIn", "site", THEME]);
    }
  });

  it("cannot be talked into the catalogue by the request itself", () => {
    // The header is written by the proxy from the path and never copied from what arrived, and the
    // only value that unlocks everything is the one the proxy writes for its own pages.
    expect(SURFACE_HEADER).toBe("x-surface");
    expect(namespacesForSurface("app")).toBeNull();
    expect(namespacesForSurface(surfaceForPath("/preview/x.png"))).toEqual(["preview", THEME, CONTROLS]);
  });
});

describe("cutting the catalogue down", () => {
  it("keeps the shape a dotted namespace names, and skips what is not there", () => {
    const all = { recruit: { careers: { brand: "SuZu" }, pipeline: { stage: "Sàng lọc" } }, payroll: { title: "Lương" } };
    expect(pickMessages(all, ["recruit.careers"])).toEqual({ recruit: { careers: { brand: "SuZu" } } });
    expect(pickMessages(all, ["nothing.here"])).toEqual({});
  });
});
