import * as Sentry from "@sentry/nextjs";
import type { Instrumentation } from "next";
import { logError } from "@/lib/observability/report";

// Starts Sentry on the Node.js server. Nothing here runs on the edge: the proxy and every route
// use the Node.js runtime.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("@/lib/observability/server");
}

// Every server-side error (pages, server actions, route handlers) passes through here. It becomes
// one structured log line and, with a Sentry DSN set, a Sentry event (src/lib/observability).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  logError(error, {
    event: "request.failed",
    source: "request",
    request: { method: request.method, path: request.path },
    route: context.routePath,
    tags: { routeType: context.routeType },
  });
  Sentry.captureRequestError(error, request, context);
};
