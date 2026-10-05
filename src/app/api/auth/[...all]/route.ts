import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/modules/platform/auth/auth";
import { clientIpFrom } from "@/modules/platform/auth/client-ip";
import { authLimitKey, countAuthHit } from "@/modules/platform/auth/endpoint-limit";
import { authBucketOf } from "@/modules/platform/auth/rate-limit";

/**
 * Counted before Better Auth sees the request (NFR-SEC-03), per address, in Postgres — so the limit
 * holds across every server instance. A refused browser coming back from Google lands on the
 * sign-in page with a sentence; a refused script gets a 429 and how long to wait.
 */
async function limited(request: Request): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const outcome = await countAuthHit(authBucketOf(pathname), authLimitKey("ip", clientIpFrom(request.headers)));
  if (outcome.ok) return null;
  const headers = { "retry-after": String(outcome.retryAfterSeconds), "cache-control": "no-store" };
  if (request.method === "GET") return Response.redirect(new URL("/sign-in?error=rate_limited", request.url), 303);
  return Response.json({ code: "rate_limited", message: "rate_limited" }, { status: 429, headers });
}

// Resolved per request so the auth instance (and its env validation) is created lazily.
export async function GET(request: Request) {
  return (await limited(request)) ?? toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return (await limited(request)) ?? toNextJsHandler(auth()).POST(request);
}
