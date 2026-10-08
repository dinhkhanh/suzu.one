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

// ── Which environment an event is filed under ───────────────────────────────────────────────
//
// Only a deployment on Vercel is `production` or `preview`. Every other run is `development`:
// `next dev`, and also a `next build && next start` on somebody's machine — whose NODE_ENV is
// "production" as well, which is how a Mac at http://localhost:3000 came to file its errors beside
// production's. So NODE_ENV is not asked at all, and VERCEL_ENV is believed only together with
// something a deployment alone has: `vercel env pull` writes VERCEL and VERCEL_ENV into `.env.local`
// too, but leaves the deployment's own address empty.

/** A machine on the desk or on the office network: loopback, a private range, a `.local` name. */
export function isLocalHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  if (host === "" || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "::1" || host === "0.0.0.0") return true;
  const octets = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (!octets) return false;
  const [first, second] = [Number(octets[1]), Number(octets[2])];
  return first === 127 || first === 10 || (first === 192 && second === 168) || (first === 172 && second >= 16 && second <= 31) || (first === 169 && second === 254);
}

/**
 * Is this server a Vercel deployment? Any one of the things only a deployment has will do:
 * VERCEL_URL (its own address — empty in a pulled env file, a local address under `vercel dev`),
 * VERCEL_DEPLOYMENT_ID, VERCEL_REGION (`dev1` under `vercel dev`).
 */
export function onVercelDeployment(vars: { url?: string; deploymentId?: string; region?: string }): boolean {
  const host = vars.url?.trim().replace(/:\d+$/, "");
  return (!!host && !isLocalHost(host)) || !!vars.deploymentId?.trim() || (!!vars.region?.trim() && vars.region.trim() !== "dev1");
}

/**
 * `explicit` is SENTRY_ENVIRONMENT (NEXT_PUBLIC_SENTRY_ENVIRONMENT in the browser): said outright,
 * it wins — for a machine that should file under a name of its own, or a host that is not Vercel.
 * Otherwise the deployment's VERCEL_ENV, and `development` for everything that is not deployed.
 */
export function reportingEnvironment(run: { explicit?: string; vercelEnv?: string; deployed: boolean }): string {
  const explicit = run.explicit?.trim();
  if (explicit) return explicit;
  const vercelEnv = run.vercelEnv?.trim();
  return run.deployed && vercelEnv ? vercelEnv : "development";
}
