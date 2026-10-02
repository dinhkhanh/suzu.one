import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent } from "@sentry/nextjs";

// Errors that never reach the server: a component that throws in the browser, a failed event
// handler, a rejected promise. The SDK catches the last two on its own (instrumentation-client.ts);
// the error boundaries hand theirs to `reportBrowserError`, and so does the face kiosk, which
// catches its own failure to load so that the screen can say what happened.

// A render loop can throw hundreds of times a second; one page sends at most this many, once each.
const MAX_PER_PAGE = 10;
const sent = new Set<string>();

/** `beforeSend` for the browser: drops repeats and caps the page's total. */
export function limitPerPage(event: ErrorEvent): ErrorEvent | null {
  const error = event.exception?.values?.[0];
  const key = `${error?.type}:${error?.value}`;
  if (sent.has(key) || sent.size >= MAX_PER_PAGE) return null;
  sent.add(key);
  return event;
}

/** Never throws. An error with a digest came from the server, which has already reported it. */
export function reportBrowserError(error: unknown, source: "boundary" | "kiosk"): void {
  try {
    if (typeof error === "object" && error !== null && "digest" in error) return;
    Sentry.captureException(error, { tags: { source } });
  } catch {
    // Reporting must never become the error.
  }
}
