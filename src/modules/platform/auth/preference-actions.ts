"use server";
// The language and the colour theme. Both live on the account, so they follow the person to every
// device (owner's decision 2026-09-24), and each is mirrored into a cookie for the pages a visitor
// sees before signing in — the sign-in page, the public site — and for the moment after signing out.
import { cookies } from "next/headers";
import { z } from "zod";
import { isLocale, LOCALE_COOKIE, LOCALES } from "@/i18n/config";
import { createAction } from "@/lib/action";
import { DEFAULT_THEME, isTheme, THEME_COOKIE, THEMES } from "@/theme/config";
import { updatePreferences } from "./service";

const pipeline = createAction({
  name: "user.preferences.update",
  input: z.object({ locale: z.enum(LOCALES).optional(), theme: z.enum(THEMES).optional() }),
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
