import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { getTheme } from "@/theme/server";

/**
 * The public domain's home page (PUBLIC_SITE_URL, e.g. suzu.vn — `src/lib/site-routing.ts`): the
 * company, for clients and candidates, and nothing of the internal app. No sign-in button, no app
 * name, no link to a page the public domain does not serve. It shares nothing with the app's shell
 * and is handed only its own words (`portfolio`, `theme`).
 *
 * Unlike the rest of the product it may be indexed: it is the company's front door. `/portfolio` on
 * the app's domain redirects here, so only the public address is ever indexed.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portfolio");
  return {
    title: { absolute: t("title"), template: `%s · ${t("title")}` },
    description: t("description"),
    robots: { index: true, follow: true },
    manifest: null,
  };
}

export default async function PortfolioLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("portfolio");
  const theme = await getTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-2xl md:shadow-[var(--shell-shadow)]">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
            <Link href="/" className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.015em]">
              <Logo className="size-7 shrink-0 text-brand" />
              {t("title")}
            </Link>
            <div className="flex items-center gap-2">
              <ThemeSwitch theme={theme} />
              <LocaleSwitch />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
            <span>{t("footer")}</span>
            <Link href="/careers" className="hover:text-foreground">{t("careersLink")}</Link>
          </div>
        </footer>
      </div>
    </div>
  );
}
