import * as Sentry from "@sentry/nextjs";
import { sharedOptions, tracesSampleRate } from "./options";

// Runs once per server instance, from `register()` in src/instrumentation.ts (which cannot import
// "server-only"). Configuration is read directly rather than through env(): reporting an error must
// never fail because some unrelated variable is missing. The Vercel Sentry integration sets both
// DSN names; either will do. With neither, the SDK does nothing. Release comes from
// VERCEL_GIT_COMMIT_SHA, which the SDK reads itself.
Sentry.init({
  dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
  tracesSampleRate: tracesSampleRate(process.env.SENTRY_TRACES_SAMPLE_RATE),
  ...sharedOptions,
});
