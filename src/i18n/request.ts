import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { DEFAULT_LOCALE, isLocale, type Locale, LOCALE_COOKIE, TIME_ZONE } from "./config";
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
// Locale comes from the account, then a cookie — never the URL: this is an internal app, so links
// stay language-neutral. Signed in, the choice on the account wins, so it follows the person to every
// device; before that, the cookie this browser set. The public site is the exception to the default:
// its readers include Google's OAuth reviewers, who arrive with neither, so there the browser's first
// language decides until one is chosen.
export default getRequestConfig(async () => {
  const requestHeaders = await headers();
  const surface = namespacesForSurface(requestHeaders.get(SURFACE_HEADER));
  // Only the app's own pages look for the person: the public ones never hand out more than their own words.
  const user = surface ? null : await getCurrentUser();
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = user?.preferences.locale ?? (isLocale(stored) ? stored : requestHeaders.get(SURFACE_HEADER) === "site" ? browserLocale(requestHeaders) : DEFAULT_LOCALE);
  const all: Record<string, unknown> = (await import(`../../messages/${locale}.json`)).default;
  // A signed-out visitor on an internal path is on their way to the sign-in page: the public words
  // are the right ones for what they are about to be shown, and the only ones they may have.
  const namespaces = surface ?? (user ? null : PUBLIC_FALLBACK);
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: namespaces ? pickMessages(all, namespaces) : all,
  };
});

/** Vietnamese for a browser that puts Vietnamese first, English for any other it names. */
function browserLocale(requestHeaders: Headers): Locale {
  const first = requestHeaders.get("accept-language")?.split(",")[0]?.trim().toLowerCase();
  return !first || first.startsWith("vi") ? DEFAULT_LOCALE : "en";
}
