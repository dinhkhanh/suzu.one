import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, TIME_ZONE } from "./config";
import { namespacesForSurface, PUBLIC_FALLBACK, pickMessages, SURFACE_HEADER } from "./surfaces";

/**
 * The messages a request gets. The root layout hands whatever this returns to
 * `NextIntlClientProvider`, which **serialises all of it into the page**, so this is the one place
 * that decides what an unauthenticated visitor receives — and the whole catalogue is handed over
 * only for a request the proxy read as the app's own (`src/i18n/surfaces.ts`). A client opening a
 * review link (D24) or a candidate reading a job advertisement gets the words on that page.
 *
 * The path is not the whole question, though. The proxy's session check is an optimistic cookie
 * check by design, so **any** value in `better-auth.session_token` walks past it onto an internal
 * path; the page there does authenticate and redirects to sign-in, but the root layout above it has
 * already serialised whatever this returned — and Next sends that body with the redirect. So the
 * catalogue also waits for a session that really exists. `getCurrentUser` is React-cached and the
 * app's own layout calls it on every request anyway, so a signed-in page pays nothing for it.
 */
// Locale comes from a cookie, not the URL: this is an internal app, so links stay language-neutral.
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const all: Record<string, unknown> = (await import(`../../messages/${locale}.json`)).default;
  const surface = namespacesForSurface((await headers()).get(SURFACE_HEADER));
  // A signed-out visitor on an internal path is on their way to the sign-in page: the public words
  // are the right ones for what they are about to be shown, and the only ones they may have.
  const namespaces = surface ?? ((await getCurrentUser()) ? null : PUBLIC_FALLBACK);
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: namespaces ? pickMessages(all, namespaces) : all,
  };
});
