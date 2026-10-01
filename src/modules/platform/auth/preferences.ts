// What a person keeps on their account rather than in a browser: the language, the colour theme
// (owner's decision 2026-09-24) and the sidebar entries they pinned. All follow them to every
// device they sign in on. Pure.
import { isLocale, type Locale } from "@/i18n/config";
import { isTheme, type Theme } from "@/theme/config";

/** `null` is "never chosen here": the browser's cookie, then the default, decide. */
export type Preferences = { locale: Locale | null; theme: Theme | null; navPins: string[] };

/** A sidebar entry's key (`nav.ts`): letters only, so a stored pin can never be more than a name. */
export const NAV_PIN_KEY = /^[A-Za-z]{1,40}$/;
/** Enough for every entry a person uses daily; the sidebar is not a second copy of itself. */
export const MAX_NAV_PINS = 12;

/** The pins as stored, without anything unrecognised, repeated, or past the limit. */
export function navPinsOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const keys = value.filter((key): key is string => typeof key === "string" && NAV_PIN_KEY.test(key));
  return [...new Set(keys)].slice(0, MAX_NAV_PINS);
}

/** The preferences on a `user` row, with anything unrecognised read as never chosen. */
export function preferencesOf(row: { locale?: unknown; theme?: unknown; navPins?: unknown } | null | undefined): Preferences {
  const locale = typeof row?.locale === "string" ? row.locale : undefined;
  const theme = typeof row?.theme === "string" ? row.theme : undefined;
  return { locale: isLocale(locale) ? locale : null, theme: isTheme(theme) ? theme : null, navPins: navPinsOf(row?.navPins) };
}
