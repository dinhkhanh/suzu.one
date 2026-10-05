import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { getTheme } from "@/theme/server";

/**
 * The shell of the brand guidelines on the public domain (FR-BRD-04, suzu.vn/brands): for
 * partners, suppliers and the press, signed in or not. Like the careers and review shells it shares
 * nothing with the app's own layout — no `requireUser`, no navigation, no person — and it is handed
 * only its own words (`brands.public`, see `src/i18n/surfaces.ts`).
 *
 * `robots` is decided per page: the list and a listed kit are meant to be found; a kit shared by
 * link only is not.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brands.public");
  return {
    title: { absolute: t("metaTitle"), template: `%s · ${t("brand")}` },
    description: t("metaDescription"),
    manifest: null,
  };
}

export default async function BrandsLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("brands.public");
  const theme = await getTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-2xl md:border md:border-border">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-3 px-4">
            <Link href="/brands" className="flex min-w-0 items-center gap-2 text-[0.9375rem] font-semibold tracking-[-0.015em]">
              <Logo className="size-7 shrink-0 text-brand" />
              <span className="truncate">{t("brand")}</span>
            </Link>
            <div className="flex items-center gap-2">
              <ThemeSwitch theme={theme} />
              <LocaleSwitch />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 md:py-10">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-muted-foreground">{t("footer")}</div>
        </footer>
      </div>
    </div>
  );
}
