// The smallest possible Sentry client: one HTTP call per error, no SDK (NFR-OPS-03).
// Pure helpers; the caller does the fetch.

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

export type ErrorReport = {
  message: string;
  type: string;
  stack?: string;
  digest?: string;
  request: { method: string; path: string };
  route?: string;
  environment: string;
  release?: string;
};

// Query strings can carry search terms and ids; the route is enough to find the bug.
export const withoutQuery = (path: string) => path.split("?")[0];

function frames(stack: string | undefined) {
  if (!stack) return [];
  return stack
    .split("\n")
    .slice(1, 40)
    .map((line) => /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim()))
    .flatMap((match) => (match ? [{ function: match[1] ?? "<anonymous>", filename: match[2], lineno: Number(match[3]), colno: Number(match[4]) }] : []))
    .reverse();
}

export function toEnvelope(report: ErrorReport, eventId: string, now: Date): string {
  const event = {
    event_id: eventId,
    timestamp: now.getTime() / 1000,
    platform: "node",
    level: "error",
    environment: report.environment,
    release: report.release,
    transaction: report.route,
    exception: { values: [{ type: report.type, value: report.message, stacktrace: { frames: frames(report.stack) } }] },
    request: { method: report.request.method, url: report.request.path },
    tags: { digest: report.digest },
  };
  return [JSON.stringify({ event_id: eventId, sent_at: now.toISOString() }), JSON.stringify({ type: "event" }), JSON.stringify(event)].join("\n");
}
