import type { Instrumentation } from "next";
import { parseDsn, toEnvelope, withoutQuery } from "@/lib/observability/sentry";

// Every server-side error (pages, server actions, route handlers) passes through here.
// It always becomes one structured log line; with SENTRY_DSN set it is also sent to Sentry, which
// does the grouping and the alerting. Configuration is read directly rather than through env():
// reporting an error must never fail because some unrelated variable is missing.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const isError = error instanceof Error;
  const report = {
    message: isError ? error.message : String(error),
    type: isError ? error.name : "NonError",
    stack: isError ? error.stack : undefined,
    digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
    request: { method: request.method, path: withoutQuery(request.path) },
    route: context.routePath,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA,
  };
  console.error(JSON.stringify({ level: "error", event: "request.failed", routeType: context.routeType, ...report }));

  const dsn = parseDsn(process.env.SENTRY_DSN);
  if (!dsn) return;
  try {
    await fetch(dsn.endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope", "x-sentry-auth": `Sentry sentry_version=7, sentry_client=suzu-one/1, sentry_key=${dsn.publicKey}` },
      body: toEnvelope(report, crypto.randomUUID().replaceAll("-", ""), new Date()),
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // The log line above is the fallback.
  }
};
