// What an anonymous visitor's browser is given.
//
// The product has two pages the internet can open — the careers page (FR-REC-03) and the client's
// review link (D24, FR-PJM-51a) — and one more a signed-out person lands on, the sign-in page. The
// root layout's `NextIntlClientProvider` **serialises whatever `src/i18n/request.ts` returns into
// the page**, so the whole internal vocabulary (payroll screens, salary fields, everybody's job
// titles, the permission names) would otherwise arrive in the browser of a stranger holding a
// review link — half a megabyte of it.
//
// These tests hold the two halves of the answer: that the surface is read off the **path**, for
// every path a page can be served at, and that the messages a public request is handed are that
// page's own and nothing else.
import { describe, expect, it, vi } from "vitest";

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

import { config } from "@/proxy";
import requestConfig from "@/i18n/request";
import { namespacesForSurface, pickMessages, SURFACE_HEADER, surfaceForPath } from "@/i18n/surfaces";
import catalogue from "../messages/vi.json";

/** The namespaces nothing outside the company may ever be handed. */
const INTERNAL = ["payroll", "people", "rbac", "roles", "audit", "work", "projects", "daily", "leave", "attendance", "assets", "performance", "recruit"] as const;

/** The messages the real request config returns for a request the proxy marked `surface`. */
async function messagesFor(surface: string | null): Promise<Record<string, unknown>> {
  surfaceHeader.current = surface;
  const result = await requestConfig({ locale: undefined, requestLocale: Promise.resolve(undefined) });
  return (result.messages ?? {}) as Record<string, unknown>;
}

describe("which surface a path is", () => {
  it("reads the public pages off the path, however the path ends", () => {
    expect(surfaceForPath("/preview/AbC-123_xyz")).toBe("preview");
    // The one that leaked: `[token]` matches anything, and a token ending in an image extension
    // used to slip past the proxy's matcher and be served the whole catalogue.
    expect(surfaceForPath("/preview/anything.png")).toBe("preview");
    expect(surfaceForPath("/careers")).toBe("careers");
    expect(surfaceForPath("/careers/video-editor/apply")).toBe("careers");
    expect(surfaceForPath("/careers/assignment/AbC")).toBe("careers");
    expect(surfaceForPath("/sign-in")).toBe("signIn");
  });

  it("calls everything else the app, and nothing else public", () => {
    for (const path of ["/", "/today", "/work/tasks/abc", "/payroll/runs/1", "/previewing", "/careersy"]) {
      expect(surfaceForPath(path), path).toBe("app");
    }
  });

  it("is looked for on every path a page can be served at", () => {
    // Next's matcher is a plain pattern over the pathname here, with no parameters in it.
    const matcher = new RegExp(`^${config.matcher[0]}$`);
    for (const path of ["/", "/today", "/preview/abc", "/preview/anything.png", "/careers", "/careers/video-editor", "/sign-in", "/api/cronies"]) {
      expect(matcher.test(path), path).toBe(true);
    }
    // Files that are served as they are, and the two routes that authenticate for themselves.
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/icons/icon-192.png", "/favicon.ico", "/sw.js", "/offline.html", "/manifest.webmanifest", "/next.svg", "/api/auth/callback", "/api/cron/work-preview-sweep"]) {
      expect(matcher.test(path), path).toBe(false);
    }
  });
});

describe("which words a request is handed", () => {
  it("gives a client on a review link the review page's namespace and nothing else", async () => {
    const messages = await messagesFor("preview");
    expect(Object.keys(messages)).toEqual(["preview"]);
    for (const namespace of INTERNAL) expect(messages[namespace], namespace).toBeUndefined();
    // Not a word of the compensation screens travels with it, at any depth.
    expect(JSON.stringify(messages)).not.toContain(JSON.stringify(catalogue.payroll).slice(0, 120));
    // It is the page's own vocabulary, not a subset of the catalogue by accident.
    expect(messages.preview).toEqual(catalogue.preview);
  });

  it("gives a candidate the careers pages' words, without the rest of recruitment", async () => {
    const messages = await messagesFor("careers");
    expect(Object.keys(messages)).toEqual(["recruit"]);
    expect(Object.keys(messages.recruit as object).sort()).toEqual(["assignment", "careers"]);
  });

  it("hands the whole catalogue only to the app's own pages", async () => {
    const app = await messagesFor("app");
    expect(Object.keys(app)).toEqual(Object.keys(catalogue));
    // And what that means in kilobytes, which is the reason any of this exists.
    const publicSize = JSON.stringify(await messagesFor("preview")).length;
    expect(publicSize * 20).toBeLessThan(JSON.stringify(app).length);
  });

  it("treats a request the proxy never marked as public, not as the app", async () => {
    for (const marker of [null, "", "unknown", "APP", "app-ish"]) {
      const messages = await messagesFor(marker);
      expect(JSON.stringify(messages), String(marker)).not.toContain('"payroll":');
      expect(Object.keys(messages).sort(), String(marker)).toEqual(["app", "preview", "recruit", "signIn"]);
    }
  });

  it("cannot be talked into the catalogue by the request itself", () => {
    // The header is written by the proxy from the path and never copied from what arrived, and the
    // only value that unlocks everything is the one the proxy writes for its own pages.
    expect(SURFACE_HEADER).toBe("x-surface");
    expect(namespacesForSurface("app")).toBeNull();
    expect(namespacesForSurface(surfaceForPath("/preview/x.png"))).toEqual(["preview"]);
  });
});

describe("cutting the catalogue down", () => {
  it("keeps the shape a dotted namespace names, and skips what is not there", () => {
    const all = { recruit: { careers: { brand: "SuZu" }, pipeline: { stage: "Sàng lọc" } }, payroll: { title: "Lương" } };
    expect(pickMessages(all, ["recruit.careers"])).toEqual({ recruit: { careers: { brand: "SuZu" } } });
    expect(pickMessages(all, ["nothing.here"])).toEqual({});
  });
});
