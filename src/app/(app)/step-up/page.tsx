import { ShieldCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { stepUpDriver } from "@/modules/platform/auth/step-up";
import { isStepUpFresh, safeNextPath, STEP_UP_WINDOW_MINUTES } from "@/modules/platform/auth/step-up-policy";
import { LocalStepUpForm } from "@/modules/platform/auth/ui/local-step-up-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reAuthenticate");
export const dynamic = "force-dynamic";

// Salary and payroll screens ask for a recent proof of identity (FR-PLT-06, NFR-SEC-08).
export default async function StepUpPage({ searchParams }: PageProps<"/step-up">) {
  const user = await requireUser();
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  if (isStepUpFresh(user.reauthAt)) redirect(next);
  const t = await getTranslations("stepUp");
  const driver = stepUpDriver();

  // A borrowed session (FR-PLT-40) carries no proof of its own to refresh: proving who *you* are
  // would open what only the person seen as may open. Say so instead of sending them round again.
  if (user.impersonator) {
    return (
      <Page width="narrow">
        <PageHeader title={t("title")} />
        <Alert variant="warning">{t("impersonating", { name: user.person.fullName })}</Alert>
      </Page>
    );
  }

  return (
    <Page width="narrow">
      <PageHeader title={t("title")} description={t("description", { minutes: STEP_UP_WINDOW_MINUTES })} />
      {params.error ? <Alert variant="destructive">{t("errors.rejected")}</Alert> : null}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheckIcon aria-hidden className="size-5" />
          </span>
          {driver === "local" ? (
            <LocalStepUpForm next={next} />
          ) : (
            // A plain link on purpose: the round trip leaves the site, so it must be a full navigation.
            <a href={`/api/step-up/start?next=${encodeURIComponent(next)}`} className={buttonVariants({ variant: "accent", size: "lg", className: "h-auto min-h-12 w-full py-3 text-center whitespace-normal md:w-auto md:self-start" })}>
              {t("google", { email: user.email })}
            </a>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
