import { getTranslations } from "next-intl/server";
import { todayInVietnam } from "@/lib/dates";
import { readMonth } from "@/modules/performance/ui/kpi";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { ScorecardView } from "@/modules/performance/ui/scorecard";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("myKPIs");

// My KPI scorecard (FR-PRF-02): what I am measured on this month, the score and how it was worked out.
// Reading only — the figures come from my manager or HR.
export default async function MyKpisPage({ searchParams }: PageProps<"/performance/kpis">) {
  const user = await requireUser();
  const month = readMonth((await searchParams).month, todayInVietnam());
  const t = await getTranslations("performance");
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("kpi.mineTitle")}</h1>
        <p className="text-sm text-muted-foreground">{t("kpi.mineDescription")}</p>
      </header>
      <PerformanceNav active="kpis" />
      <ScorecardView personId={user.person.id} month={month} basePath="/performance/kpis" />
    </div>
  );
}
