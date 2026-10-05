// What the proxy says about a page's Content-Security-Policy (NFR-SEC-01): the same policy on
// the request (where Next reads the nonce) and on the response (for the browser), the header the
// configured mode names, a nonce of each request's own, and nothing taken from the caller.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { CSP_MODE: "report-only" as "report-only" | "enforce" | "off", PUBLIC_SITE_URL: undefined as string | undefined };
vi.mock("@/lib/env", () => ({
  env: () => ({ ...settings, BETTER_AUTH_URL: "https://suzu.one", r2Endpoint: "https://account.r2.cloudflarestorage.com", NEXT_PUBLIC_SENTRY_DSN: "https://key@o1.ingest.sentry.io/2", SENTRY_DSN: undefined }),
  isDevelopmentEnvironment: () => false,
}));

import { proxy } from "@/proxy";

const REPORT_ONLY = "content-security-policy-report-only";
const ENFORCED = "content-security-policy";
/** How `NextResponse.next({ request: { headers } })` carries a request header to the page. */
const onRequest = (response: Response, name: string) => response.headers.get(`x-middleware-request-${name}`);

const SESSION = "better-auth.session_token=abc.def";
const ask = (url: string, headers: Record<string, string> = {}) => proxy(new NextRequest(url, { headers: { host: new URL(url).host, ...headers } }));

beforeEach(() => {
  settings.CSP_MODE = "report-only";
  settings.PUBLIC_SITE_URL = undefined;
});

describe("the proxy's Content-Security-Policy", () => {
  it("is report-only by default, the same on the request and on the response", () => {
    const response = ask("https://suzu.one/today", { cookie: SESSION });
    const sent = response.headers.get(REPORT_ONLY)!;
    expect(sent).toContain("default-src 'self'");
    expect(sent).toContain("frame-ancestors 'none'");
    expect(sent).toContain("https://account.r2.cloudflarestorage.com");
    expect(sent).toContain("report-uri https://o1.ingest.sentry.io/api/2/security/?sentry_key=key");
    expect(response.headers.get(ENFORCED)).toBeNull();
    // Next finds the nonce on the request header and puts it on its scripts.
    expect(onRequest(response, REPORT_ONLY)).toBe(sent);
  });

  it("enforces the same policy when the configuration says so, and sends nothing when off", () => {
    settings.CSP_MODE = "enforce";
    const enforced = ask("https://suzu.one/today", { cookie: SESSION });
    expect(enforced.headers.get(ENFORCED)).toContain("script-src 'self' 'nonce-");
    expect(enforced.headers.get(REPORT_ONLY)).toBeNull();
    expect(onRequest(enforced, ENFORCED)).toBe(enforced.headers.get(ENFORCED));

    settings.CSP_MODE = "off";
    const off = ask("https://suzu.one/today", { cookie: SESSION });
    expect(off.headers.get(ENFORCED)).toBeNull();
    expect(off.headers.get(REPORT_ONLY)).toBeNull();
  });

  it("makes a nonce for each request", () => {
    const nonce = () => /'nonce-([^']+)'/.exec(ask("https://suzu.one/today", { cookie: SESSION }).headers.get(REPORT_ONLY)!)![1];
    expect(nonce()).not.toBe(nonce());
  });

  it("never passes on a policy the caller sent", () => {
    // A request carrying its own policy would otherwise hand Next a nonce of the caller's choosing.
    settings.CSP_MODE = "off";
    const response = ask("https://suzu.one/today", { cookie: SESSION, [ENFORCED]: "script-src 'nonce-chosen'", [REPORT_ONLY]: "script-src 'nonce-chosen'" });
    expect(response.headers.get("x-middleware-override-headers")?.split(",")).not.toEqual(expect.arrayContaining([ENFORCED]));
    expect(onRequest(response, ENFORCED)).toBeNull();
    expect(onRequest(response, REPORT_ONLY)).toBeNull();

    settings.CSP_MODE = "report-only";
    const reported = ask("https://suzu.one/today", { cookie: SESSION, [ENFORCED]: "script-src 'nonce-chosen'", [REPORT_ONLY]: "script-src 'nonce-chosen'" });
    expect(onRequest(reported, REPORT_ONLY)).not.toContain("nonce-chosen");
    expect(onRequest(reported, ENFORCED)).toBeNull();
  });

  it("lets only the kiosk and the internal app compile WebAssembly", () => {
    const scripts = (url: string, cookie = "") => /script-src ([^;]+)/.exec(ask(url, cookie ? { cookie } : {}).headers.get(REPORT_ONLY)!)![1];
    expect(scripts("https://suzu.one/kiosk")).toContain("'wasm-unsafe-eval'");
    expect(scripts("https://suzu.one/attendance/kiosk/faces", SESSION)).toContain("'wasm-unsafe-eval'");
    for (const path of ["/careers", "/careers/editor", "/preview/abc", "/brands/suzu", "/sign-in", "/", "/privacy"]) expect(scripts(`https://suzu.one${path}`), path).not.toContain("'wasm-unsafe-eval'");
  });

  it("covers the public domain's pages, the rewritten home page among them", () => {
    settings.PUBLIC_SITE_URL = "https://suzu.vn";
    for (const path of ["/", "/careers", "/preview/abc", "/brands/suzu"]) {
      const response = ask(`https://suzu.vn${path}`);
      expect(response.headers.get(REPORT_ONLY), path).toContain("frame-ancestors 'none'");
      expect(response.headers.get(REPORT_ONLY), path).not.toContain("'wasm-unsafe-eval'");
      expect(onRequest(response, REPORT_ONLY), path).toBe(response.headers.get(REPORT_ONLY));
    }
  });

  it("leaves alone what answers no page: self-authenticating endpoints, the service worker, a redirect", () => {
    for (const path of ["/api/kiosk/punch", "/api/attendance/device/punches", "/api/auth/session", "/sw.js", "/_vercel/insights/view"]) {
      const response = ask(`https://suzu.one${path}`);
      expect(response.headers.get(REPORT_ONLY), path).toBeNull();
      expect(response.headers.get(ENFORCED), path).toBeNull();
    }
    // Signed out on an app page: sent to sign in, which then carries its own policy.
    const redirect = ask("https://suzu.one/today");
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get(REPORT_ONLY)).toBeNull();
  });
});
