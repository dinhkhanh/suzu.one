// What a person keeps on their account rather than in a browser: the language and the colour
// theme (owner's decision 2026-09-24). Both follow them to every device they sign in on. Pure.
import { isLocale, type Locale } from "@/i18n/config";
import { isTheme, type Theme } from "@/theme/config";

/** `null` is "never chosen here": the browser's cookie, then the default, decide. */
export type Preferences = { locale: Locale | null; theme: Theme | null };

/** The preferences on a `user` row, with anything unrecognised read as never chosen. */
export function preferencesOf(row: { locale?: unknown; theme?: unknown } | null | undefined): Preferences {
  const locale = typeof row?.locale === "string" ? row.locale : undefined;
  const theme = typeof row?.theme === "string" ? row.theme : undefined;
  return { locale: isLocale(locale) ? locale : null, theme: isTheme(theme) ? theme : null };
}
