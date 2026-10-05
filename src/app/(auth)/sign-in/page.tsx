import { Logo } from "@/components/brand/logo";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { ThemeSwitch } from "@/components/shell/theme-switch";
import { Alert } from "@/components/ui/alert";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { getTheme } from "@/theme/server";
import { GoogleSignInButton } from "./google-sign-in-button";

// The page is in the reader's language, so its tab is too (the root layout adds "· SuZu One").
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signIn"))("title") };
}

const KNOWN_ERRORS = ["not_a_workspace_account", "domain_not_allowed", "not_provisioned", "access_revoked", "email_not_verified", "rate_limited"] as const;

// The front door: the mark, the name and one key, centred on paper. Nothing else competes.
export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getCurrentUser()) redirect("/today");

  const t = await getTranslations();
  const theme = await getTheme();
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const known = KNOWN_ERRORS.find((item) => item === code?.toLowerCase());
  const message = code ? t(`signIn.errors.${known ?? "generic"}`) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="flex w-full max-w-xs flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <Logo className="size-14 text-brand" />
          <div className="flex flex-col gap-1">
            <p className="text-xl font-semibold tracking-[-0.02em]">{t("app.name")}</p>
            <p className="text-sm text-muted-foreground">{t("app.tagline")}</p>
          </div>
        </div>
        <div className="flex w-full flex-col gap-4">
          {message ? <Alert variant="destructive">{message}</Alert> : null}
          <GoogleSignInButton label={t("signIn.google")} />
          <p className="text-center text-xs leading-relaxed text-faint">{t("signIn.subtitle")}</p>
        </div>
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-center gap-2">
            <ThemeSwitch theme={theme} />
            <LocaleSwitch />
          </div>
          <nav className="flex gap-4 text-xs text-faint">
            <Link href="/privacy" className="hover:text-foreground">{t("app.privacy")}</Link>
            <Link href="/terms" className="hover:text-foreground">{t("app.terms")}</Link>
          </nav>
        </div>
      </div>
    </main>
  );
}
