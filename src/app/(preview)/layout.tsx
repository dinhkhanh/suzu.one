import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { getTheme } from "@/theme/server";

/**
 * The shell for the client's review link (D24, FR-PJM-51a) — the second part of the product a
 * stranger can open, and the only one that is not about hiring. It is its own route group, and not
 * the careers shell next door, because that shell is an advertisement: it carries the recruitment
 * brand, a link back to the job list and a footer written for candidates. A client looking at a
 * video has no business being offered a job, and no business being shown what else we publish.
 *
 * Like `(public)/layout.tsx`, it deliberately shares nothing with the application's own layout: no
 * `requireUser`, no navigation, no inbox, no command palette, no person's name in a corner.
 * Everything that layout renders is a fact about the company or the reader.
 *
 * `robots` stays off. The careers page overrides it because an advertisement nobody can find is not
 * an advertisement; a link to one client's unfinished work is the opposite of that, and the URL
 * **is** the credential.
 */
// `manifest: null` drops the app's web manifest from this page: it names and describes the
// internal product ("chấm công, nghỉ phép…") and offers to install it, neither of which is a fact
// about the client's own work. The same reasoning as the rest of this shell.
export const metadata: Metadata = { robots: { index: false, follow: false }, manifest: null };

export default async function PreviewLayout({ children }: LayoutProps<"/">) {
  const t = await getTranslations("preview");
  const theme = await getTheme();
  return (
    <div className="flex min-h-dvh flex-col bg-canvas p-0 md:p-2.5">
      <div className="flex min-h-0 flex-1 flex-col bg-background md:rounded-2xl md:shadow-[var(--shell-shadow)]">
        <header className="border-b border-border">
          <div className="mx-auto flex h-14 w-full max-w-2xl items-center justify-between gap-3 px-4">
            <span className="text-[0.9375rem] font-semibold tracking-[-0.015em]">{t("brand")}</span>
            <div className="flex items-center gap-2">
              <ThemeSwitch theme={theme} />
              <LocaleSwitch />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto w-full max-w-2xl px-4 py-6 text-xs text-muted-foreground">{t("footer")}</div>
        </footer>
      </div>
    </div>
  );
}
