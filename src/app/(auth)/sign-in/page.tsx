import { Asterisk } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LocaleSwitch } from "@/components/shell/locale-switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { GoogleSignInButton } from "./google-sign-in-button";

// The page is in the reader's language, so its tab is too (the root layout adds "· SuZu One").
export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("signIn"))("title") };
}

const KNOWN_ERRORS = ["not_a_workspace_account", "domain_not_allowed", "not_provisioned", "access_revoked", "email_not_verified"] as const;

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getCurrentUser()) redirect("/today");

  const t = await getTranslations();
  const { error } = await searchParams;
  const code = Array.isArray(error) ? error[0] : error;
  const known = KNOWN_ERRORS.find((item) => item === code?.toLowerCase());
  const message = code ? t(`signIn.errors.${known ?? "generic"}`) : null;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-canvas px-4">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex size-10 items-center justify-center rounded-xl bg-foreground text-background">
          <Asterisk className="size-5" aria-hidden />
        </span>
        <p className="text-lg font-semibold tracking-[-0.015em]">{t("app.name")}</p>
        <p className="text-sm text-muted-foreground">{t("app.tagline")}</p>
      </div>
      <Card className="w-full max-w-sm shadow-[var(--shell-shadow)]">
        <CardHeader>
          <CardTitle>{t("signIn.title")}</CardTitle>
          <CardDescription>{t("signIn.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {message ? (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {message}
            </p>
          ) : null}
          <GoogleSignInButton label={t("signIn.google")} />
        </CardContent>
      </Card>
      <LocaleSwitch />
      <nav className="flex gap-4 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground">{t("app.privacy")}</Link>
        <Link href="/terms" className="hover:text-foreground">{t("app.terms")}</Link>
      </nav>
    </main>
  );
}
