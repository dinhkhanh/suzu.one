import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { addDays, todayInVietnam } from "@/lib/dates";
import { getPlanPage } from "@/modules/daily/service";
import { PlanForm } from "@/modules/daily/ui/plan-form";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("plan");

// FR-PJM-21: today's plan (or tomorrow's, made the evening before).
export default async function PlanPage({ searchParams }: PageProps<"/daily/plan">) {
  const user = await requireUser();
  const today = todayInVietnam();
  const { date: asked } = await searchParams;
  const date = asked === addDays(today, 1) ? asked : today;
  const [t, format, page] = await Promise.all([getTranslations("daily"), getFormatter(), getPlanPage(user.person.id, date)]);
  const day = page.day;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/today" className="underline">
            {t("today.title")}
          </Link>
        </p>
        <h1>{date === today ? t("plan.title") : t("plan.titleTomorrow")}</h1>
        <p className="text-sm text-muted-foreground">{format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })}</p>
        <div className="flex flex-wrap gap-2">
          {day?.plan.required ? <Badge variant="outline">{t("plan.requiredBy", { time: day.rules.planCutoff })}</Badge> : null}
          {day?.dayOff ? <Badge variant="secondary">{t("plan.dayOff")}</Badge> : null}
          {page.carried ? <Badge variant="info">{t("plan.carried")}</Badge> : null}
          {page.plan?.submittedAt ? <Badge variant="success">{t("plan.savedAt", { time: format.dateTime(page.plan.submittedAt, { timeStyle: "short" }) })}</Badge> : null}
        </div>
      </header>
      <PlanForm date={date} today={today} candidates={page.candidates.map(({ taskId, key, title, dueDate, estimateMinutes, projectName, stateName, status }) => ({ taskId, key, title, dueDate, estimateMinutes, projectName, stateName, status }))} selected={page.selected} dayMinutes={day?.minutes ?? 480} note={page.plan?.note ?? null} />
    </div>
  );
}
