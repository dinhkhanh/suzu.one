import { visitorOf } from "@/lib/public-action";
import { leaveTalentPool } from "@/modules/recruit/privacy";

/**
 * Where the privacy page's one button posts: the candidate leaves the talent pool. Everything is
 * decided in `leaveTalentPool` (a `createPublicAction`: rate limit, validation, the work, the
 * audit row); this turns the request into its input and the outcome into a redirect, never a body.
 */
const seeOther = (location: string) => new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });

export async function POST(request: Request, context: RouteContext<"/careers/privacy/[token]/leave">) {
  const { token } = await context.params;
  const back = `/careers/privacy/${encodeURIComponent(token)}`;
  const result = await leaveTalentPool({ token }, visitorOf(request));
  if (result.ok) return seeOther(`${back}?left=1`);
  return seeOther(`${back}?error=${encodeURIComponent(result.message ?? result.error)}`);
}

/** Nothing to GET here: the button lives on the page. */
export async function GET(_request: Request, context: RouteContext<"/careers/privacy/[token]/leave">) {
  const { token } = await context.params;
  return seeOther(`/careers/privacy/${encodeURIComponent(token)}`);
}
