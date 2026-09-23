import type { Instrumentation } from "next";
import { reportError } from "@/lib/observability/report";
import { withoutQuery } from "@/lib/observability/sentry";

// Every server-side error (pages, server actions, route handlers) passes through here. It becomes
// one structured log line and, with a Sentry DSN set, a Sentry event (src/lib/observability/report.ts).
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await reportError(error, {
    event: "request.failed",
    source: "request",
    request: { method: request.method, path: withoutQuery(request.path) },
    route: context.routePath,
    tags: { routeType: context.routeType },
  });
};
