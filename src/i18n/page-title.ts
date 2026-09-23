import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

/**
 * A page's browser-tab title in the reader's language, from `pageTitles.<key>`. The root layout's
 * template adds " · SuZu One". Use as `export const generateMetadata = pageTitle("payroll");`.
 */
export function pageTitle(key: string) {
  return async (): Promise<Metadata> => {
    const t = await getTranslations("pageTitles");
    return { title: t(key as never) };
  };
}
