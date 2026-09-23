import { reportBrowserError } from "@/lib/observability/browser";

// Runs in the browser before the app becomes interactive. Server errors are reported by
// src/instrumentation.ts; these are the ones the server never sees.
window.addEventListener("error", (event) => reportBrowserError(event.error ?? event.message, "window"));
window.addEventListener("unhandledrejection", (event) => reportBrowserError(event.reason, "promise"));
