// The smallest possible Sentry client: one HTTP call per error, no SDK (NFR-OPS-03).
// Pure helpers shared by the server and the browser; the caller does the fetch.

export type Dsn = { endpoint: string; publicKey: string };

/** "https://<key>@<host>/<project>" → where to post envelopes. Returns null for anything else. */
export function parseDsn(dsn: string | undefined): Dsn | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!url.username || !/^\d+$/.test(project)) return null;
    return { endpoint: `${url.protocol}//${url.host}/api/${project}/envelope/`, publicKey: url.username };
  } catch {
    return null;
  }
}

/** The server authenticates with a header; a browser cannot send one cross-origin without a preflight, so the key goes in the URL. */
export const authHeader = (dsn: Dsn) => `Sentry sentry_version=7, sentry_client=suzu-one/1, sentry_key=${dsn.publicKey}`;
export const browserEndpoint = (dsn: Dsn) => `${dsn.endpoint}?sentry_version=7&sentry_client=suzu-one%2F1&sentry_key=${encodeURIComponent(dsn.publicKey)}`;

export type ErrorReport = {
  message: string;
  type: string;
  stack?: string;
  digest?: string;
  request?: { method: string; path: string };
  route?: string;
  environment: string;
  release?: string;
  /** Where the error was caught: "request", "job", "public_action", "window", "boundary"… */
  source?: string;
  /** Small, non-personal context (a job name, an action name). Never input values. */
  tags?: Record<string, string | undefined>;
};

// Query strings can carry search terms and ids; the route is enough to find the bug.
export const withoutQuery = (path: string) => path.split(/[?#]/)[0];

/** Any thrown value → the fields a report needs. */
export function describeError(error: unknown): Pick<ErrorReport, "message" | "type" | "stack" | "digest"> {
  const isError = error instanceof Error;
  return {
    message: isError ? error.message : String(error),
    type: isError ? error.name : "NonError",
    stack: isError ? error.stack : undefined,
    digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
  };
}

// V8 ("    at fn (file:1:2)") and Firefox/Safari ("fn@file:1:2") frame lines.
const V8_FRAME = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/;
const GECKO_FRAME = /^(.*?)@(.+?):(\d+):(\d+)$/;

function frames(stack: string | undefined) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(0, 40)
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("at ")) return V8_FRAME.exec(trimmed);
      return GECKO_FRAME.exec(trimmed);
    })
    .flatMap((match) => (match ? [{ function: match[1] || "<anonymous>", filename: withoutQuery(match[2]), lineno: Number(match[3]), colno: Number(match[4]) }] : []))
    .reverse();
}

export function toEnvelope(report: ErrorReport, eventId: string, now: Date, platform: "node" | "javascript" = "node"): string {
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform,
    level: "error",
    environment: report.environment,
    release: report.release,
    transaction: report.route,
    exception: { values: [{ type: report.type, value: report.message, stacktrace: { frames: frames(report.stack) } }] },
    request: report.request ? { method: report.request.method, url: report.request.path } : undefined,
    tags: { digest: report.digest, source: report.source, ...report.tags },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}
