import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, TIME_ZONE } from "./config";
import { namespacesForSurface, pickMessages, SURFACE_HEADER } from "./surfaces";

/**
 * The messages a request gets. The root layout hands whatever this returns to
 * `NextIntlClientProvider`, which **serialises all of it into the page**, so this is the one place
 * that decides what an unauthenticated visitor receives — and the whole catalogue is handed over
 * only for a request the proxy read as the app's own (`src/i18n/surfaces.ts`). A client opening a
 * review link (D24) or a candidate reading a job advertisement gets the words on that page.
 */
// Locale comes from a cookie, not the URL: this is an internal app, so links stay language-neutral.
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const all: Record<string, unknown> = (await import(`../../messages/${locale}.json`)).default;
  const namespaces = namespacesForSurface((await headers()).get(SURFACE_HEADER));
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: namespaces ? pickMessages(all, namespaces) : all,
  };
});
