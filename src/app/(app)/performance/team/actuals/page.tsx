import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { getEntryGrid } from "@/modules/performance/service";
import { kpiValueText, MonthPicker, readMonth } from "@/modules/performance/ui/kpi";
import { ActualsGrid, type GridPerson } from "@/modules/performance/ui/kpi-forms";
import { PerformanceNav } from "@/modules/performance/ui/nav";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "KPI actuals" };

// Entering the month's actuals (FR-PRF-02): for the people below me, or — for HR — in my scope.
// Never my own row. The action checks every line again.
export default async function ActualsPage({ searchParams }: PageProps<"/performance/team/actuals">) {
  const user = await requireUser();
  const month = readMonth((await searchParams).month, todayInVietnam());
  const rows = await getEntryGrid({ principal: user.principal, personId: user.person.id }, month);
  const t = await getTranslations("performance");
  const format = await getFormatter();
  // Nobody to enter for in any month means this screen is not theirs; an empty month is just empty.
  if (rows.length === 0 && (await getEntryGrid({ principal: user.principal, personId: user.person.id }, todayInVietnam().slice(0, 7))).length === 0) notFound();
  const people: GridPerson[] = rows.map((row) => ({
    personId: row.personId,
    fullName: row.fullName,
    closed: row.closed,
    lines: row.lines.map((line) => ({ assignmentId: line.assignmentId, periodKey: line.periodKey, kpiCode: line.kpiCode, kpiName: line.kpiName, unit: line.unit, direction: line.direction, targetText: kpiValueText(format, line.unit, line.targetValue), actualValue: line.actualValue, notApplicable: line.notApplicable, note: line.note ?? null })),
  }));

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("entry.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("entry.description")}</p>
      </header>
      <PerformanceNav active="team" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <MonthPicker month={month} href={(next) => `/performance/team/actuals?month=${next}`} labels={{ previous: t("kpi.previousMonth"), next: t("kpi.nextMonth") }} />
        <Link href={`/performance/team?month=${month}`} className="text-sm underline underline-offset-4">
          {t("entry.back")}
        </Link>
      </div>
      {people.length === 0 ? <p className="text-sm text-muted-foreground">{t("entry.empty")}</p> : <ActualsGrid key={month} people={people} />}
    </div>
  );
}
