import { authHeader, describeError, type ErrorReport, parseDsn, toEnvelope } from "./sentry";

// Server side only (instrumentation.ts cannot import "server-only"). Every server-side error the app catches ends here: one structured log line always, and a Sentry
// event when a DSN is set. Configuration is read directly rather than through env(): reporting an
// error must never fail because some unrelated variable is missing. The Vercel Sentry integration
// sets both names; either will do.
const dsn = () => parseDsn(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN);

/** Never throws. `tags` are small, non-personal labels (a job name), never input values. */
export async function reportError(error: unknown, context: Pick<ErrorReport, "request" | "route" | "source" | "tags"> & { event: string }): Promise<void> {
  const { event, ...where } = context;
  const report: ErrorReport = {
    ...describeError(error),
    ...where,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  };
  console.error(JSON.stringify({ level: "error", event, ...report }));

  const target = dsn();
  if (!target) return;
  try {
    await fetch(target.endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": authHeader(target) },
      body: toEnvelope(report, crypto.randomUUID().replaceAll("-", ""), new Date()),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The log line above is the fallback.
  }
}
