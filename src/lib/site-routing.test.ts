import { describe, expect, it } from "vitest";
import { routeRequest } from "./site-routing";

const PUBLIC = "suzu.vn";
const on = (host: string, pathname: string, publicHost: string | null = PUBLIC) => routeRequest({ host, pathname, publicHost });

describe("routeRequest", () => {
  describe("on the public domain", () => {
    it("serves its own home page at /", () => {
      expect(on("suzu.vn", "/")).toEqual({ kind: "public", rewrite: "/portfolio" });
    });

    it("serves the review links and the careers pages", () => {
      for (const path of ["/preview/abc", "/preview/abc/decide", "/careers", "/careers/editor", "/careers/assignment/tok/submit"]) {
        expect(on("suzu.vn", path)).toEqual({ kind: "public" });
      }
    });

    it("serves nothing of the app", () => {
      for (const path of ["/sign-in", "/today", "/privacy", "/portfolio", "/api/auth/session", "/api/cron/daily", "/sw.js", "/manifest.webmanifest", "/careersx", "/previews"]) {
        expect(on("suzu.vn", path)).toEqual({ kind: "notFound" });
      }
    });

    it("matches the host case-insensitively, and lets the platform's endpoints through", () => {
      expect(on("SUZU.VN", "/careers")).toEqual({ kind: "public" });
      expect(on("suzu.vn", "/_vercel/insights/view")).toEqual({ kind: "pass" });
    });

    it("tells a port apart", () => {
      expect(on("suzu.localhost:3000", "/", "suzu.localhost:3000")).toEqual({ kind: "public", rewrite: "/portfolio" });
      expect(on("suzu.localhost:4000", "/", "suzu.localhost:3000")).toEqual({ kind: "app" });
    });
  });

  describe("on the app's domain, with a public domain configured", () => {
    it("sends the public pages over, path intact", () => {
      expect(on("suzu.one", "/preview/abc")).toEqual({ kind: "redirect", path: "/preview/abc" });
      expect(on("suzu.one", "/careers")).toEqual({ kind: "redirect", path: "/careers" });
      expect(on("suzu.one", "/portfolio")).toEqual({ kind: "redirect", path: "/" });
    });

    it("keeps everything else", () => {
      expect(on("suzu.one", "/")).toEqual({ kind: "app" });
      expect(on("suzu.one", "/sign-in")).toEqual({ kind: "app" });
      expect(on("suzu.one", "/careersx")).toEqual({ kind: "app" });
      expect(on("suzu.one", "/api/auth/callback/google")).toEqual({ kind: "pass" });
      expect(on("suzu.one", "/sw.js")).toEqual({ kind: "pass" });
    });
  });

  describe("with no public domain", () => {
    it("serves everything on the one domain", () => {
      expect(on("suzu.one", "/careers", null)).toEqual({ kind: "app" });
      expect(on("suzu.one", "/preview/abc", null)).toEqual({ kind: "app" });
      expect(on("suzu.one", "/portfolio", null)).toEqual({ kind: "app" });
      expect(on("suzu.one", "/api/cron/daily", null)).toEqual({ kind: "pass" });
    });
  });
});
