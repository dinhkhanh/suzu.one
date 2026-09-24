import "server-only";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { DEFAULT_THEME, isTheme, THEME_COOKIE, type Theme } from "./config";

/**
 * The theme this request is drawn in: the one on the signed-in account, else the one this browser
 * chose before signing in, else the device's. `getCurrentUser` is React-cached, so a page that
 * already authenticated pays nothing for the first look.
 */
export async function getTheme(): Promise<Theme> {
  const user = await getCurrentUser();
  if (user?.preferences.theme) return user.preferences.theme;
  const stored = (await cookies()).get(THEME_COOKIE)?.value;
  return isTheme(stored) ? stored : DEFAULT_THEME;
}
