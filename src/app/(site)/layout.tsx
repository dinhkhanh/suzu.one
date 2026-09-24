import { Asterisk } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { getTheme } from "@/theme/server";

/**
 * The public site: the home page that says what SuZu One is, and the Privacy Policy and Terms of
 * Use. Google's OAuth review reads all three, so they are open to anyone and the home page links
 * the two policies — but like the rest of the domain they stay out of search engines. Like `(public)/layout.tsx` it shares nothing with the app's
 * shell — nobody is signed in here, and the words it is handed are only its own (`site`, `legal`).
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("site");
  return { description: t("description") };
}

export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations();
  const theme = await getTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-2xl md:shadow-[var(--shell-shadow)]">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
            <Link href="/" className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.015em]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                <Asterisk className="size-4" aria-hidden />
              </span>
              {t("app.name")}
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
            <span>{t("site.footer")}</span>
            <nav className="flex flex-wrap gap-x-4 gap-y-1">
              <Link href="/" className="hover:text-foreground">{t("site.home")}</Link>
              <Link href="/privacy" className="hover:text-foreground">{t("app.privacy")}</Link>
              <Link href="/terms" className="hover:text-foreground">{t("app.terms")}</Link>
              <a href="mailto:privacy@suzu.one" className="hover:text-foreground">privacy@suzu.one</a>
            </nav>
          </div>
        </footer>
      </div>
    </div>
  );
}
