import type { Breadcrumb, Event } from "@sentry/nextjs";

// What may leave for Sentry. The SDK collects far more than the hand-written client it replaced —
// request headers and bodies, breadcrumbs of every click and console line, URLs of every outgoing
// call — and this app holds salaries, so all of it passes through here first. Pure functions, no
// SDK calls: `options.ts` wires them into `beforeSend` and `beforeBreadcrumb`.

const REDACTED = "[redacted]";

// Pages whose URL *is* the credential (next.config.ts sends `Referrer-Policy: no-referrer` for the
// same list): the token segment right after the prefix never leaves the app.
const CREDENTIAL_PREFIXES = ["/preview/", "/approvals/act/", "/careers/assignment/", "/assets/qr/"];

// A path segment that looks like a secret rather than a word: a long run of token characters with
// a digit in it (ids, signatures), or Telegram's `bot<id>:<token>` — its bot token sits in the path
// of every Bot API call the app makes.
const looksLikeSecret = (segment: string) => /^bot\d+:/.test(segment) || (segment.length >= 20 && /^[\w:.~-]+$/.test(segment) && /\d/.test(segment));

const isPlaceholder = (segment: string) => /^\[[^\]]+\]$/.test(segment);

/** A URL or path with no query, fragment or credentials in it, and any token segment redacted. */
export function redactUrl(input: string): string {
  let origin = "";
  let path = input;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      origin = url.origin;
      path = url.pathname;
    } catch {
      return REDACTED;
    }
  } else {
    path = input.split(/[?#]/)[0];
  }
  const prefix = CREDENTIAL_PREFIXES.find((candidate) => path.startsWith(candidate));
  const tokenIndex = prefix ? prefix.split("/").length - 1 : -1;
  // `[token]` is the route's own name for the segment, not a value: the route pattern is what makes an event findable.
  const segments = path.split("/").map((segment, index) => (!isPlaceholder(segment) && (index === tokenIndex || looksLikeSecret(segment)) ? REDACTED : segment));
  return origin + segments.join("/");
}

const URL_KEYS = new Set(["url", "http.url", "url.full", "from", "to", "http.target", "url.path"]);
const DROPPED_KEYS = new Set(["http.query", "url.query", "http.fragment", "url.fragment", "query_string", "cookies", "data", "body", "client.address", "http.client_ip", "net.peer.ip", "network.peer.address"]);
// OpenTelemetry attaches every request and response header to the span of a request — the cookie's
// name, the browser, the host. None of it helps find a bug.
const DROPPED_PREFIXES = ["http.request.header.", "http.response.header."];

function scrubData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  for (const key of Object.keys(data)) {
    if (DROPPED_KEYS.has(key) || DROPPED_PREFIXES.some((prefix) => key.startsWith(prefix))) delete data[key];
    else if (URL_KEYS.has(key) && typeof data[key] === "string") data[key] = redactUrl(data[key]);
  }
}

// Breadcrumbs of these kinds describe navigation and calls, which scrubData cleans. Every other
// kind is dropped: `console` repeats what the log line already says, and `ui.click` / `ui.input`
// carry element labels, which on a people screen are people's names.
const KEPT_BREADCRUMBS = new Set(["navigation", "fetch", "xhr", "http"]);

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb | null {
  if (!breadcrumb.category || !KEPT_BREADCRUMBS.has(breadcrumb.category)) return null;
  scrubData(breadcrumb.data);
  return breadcrumb;
}

const REQUEST_LINE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)$/;

/** Span and transaction names read "GET https://…/bot123:abc/sendMessage" — same treatment as a URL. */
const redactRequestLine = (text: string) => {
  const match = REQUEST_LINE.exec(text);
  return match ? `${match[1]} ${redactUrl(match[2])}` : text;
};

/**
 * Keeps the error and where it happened; drops who was there and what they sent. No user, no
 * cookies, headers, body or query string, and every URL reduced to its route.
 */
export function scrubEvent<T extends Event>(event: T): T {
  delete event.user;
  if (event.request) event.request = { method: event.request.method, ...(event.request.url ? { url: redactUrl(event.request.url) } : {}) };

  const nextjs = event.contexts?.nextjs as { request_path?: string } | undefined;
  if (typeof nextjs?.request_path === "string") nextjs.request_path = redactUrl(nextjs.request_path);

  if (event.transaction) event.transaction = event.transaction.startsWith("/") ? redactUrl(event.transaction) : redactRequestLine(event.transaction);

  if (event.breadcrumbs) event.breadcrumbs = event.breadcrumbs.flatMap((breadcrumb) => scrubBreadcrumb(breadcrumb) ?? []);

  for (const span of event.spans ?? []) {
    if (span.description) span.description = redactRequestLine(span.description);
    scrubData(span.data);
  }
  scrubData(event.contexts?.trace?.data);
  return event;
}
