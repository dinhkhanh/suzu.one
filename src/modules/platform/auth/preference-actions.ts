"use server";
// The language, the colour theme and the sidebar pins. All live on the account, so they follow the
// person to every device (owner's decision 2026-09-24). The language and the theme are also mirrored
// into a cookie for the pages a visitor sees before signing in — the sign-in page, the public site —
// and for the moment after signing out; the pins only matter signed in.
import { cookies } from "next/headers";
import { z } from "zod";
import { isLocale, LOCALE_COOKIE, LOCALES } from "@/i18n/config";
import { createAction } from "@/lib/action";
import { DEFAULT_THEME, isTheme, THEME_COOKIE, THEMES } from "@/theme/config";
import { MAX_NAV_PINS, NAV_PIN_KEY } from "./preferences";
import { updatePreferences } from "./service";

const pipeline = createAction({
  name: "user.preferences.update",
  input: z.object({
    locale: z.enum(LOCALES).optional(),
    theme: z.enum(THEMES).optional(),
    navPins: z.array(z.string().regex(NAV_PIN_KEY)).max(MAX_NAV_PINS).optional(),
  }),
  // One's own preferences need no permission.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { before, after } = await updatePreferences(user.userId, input);
    return { data: after, audit: { resource: { type: "user", id: user.userId }, before, after } };
  },
});

const ONE_YEAR = 60 * 60 * 24 * 365;

/** The browser's copy. Cleared rather than written when the value is the default, so a fresh browser and a reset one look alike. */
async function remember(name: string, value: string | null): Promise<void> {
  const jar = await cookies();
  if (value === null) jar.delete(name);
  else jar.set(name, value, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
}

export async function setLocaleAction(locale: string): Promise<void> {
  if (!isLocale(locale)) return;
  await remember(LOCALE_COOKIE, locale);
  // Signed out, the pipeline answers "unauthenticated" and the cookie is all there is — as intended.
  await pipeline({ locale });
}

export async function setThemeAction(theme: string): Promise<void> {
  if (!isTheme(theme)) return;
  await remember(THEME_COOKIE, theme === DEFAULT_THEME ? null : theme);
  await pipeline({ theme });
}

/**
 * The whole list of pinned sidebar entries, in their order — the sidebar sends the list it now
 * shows, so two quick clicks cannot interleave into a list neither of them meant. A key the person
 * cannot open is harmless: the sidebar draws only the pins among the entries it offers them.
 */
export async function setNavPinsAction(navPins: string[]) {
  return pipeline({ navPins: [...new Set(navPins)] });
}
