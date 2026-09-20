import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LocaleSwitch } from "@/components/shell/locale-switch";

/**
 * The shell for the **only** part of Suzu One a stranger can open (FR-REC-03). It deliberately
 * shares nothing with `(app)/layout.tsx`: no `requireUser`, no navigation, no inbox counts, no
 * command palette, no person's name in a corner. Everything that layout renders is a fact about
 * the company or the reader, and none of it belongs on a page the internet can fetch.
 *
 * `robots` is overridden here: the root layout tells crawlers to stay out of the whole product,
 * which is right for every page but this one — a job advertisement nobody can find is not an
 * advertisement. Nothing under `(public)` is indexable *by accident*, though: each page says so
 * for itself, and the application form and the thank-you page below stay out of the index.
 */
export const metadata: Metadata = {
  title: { default: "Tuyển dụng · Suzu Group", template: "%s · Suzu Group" },
  robots: { index: true, follow: true },
};

export default async function PublicLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("recruit.careers");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-4">
          <Link href="/careers" className="text-base font-semibold tracking-tight">
            {t("brand")}
          </Link>
          <LocaleSwitch />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      <footer className="border-t">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 text-xs text-muted-foreground">{t("footer")}</div>
      </footer>
    </div>
  );
}
