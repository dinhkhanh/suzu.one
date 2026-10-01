import { getFormatter, getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
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
  const badges = [
    day?.plan.required ? <Badge key="required" variant="outline">{t("plan.requiredBy", { time: day.rules.planCutoff })}</Badge> : null,
    day?.dayOff ? <Badge key="off" variant="secondary">{t("plan.dayOff")}</Badge> : null,
    page.carried ? <Badge key="carried" variant="info">{t("plan.carried")}</Badge> : null,
    page.plan?.submittedAt ? <Badge key="saved" dot variant="success">{t("plan.savedAt", { time: format.dateTime(page.plan.submittedAt, { timeStyle: "short" }) })}</Badge> : null,
  ].filter(Boolean);

  return (
    <Page width="narrow">
      <PageHeader eyebrow={format.dateTime(new Date(`${date}T12:00:00Z`), { weekday: "long", day: "numeric", month: "long" })} title={date === today ? t("plan.title") : t("plan.titleTomorrow")}>
        {badges.length > 0 ? <div className="flex flex-wrap gap-1.5 pt-1">{badges}</div> : null}
      </PageHeader>
      <PlanForm date={date} today={today} candidates={page.candidates.map(({ taskId, key, title, dueDate, estimateMinutes, projectName, stateName, status }) => ({ taskId, key, title, dueDate, estimateMinutes, projectName, stateName, status }))} selected={page.selected} dayMinutes={day?.minutes ?? 480} note={page.plan?.note ?? null} />
    </Page>
  );
}
