import { Asterisk } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitch } from "@/components/shell/locale-switch";

/**
 * The shell for the **only** part of SuZu One a stranger can open (FR-REC-03). It deliberately
 * shares nothing with `(app)/layout.tsx`: no `requireUser`, no navigation, no inbox counts, no
 * command palette, no person's name in a corner. Everything that layout renders is a fact about
 * the company or the reader, and none of it belongs on a page the internet can fetch.
 *
 * `robots` is overridden here: the root layout and `next.config.ts` keep search engines out of the
 * whole domain, which is right for every page but this one — a job advertisement nobody can find
 * is not an advertisement. Nothing under `(public)` is indexable *by accident*, though: each page
 * says so for itself, and the application form and the thank-you page below stay out of the index.
 */
// The advertisement is in the reader's language, and so is the tab it opens in.
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("recruit.careers");
  return {
    // `absolute`, so the careers page's tab carries the recruitment brand and not the
    // internal product's name, for the same reason the rest of this shell shares nothing with it.
    title: { absolute: t("brand"), template: "%s · SuZu Group" },
    robots: { index: true, follow: true },
  };
}

export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("recruit.careers");
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-2xl md:shadow-[var(--shell-shadow)]">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 w-full max-w-3xl items-center justify-between gap-3 px-4">
            <Link href="/careers" className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.015em]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-foreground text-background">
                <Asterisk className="size-4" aria-hidden />
              </span>
              {t("brand")}
            </Link>
            <LocaleSwitch />
          </div>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 text-xs text-muted-foreground">{t("footer")}</div>
        </footer>
      </div>
    </div>
  );
}
