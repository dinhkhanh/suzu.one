import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
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
      <div className="flex max-w-md flex-col gap-4">
        <header>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("impersonating", { name: user.person.fullName })}</p>
        </header>
      </div>
    );
  }

  return (
    <div className="flex max-w-md flex-col gap-4">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description", { minutes: STEP_UP_WINDOW_MINUTES })}</p>
      </header>
      {params.error ? (
        <p role="alert" className="text-sm text-destructive">
          {t("errors.rejected")}
        </p>
      ) : null}
      {driver === "local" ? (
        <LocalStepUpForm next={next} />
      ) : (
        // A plain link on purpose: the round trip leaves the site, so it must be a full navigation.
        <a href={`/api/step-up/start?next=${encodeURIComponent(next)}`} className="inline-flex h-9 items-center self-start rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          {t("google", { email: user.email })}
        </a>
      )}
    </div>
  );
}
