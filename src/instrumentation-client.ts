import * as Sentry from "@sentry/nextjs";
import { limitPerPage } from "@/lib/observability/browser";
import { isLocalHost, reportingEnvironment, sharedOptions } from "@/lib/observability/options";

// Runs in the browser before the app becomes interactive. Server errors are reported by
// src/instrumentation.ts; these are the ones the server never sees (the SDK catches uncaught errors
// and unhandled rejections itself; the error boundaries call reportBrowserError). NEXT_PUBLIC_SENTRY_DSN
// is inlined at build time; unset = the SDK does nothing. Release is injected at build time. So is
// NEXT_PUBLIC_VERCEL_ENV, which a build made on Vercel carries wherever it is opened — hence the
// address: a page served from this machine or the office network reports as `development`.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: reportingEnvironment({ explicit: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT, vercelEnv: process.env.NEXT_PUBLIC_VERCEL_ENV, deployed: !isLocalHost(window.location.hostname) }),
  ...sharedOptions,
  beforeSend: (event, hint) => {
    const scrubbed = sharedOptions.beforeSend(event, hint);
    return scrubbed && limitPerPage(scrubbed);
  },
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
