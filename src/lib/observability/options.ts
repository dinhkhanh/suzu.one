import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

// What the browser and the server share. Deliberately absent: session replay, the feedback widget,
// and anything else that records what a person saw or typed — payroll screens are on this app.
export const sharedOptions = {
  // Never sends IPs, cookies or user objects; `scrubEvent` removes what is left of the request.
  sendDefaultPii: false,
  // The SDK's default streams spans one by one and never calls `beforeSendTransaction`, which is
  // where the URLs in span names and attributes are scrubbed. Static sends whole transactions.
  traceLifecycle: "static" as const,
  beforeSend: (event: ErrorEvent, hint: EventHint) => {
    // A digest is the reference a person is shown on the error page; it lets support find the event.
    const original = hint.originalException;
    if (typeof original === "object" && original !== null && "digest" in original) event.tags = { ...event.tags, digest: String(original.digest) };
    return scrubEvent(event);
  },
  beforeSendTransaction: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
};

/** Tracing is off unless SENTRY_TRACES_SAMPLE_RATE (0–1) says otherwise. */
export function tracesSampleRate(value: string | undefined): number | undefined {
  const rate = Number(value);
  return value && Number.isFinite(rate) && rate >= 0 && rate <= 1 ? rate : undefined;
}
