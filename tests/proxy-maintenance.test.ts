// Maintenance (MAINTENANCE_MODE, docs/runbooks/restore.md): while the database is restored, every
// page is the maintenance page and every other request a bare 503 — the API routes the proxy
// otherwise lets past and the cron included — so nothing is read or written.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = { MAINTENANCE_MODE: "off" as "on" | "off" };
vi.mock("@/lib/env", () => ({
  env: () => ({ ...settings, CSP_MODE: "report-only", BETTER_AUTH_URL: "https://suzu.one", r2Endpoint: undefined, NEXT_PUBLIC_SENTRY_DSN: undefined, SENTRY_DSN: undefined }),
  isDevelopmentEnvironment: () => false,
}));

import { proxy } from "@/proxy";

const PAGE = { accept: "text/html,application/xhtml+xml", "sec-fetch-dest": "document" };
const ask = (url: string, init: { method?: string; headers?: Record<string, string> } = {}) => proxy(new NextRequest(url, { method: init.method ?? "GET", headers: { host: new URL(url).host, ...init.headers } }));
const rewrittenTo = (response: Response) => response.headers.get("x-middleware-rewrite");

beforeEach(() => {
  settings.MAINTENANCE_MODE = "off";
});

describe("maintenance mode", () => {
  it("is off by default: pages and the API behave as ever", () => {
    expect(ask("https://suzu.one/today", { headers: PAGE }).headers.get("location")).toBe("https://suzu.one/sign-in");
    expect(ask("https://suzu.one/api/cron/morning").status).toBe(200);
  });

  it("shows every page as the maintenance page, signed in or not, with a 503", () => {
    settings.MAINTENANCE_MODE = "on";
    for (const path of ["/today", "/people/123", "/sign-in", "/careers", "/"]) {
      const response = ask(`https://suzu.one${path}`, { headers: { ...PAGE, cookie: "better-auth.session_token=abc.def" } });
      expect(new URL(rewrittenTo(response)!).pathname).toBe("/maintenance");
      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("600");
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("answers everything else with a bare 503: actions, the router's fetches, the API, the cron, the health check", () => {
    settings.MAINTENANCE_MODE = "on";
    const requests = [
      ask("https://suzu.one/today", { method: "POST", headers: { ...PAGE, "next-action": "abc" } }),
      ask("https://suzu.one/today", { headers: { rsc: "1", accept: "text/x-component" } }),
      ask("https://suzu.one/api/cron/morning", { headers: { authorization: "Bearer x" } }),
      ask("https://suzu.one/api/health"),
      ask("https://suzu.one/api/auth/callback/google", { headers: PAGE }),
      ask("https://suzu.one/api/telegram/webhook", { method: "POST" }),
    ];
    for (const response of requests) {
      expect(response.status).toBe(503);
      expect(rewrittenTo(response)).toBeNull();
      expect(response.headers.get("x-middleware-next")).toBeNull();
    }
  });
});
