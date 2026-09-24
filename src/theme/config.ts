// The colour theme is the reader's choice, kept the way the language is (`src/i18n/config.ts`): on
// their account once they are signed in (`src/modules/platform/auth/preferences.ts`), so it follows
// them to every device, and in a cookie on this browser for the pages a visitor opens before signing
// in. The root layout reads it on every request.
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
/** No cookie means "follow the device", which is what everybody gets until they say otherwise. */
export const DEFAULT_THEME: Theme = "system";
export const THEME_COOKIE = "suzu_theme";

export function isTheme(value: string | undefined): value is Theme {
  return (THEMES as readonly string[]).includes(value ?? "");
}

/**
 * What the `<html>` element carries: `data-theme="light"` or `"dark"` when the reader chose one, and
 * nothing when they follow the device, so the stylesheet's `prefers-color-scheme` branch decides.
 */
export function themeAttribute(theme: Theme): "light" | "dark" | undefined {
  return theme === "system" ? undefined : theme;
}
