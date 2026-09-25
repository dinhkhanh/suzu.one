import "server-only";
import { env } from "./env";

// The two origins the product answers on (see `site-routing.ts`). Every absolute link is built from
// one of these, never from the request's own Host header: a link to a review page or a job advert
// must name the public domain whichever domain the person who made it was on.

/** The internal app's origin, e.g. `https://suzu.one`. */
export const appOrigin = (): string => new URL(env().BETTER_AUTH_URL).origin;

/** The public domain, when one is configured: its origin and its host (port included if named). */
export function publicSite(): { origin: string; host: string } | null {
  const configured = env().PUBLIC_SITE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  return { origin: url.origin, host: url.host.toLowerCase() };
}

/** Where links for outsiders — review links, careers pages, take-home briefs — point. */
export const publicOrigin = (): string => publicSite()?.origin ?? appOrigin();
