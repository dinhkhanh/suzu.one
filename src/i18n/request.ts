import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { PUBLIC_SURFACE_HEADER } from "@/proxy";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, TIME_ZONE } from "./config";

/**
 * Which namespace each public surface may have. The root layout hands whatever this returns to
 * `NextIntlClientProvider`, which **serialises all of it into the page**, so an unauthenticated
 * visitor would otherwise receive the whole product's vocabulary: payroll screens, salary fields,
 * everybody's job titles. A client opening a review link (D24) gets the words on that page and
 * nothing else.
 *
 * The marker is set by the proxy from the request's own path and cleared on every other request
 * (`src/proxy.ts`), so it cannot be spoofed onto an internal page.
 */
const PUBLIC_NAMESPACES: Record<string, readonly string[]> = { preview: ["preview"] };

// Locale comes from a cookie, not the URL: this is an internal app, so links stay language-neutral.
export default getRequestConfig(async () => {
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(stored) ? stored : DEFAULT_LOCALE;
  const all: Record<string, unknown> = (await import(`../../messages/${locale}.json`)).default;
  const namespaces = PUBLIC_NAMESPACES[(await headers()).get(PUBLIC_SURFACE_HEADER) ?? ""];
  return {
    locale,
    timeZone: TIME_ZONE,
    messages: namespaces ? Object.fromEntries(namespaces.map((key) => [key, all[key]])) : all,
  };
});
