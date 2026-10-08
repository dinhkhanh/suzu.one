// The Content-Security-Policy: each directive and why it holds what it holds, the face engine's
// exception, and the one switch between reporting and enforcing.
import { describe, expect, it } from "vitest";
import { PUBLIC_SURFACES } from "@/i18n/surfaces";
import { EMBED_FRAME_ORIGINS, EMBED_PROVIDERS, normalizeEmbed } from "@/modules/platform/rich-text/engine/embed";
import { contentSecurityPolicy, type CspInput, cspDirectives, newNonce, originOf, sentryCsp } from "./csp";

const STORAGE = "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com";
const DSN = "https://publickey@o4507.ingest.us.sentry.io/4508";
const input = (over: Partial<CspInput> = {}): CspInput => ({ nonce: "Tm9uY2U", surface: "app", development: false, storageOrigin: STORAGE, sentry: sentryCsp(DSN), ...over });
const policy = (over: Partial<CspInput> = {}, enforcing = false) => new Map(cspDirectives(input(over), enforcing));

describe("the policy, directive by directive", () => {
  it("lets scripts run by nonce, and what those load — never inline, never eval", () => {
    expect(policy({ surface: "careers" }).get("script-src")).toEqual(["'self'", "'nonce-Tm9uY2U'", "'strict-dynamic'"]);
    for (const surface of ["app", "kiosk", ...PUBLIC_SURFACES.map((each) => each.name)]) {
      const scripts = policy({ surface }).get("script-src")!;
      expect(scripts, surface).not.toContain("'unsafe-inline'");
      expect(scripts, surface).not.toContain("'unsafe-eval'");
    }
  });

  it("carries the nonce where Next looks for it", () => {
    // Next reads the first `'nonce-…'` of script-src off the request header (get-script-nonce-from-header).
    const nonce = newNonce();
    const sent = contentSecurityPolicy("report-only", input({ nonce }))!.value;
    const scripts = sent
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src"))!;
    expect(
      scripts
        .split(/\s+/)
        .map((source) => /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/.exec(source)?.[1])
        .find(Boolean),
    ).toBe(nonce);
    expect(newNonce()).not.toBe(nonce);
  });

  it("keeps everything unnamed on this origin, with no plugins, no foreign base and no foreign form target", () => {
    const sent = policy();
    expect(sent.get("default-src")).toEqual(["'self'"]);
    expect(sent.get("object-src")).toEqual(["'none'"]);
    expect(sent.get("base-uri")).toEqual(["'self'"]);
    expect(sent.get("form-action")).toEqual(["'self'"]);
    expect(sent.get("font-src")).toEqual(["'self'"]);
    expect(sent.get("manifest-src")).toEqual(["'self'"]);
    expect(sent.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("is framed by nobody, on every surface", () => {
    for (const surface of ["app", "kiosk", ...PUBLIC_SURFACES.map((each) => each.name)]) expect(policy({ surface }).get("frame-ancestors"), surface).toEqual(["'none'"]);
  });

  it("frames a PDF preview and the editor's embed providers, and nothing else", () => {
    expect(policy().get("frame-src")).toEqual(["blob:", "https://www.youtube-nocookie.com", "https://drive.google.com", "https://docs.google.com", "https://www.figma.com", "https://www.canva.com"]);
  });

  it("allows every address the embed rules can produce — the two lists cannot drift apart", () => {
    const samples: Record<(typeof EMBED_PROVIDERS)[number], string> = {
      youtube: "https://youtu.be/dQw4w9WgXcQ",
      google_drive: "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
      google_docs: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOp/edit",
      figma: "https://www.figma.com/design/AbCdEfGh1234/Name",
      canva: "https://www.canva.com/design/DAFabcdefg/AbCdEfGhIj/view",
    };
    const frames = policy().get("frame-src")!;
    for (const provider of EMBED_PROVIDERS) {
      const embed = normalizeEmbed(samples[provider]);
      expect(embed?.provider, provider).toBe(provider);
      expect(new URL(embed!.src).origin, provider).toBe(EMBED_FRAME_ORIGINS[provider]);
      expect(frames, provider).toContain(new URL(embed!.src).origin);
    }
  });

  it("reaches the file bucket for uploads, previews and media, and Sentry for errors", () => {
    const sent = policy();
    expect(sent.get("connect-src")).toEqual(["'self'", STORAGE, "https://o4507.ingest.us.sentry.io"]);
    expect(sent.get("media-src")).toEqual(["'self'", "blob:", STORAGE]);
    // Pictures: any https address (a note's picture, a Google profile picture, a signed link) — the bucket is one.
    expect(sent.get("img-src")).toEqual(["'self'", "data:", "blob:", "https:"]);
    // A development store over plain http is not covered by `https:`, so it is named.
    expect(policy({ storageOrigin: "http://localhost:9000" }).get("img-src")).toEqual(["'self'", "data:", "blob:", "https:", "http://localhost:9000"]);
  });

  it("names no bucket and no Sentry where none is configured", () => {
    const sent = policy({ storageOrigin: null, sentry: null });
    expect(sent.get("connect-src")).toEqual(["'self'"]);
    expect(sent.get("media-src")).toEqual(["'self'", "blob:"]);
    expect(sent.has("report-uri")).toBe(false);
  });

  it("allows React's eval on a developer's machine only", () => {
    expect(policy({ development: true }).get("script-src")).toContain("'unsafe-eval'");
    expect(policy({ development: false }).get("script-src")).not.toContain("'unsafe-eval'");
  });
});

describe("the face engine's exception", () => {
  it("lets the kiosk and the internal app compile WebAssembly and start a worker from a blob", () => {
    for (const surface of ["kiosk", "app"]) {
      expect(policy({ surface }).get("script-src"), surface).toEqual(["'self'", "'nonce-Tm9uY2U'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
      expect(policy({ surface }).get("worker-src"), surface).toEqual(["'self'", "blob:"]);
    }
  });

  it("gives no public surface either — and an unknown surface is treated as public", () => {
    const outside = PUBLIC_SURFACES.map((each) => each.name).filter((name) => name !== "kiosk");
    expect(outside).toEqual(expect.arrayContaining(["preview", "careers", "brands", "portfolio", "signIn", "site"]));
    for (const surface of [...outside, "", "APP", "unknown"]) {
      expect(policy({ surface }).get("script-src"), surface).not.toContain("'wasm-unsafe-eval'");
      expect(policy({ surface }).get("worker-src"), surface).toEqual(["'self'"]);
    }
  });

  it("is otherwise the same policy on every surface", () => {
    const rest = (surface: string) => cspDirectives(input({ surface }), false).filter(([directive]) => directive !== "script-src" && directive !== "worker-src");
    expect(rest("careers")).toEqual(rest("app"));
    expect(rest("kiosk")).toEqual(rest("app"));
  });
});

describe("the mode switch", () => {
  it("reports without blocking by default, and enforces the very same policy when told to", () => {
    const reported = contentSecurityPolicy("report-only", input())!;
    const enforced = contentSecurityPolicy("enforce", input())!;
    expect(reported.name).toBe("Content-Security-Policy-Report-Only");
    expect(enforced.name).toBe("Content-Security-Policy");
    // The enforcing header adds only what a report-only policy may not carry.
    expect(enforced.value.replace("; upgrade-insecure-requests", "")).toBe(reported.value);
    expect(reported.value).not.toContain("upgrade-insecure-requests");
  });

  it("sends nothing when off", () => {
    expect(contentSecurityPolicy("off", input())).toBeNull();
  });

  it("does not upgrade requests on a developer's machine, where the app is http", () => {
    expect(contentSecurityPolicy("enforce", input({ development: true }))!.value).not.toContain("upgrade-insecure-requests");
  });

  it("writes one header line: directives split by '; ', sources by a space", () => {
    const { value } = contentSecurityPolicy("enforce", input())!;
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith("default-src 'self'; script-src 'self' 'nonce-Tm9uY2U' 'strict-dynamic' 'wasm-unsafe-eval'; style-src ")).toBe(true);
    expect(value.endsWith("; upgrade-insecure-requests; report-uri https://o4507.ingest.us.sentry.io/api/4508/security/?sentry_key=publickey")).toBe(true);
  });
});

describe("reading Sentry's endpoints off the DSN", () => {
  it("finds the ingest host and the project's security endpoint", () => {
    expect(sentryCsp(DSN)).toEqual({ ingestOrigin: "https://o4507.ingest.us.sentry.io", reportUri: "https://o4507.ingest.us.sentry.io/api/4508/security/?sentry_key=publickey" });
    // A self-hosted Sentry under a path.
    expect(sentryCsp("https://key@sentry.example.com/errors/42")).toEqual({ ingestOrigin: "https://sentry.example.com", reportUri: "https://sentry.example.com/errors/api/42/security/?sentry_key=key" });
  });

  it("is null for no DSN, an empty one, or anything that is not one", () => {
    for (const value of [undefined, null, "", "not a url", "https://o4507.ingest.sentry.io/4508", "https://key@o4507.ingest.sentry.io/", "https://key@o4507.ingest.sentry.io/project", "http://key@o4507.ingest.sentry.io/4508"])
      expect(sentryCsp(value), String(value)).toBeNull();
  });
});

describe("the origin of a configured URL", () => {
  it("drops the path, and is null for nothing or nonsense", () => {
    expect(originOf(`${STORAGE}/suzu-private`)).toBe(STORAGE);
    expect(originOf("http://localhost:9000/")).toBe("http://localhost:9000");
    for (const value of [undefined, null, "", "bucket", "data:text/plain,x"]) expect(originOf(value), String(value)).toBeNull();
  });
});
