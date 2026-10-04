import * as Sentry from "@sentry/nextjs";
import { onVercelDeployment, reportingEnvironment } from "./options";
import { redactUrl } from "./scrub";

// Server side only (instrumentation.ts cannot import "server-only"). Every server-side error the
// app catches ends up here: one structured log line always (`logError`), and a Sentry event when a
// DSN is set (the SDK, initialised in server.ts).

type Context = {
  /** The log line's event name: "request.failed", "job.failed", "<action>.failed". */
  event: string;
  request?: { method: string; path: string };
  route?: string;
  /** Where the error was caught: "request", "job", "public_action"… */
  source?: string;
  /** Small, non-personal labels (a job name, an action name). Never input values. */
  tags?: Record<string, string | undefined>;
};

/** What this server files its errors under: the deployment's environment on Vercel, `development` anywhere else (options.ts). */
export const serverEnvironment = (): string =>
  reportingEnvironment({
    explicit: process.env.SENTRY_ENVIRONMENT,
    vercelEnv: process.env.VERCEL_ENV,
    deployed: onVercelDeployment({ url: process.env.VERCEL_URL, deploymentId: process.env.VERCEL_DEPLOYMENT_ID, region: process.env.VERCEL_REGION }),
  });

export function logError(error: unknown, { event, request, ...where }: Context): void {
  const isError = error instanceof Error;
  console.error(
    JSON.stringify({
      level: "error",
      event,
      message: isError ? error.message : String(error),
      type: isError ? error.name : "NonError",
      stack: isError ? error.stack : undefined,
      digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
      request: request && { method: request.method, path: redactUrl(request.path) },
      ...where,
      environment: serverEnvironment(),
      release: process.env.VERCEL_GIT_COMMIT_SHA,
    }),
  );
}

/** Never throws. `tags` are small, non-personal labels (a job name), never input values. */
export async function reportError(error: unknown, context: Context): Promise<void> {
  logError(error, context);
  try {
    Sentry.withScope((scope) => {
      scope.setTag("event", context.event);
      if (context.source) scope.setTag("source", context.source);
      for (const [key, value] of Object.entries(context.tags ?? {})) if (value !== undefined) scope.setTag(key, value);
      if (context.route) scope.setTransactionName(context.route);
      Sentry.captureException(error);
    });
    // A serverless function may be frozen the moment it returns.
    await Sentry.flush(2000);
  } catch {
    // The log line above is the fallback.
  }
}
