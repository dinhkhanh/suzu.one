import type { Event } from "@sentry/nextjs";
import { expect, it } from "vitest";
import { sharedOptions, tracesSampleRate } from "./options";
import { redactUrl, scrubBreadcrumb, scrubEvent } from "./scrub";

it("keeps a route and drops the query string", () => {
  expect(redactUrl("/people?q=nguyen+van+a#top")).toBe("/people");
  expect(redactUrl("https://o42.ingest.sentry.io/api/1/envelope/?sentry_key=abc")).toBe("https://o42.ingest.sentry.io/api/1/envelope/");
});

it("never lets the token of a link that is a credential through", () => {
  expect(redactUrl("/preview/k3j2h4g5f6d7s8a9")).toBe("/preview/[redacted]");
  expect(redactUrl("/approvals/act/abc?x=1")).toBe("/approvals/act/[redacted]");
  expect(redactUrl("/careers/assignment/abc/submit")).toBe("/careers/assignment/[redacted]/submit");
  expect(redactUrl("/assets/qr/abc")).toBe("/assets/qr/[redacted]");
  expect(redactUrl("/careers/senior-designer")).toBe("/careers/senior-designer");
});

it("leaves a route pattern alone: `[token]` names the segment, it is not one", () => {
  expect(redactUrl("/preview/[token]/sentry-check")).toBe("/preview/[token]/sentry-check");
  expect(redactUrl("/preview/[redacted]")).toBe("/preview/[redacted]");
  expect(scrubEvent({ transaction: "GET /approvals/act/[token]" } as Event).transaction).toBe("GET /approvals/act/[token]");
});

it("redacts a secret in the path of an outgoing call, and credentials in its URL", () => {
  expect(redactUrl("https://api.telegram.org/bot123456:ABC-def/sendMessage")).toBe("https://api.telegram.org/[redacted]/sendMessage");
  expect(redactUrl("https://user:pass@example.com/x")).toBe("https://example.com/x");
  expect(redactUrl("https://x.r2.cloudflarestorage.com/suzu-private/0192f3a4b5c6d7e8f9a0b1c2?X-Amz-Signature=deadbeef")).toBe("https://x.r2.cloudflarestorage.com/suzu-private/[redacted]");
});

it("strips the person and the request's content from an event, keeping the error", () => {
  const event: Event = {
    user: { id: "1", email: "a@suzu.vn", ip_address: "1.2.3.4" },
    request: { method: "POST", url: "https://suzu.one/payroll/runs/x?month=2026-08", headers: { cookie: "session=1" }, cookies: { session: "1" }, data: { salary: 30000000 }, query_string: "month=2026-08" },
    contexts: { nextjs: { request_path: "/preview/k3j2h4g5f6d7s8a9?x=1", route_type: "render" } },
    transaction: "POST /payroll/runs/[runId]",
    exception: { values: [{ type: "Error", value: "boom" }] },
    breadcrumbs: [
      { category: "console", message: "salary 30000000" },
      { category: "ui.click", message: "button[aria-label='Xóa Nguyễn Văn A']" },
      { category: "fetch", data: { url: "https://suzu.one/api/x?token=1", method: "GET" } },
    ],
  };
  const clean = scrubEvent(event);
  expect(clean.user).toBeUndefined();
  expect(clean.request).toEqual({ method: "POST", url: "https://suzu.one/payroll/runs/x" });
  expect(clean.contexts?.nextjs).toEqual({ request_path: "/preview/[redacted]", route_type: "render" });
  expect(clean.transaction).toBe("POST /payroll/runs/[runId]");
  expect(clean.exception?.values?.[0].value).toBe("boom");
  expect(clean.breadcrumbs).toEqual([{ category: "fetch", data: { url: "https://suzu.one/api/x", method: "GET" } }]);
  expect(JSON.stringify(clean)).not.toMatch(/salary|a@suzu\.vn|1\.2\.3\.4|session|Nguy/);
});

it("cleans the spans of a transaction", () => {
  const clean = scrubEvent({
    type: "transaction",
    transaction: "/preview/k3j2h4g5f6d7s8a9",
    spans: [{ description: "POST https://api.telegram.org/bot123456:ABC/sendMessage", data: { "http.query": "chat_id=1", "url.full": "https://api.telegram.org/bot123456:ABC/sendMessage" }, span_id: "a", trace_id: "b", start_timestamp: 0, timestamp: 1, status: "ok" }],
  } as Event);
  expect(clean.transaction).toBe("/preview/[redacted]");
  expect(clean.spans?.[0].description).toBe("POST https://api.telegram.org/[redacted]/sendMessage");
  expect(clean.spans?.[0].data).toEqual({ "url.full": "https://api.telegram.org/[redacted]/sendMessage" });
});

it("drops the headers and the client address OpenTelemetry puts on a request's span", () => {
  const clean = scrubEvent({
    type: "transaction",
    contexts: { trace: { trace_id: "a", span_id: "b", data: { "http.method": "GET", "http.request.header.cookie": ["better-auth.session_token=x"], "http.request.header.user-agent": ["curl"], "http.response.header.set-cookie": ["a=b"], "client.address": "1.2.3.4", "http.target": "/people?q=a" } } },
  } as Event);
  expect(clean.contexts?.trace?.data).toEqual({ "http.method": "GET", "http.target": "/people" });
});

it("keeps navigation and calls as breadcrumbs, and nothing that describes the page", () => {
  expect(scrubBreadcrumb({ category: "navigation", data: { from: "/people?q=a", to: "/preview/k3j2h4g5f6d7s8a9" } })).toEqual({ category: "navigation", data: { from: "/people", to: "/preview/[redacted]" } });
  expect(scrubBreadcrumb({ category: "ui.input", message: "input[name=salary]" })).toBeNull();
  expect(scrubBreadcrumb({ message: "no category" })).toBeNull();
});

it("tags an event with the digest the error page showed", () => {
  const error = Object.assign(new Error("boom"), { digest: "12345" });
  const event = sharedOptions.beforeSend({ type: undefined, tags: { source: "request" } }, { originalException: error });
  expect(event?.tags).toEqual({ source: "request", digest: "12345" });
});

it("turns tracing on only for a rate between 0 and 1", () => {
  expect(tracesSampleRate(undefined)).toBeUndefined();
  expect(tracesSampleRate("")).toBeUndefined();
  expect(tracesSampleRate("0.1")).toBe(0.1);
  expect(tracesSampleRate("0")).toBe(0);
  expect(tracesSampleRate("2")).toBeUndefined();
  expect(tracesSampleRate("lots")).toBeUndefined();
});
