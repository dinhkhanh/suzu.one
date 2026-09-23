import { expect, it } from "vitest";
import { browserEndpoint, describeError, parseDsn, toEnvelope, withoutQuery } from "./sentry";

it("turns a DSN into an envelope endpoint, and refuses anything else", () => {
  expect(parseDsn("https://abc123@o42.ingest.de.sentry.io/4501")).toEqual({ endpoint: "https://o42.ingest.de.sentry.io/api/4501/envelope/", publicKey: "abc123" });
  expect(parseDsn(undefined)).toBeNull();
  expect(parseDsn("not a url")).toBeNull();
  expect(parseDsn("https://o42.ingest.sentry.io/4501")).toBeNull();
});

it("builds a three-line envelope with the stack innermost-last and no query string", () => {
  const error = new Error("boom");
  error.stack = "Error: boom\n    at hirePerson (/app/src/modules/core-hr/service.ts:410:11)\n    at /app/src/lib/action.ts:44:31";
  const envelope = toEnvelope(
    { message: error.message, type: "Error", stack: error.stack, digest: "123", request: { method: "POST", path: withoutQuery("/people?q=nguyen+van+a") }, route: "/people", environment: "production" },
    "0123456789abcdef0123456789abcdef",
    new Date("2026-09-19T00:00:00Z"),
  );
  const [header, item, event] = envelope.split("\n").map((line) => JSON.parse(line));
  expect(header.event_id).toBe("0123456789abcdef0123456789abcdef");
  expect(item).toEqual({ type: "event" });
  expect(event.request).toEqual({ method: "POST", url: "/people" });
  expect(event.exception.values[0].stacktrace.frames.map((frame: { function: string }) => frame.function)).toEqual(["<anonymous>", "hirePerson"]);
  expect(envelope).not.toContain("nguyen");
});

it("puts the key in the URL for the browser, which cannot send the auth header without a preflight", () => {
  const dsn = parseDsn("https://abc123@o42.ingest.de.sentry.io/4501")!;
  expect(browserEndpoint(dsn)).toBe("https://o42.ingest.de.sentry.io/api/4501/envelope/?sentry_version=7&sentry_client=suzu-one%2F1&sentry_key=abc123");
});

it("reads Firefox and Safari stacks, and drops query strings from chunk URLs", () => {
  const error = new Error("nope");
  error.stack = "submit@https://suzu.one/_next/static/chunks/app.js?dpl=abc:1:200\n@https://suzu.one/_next/static/chunks/main.js:2:10";
  const envelope = toEnvelope({ ...describeError(error), environment: "production", source: "window" }, "0123456789abcdef0123456789abcdef", new Date(), "javascript");
  const event = JSON.parse(envelope.split("\n")[2]);
  expect(event.platform).toBe("javascript");
  expect(event.request).toBeUndefined();
  expect(event.tags.source).toBe("window");
  expect(event.exception.values[0].stacktrace.frames).toEqual([
    { function: "<anonymous>", filename: "https://suzu.one/_next/static/chunks/main.js", lineno: 2, colno: 10 },
    { function: "submit", filename: "https://suzu.one/_next/static/chunks/app.js", lineno: 1, colno: 200 },
  ]);
});

it("describes anything thrown, keeping a server digest", () => {
  expect(describeError("plain")).toEqual({ message: "plain", type: "NonError", stack: undefined, digest: undefined });
  expect(describeError(Object.assign(new TypeError("x"), { digest: "42" }))).toMatchObject({ type: "TypeError", digest: "42" });
});
