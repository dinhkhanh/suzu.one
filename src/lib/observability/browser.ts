import { browserEndpoint, describeError, parseDsn, toEnvelope, withoutQuery } from "./sentry";

// Errors that never reach the server: a component that throws in the browser, a failed event
// handler, a rejected promise. Same envelope as the server's, posted straight to Sentry.
// NEXT_PUBLIC_SENTRY_DSN is inlined at build time; unset = browser errors stay in the console.
const dsn = parseDsn(process.env.NEXT_PUBLIC_SENTRY_DSN);
const environment = process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV ?? "development";
const release = process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA;

// A render loop can throw hundreds of times a second; one page sends at most this many, once each.
const MAX_PER_PAGE = 10;
const sent = new Set<string>();

/** Never throws. An error with a digest came from the server, which has already reported it. */
export function reportBrowserError(error: unknown, source: "window" | "promise" | "boundary"): void {
  try {
    if (!dsn || typeof window === "undefined") return;
    const described = describeError(error);
    if (described.digest) return;
    const key = `${described.type}:${described.message}`;
    if (sent.has(key) || sent.size >= MAX_PER_PAGE) return;
    sent.add(key);
    const report = { ...described, source, environment, release, request: { method: "GET", path: withoutQuery(window.location.pathname) } };
    void fetch(browserEndpoint(dsn), {
      method: "POST",
      // text/plain keeps this a "simple" request: no CORS preflight.
      headers: { "content-type": "text/plain;charset=UTF-8" },
      body: toEnvelope(report, crypto.randomUUID().replaceAll("-", ""), new Date(), "javascript"),
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
  } catch {
    // Reporting must never become the error.
  }
}
