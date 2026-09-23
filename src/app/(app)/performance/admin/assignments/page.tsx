import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { canManageAssignmentsOf, coversMonth, listAssignments, listKpis, loadDirectory, metricValueText } from "@/modules/performance/service";
import { kpiValueText, monthLabel } from "@/modules/performance/ui/kpi";
import { ApplyTemplatesForm, AssignmentRowForm, NewAssignmentForm } from "@/modules/performance/ui/kpi-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("kPIAssignments");

// Who is measured on what (FR-PRF-02). HR over the person only — weights and targets decide a bonus.
export default async function KpiAssignmentsPage({ searchParams }: PageProps<"/performance/admin/assignments">) {
  const user = await requireUser();
  const params = await searchParams;
  const directory = await loadDirectory();
  const people = [...directory.values()].filter((person) => person.status !== "offboarded" && canManageAssignmentsOf(user.principal, person)).sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
  const t = await getTranslations("performance");
  const format = await getFormatter();
  const month = todayInVietnam().slice(0, 7);

  if (typeof params.person === "string") {
    const person = people.find((candidate) => candidate.personId === params.person);
    if (!person) notFound();
    const [assignments, kpis] = await Promise.all([listAssignments({ personIds: [person.personId] }), listKpis()]);
    return (
      <div className="flex flex-col gap-4">
        <Link href="/performance/admin/assignments" className="text-sm underline underline-offset-4">
          {t("assignments.back")}
        </Link>
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h2>{person.fullName}</h2>
          <Link href={`/performance/kpis/${person.personId}`} className="text-sm underline underline-offset-4">
            {t("assignments.scorecard")}
          </Link>
        </header>
        {assignments.length === 0 ? <p className="text-sm text-muted-foreground">{t("assignments.none")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {assignments.map((assignment) => (
            <li key={assignment.id} className="flex flex-col gap-2 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-medium">{assignment.kpi.name}</span>
                <span className="text-xs text-muted-foreground">
                  {[assignment.kpi.code, t(`kpi.frequency.${assignment.kpi.frequency}`), t("assignments.range", { from: monthLabel(assignment.fromPeriod), to: assignment.toPeriod ? monthLabel(assignment.toPeriod) : "…" }), t("entry.target", { value: kpiValueText(format, assignment.kpi.unit, assignment.targetValue) }), t("assignments.weight", { weight: assignment.weight })].join(" · ")}
                </span>
              </div>
              {assignment.toPeriod === null || assignment.toPeriod >= month ? (
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">{t("assignments.change")}</summary>
                  <div className="pt-2">
                    <AssignmentRowForm assignment={{ id: assignment.id, weight: assignment.weight, targetText: metricValueText(assignment.kpi.unit, assignment.targetValue), toPeriod: assignment.toPeriod }} />
                  </div>
                </details>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("assignments.closedHint")}</p>
        <section className="rounded-xl border p-3">
          <h3 className="pb-3 text-sm font-medium">{t("assignments.fromTemplate")}</h3>
          <ApplyTemplatesForm personId={person.personId} defaultFrom={month} label={t("positions.applyOne")} />
        </section>
        <section className="rounded-xl border p-3">
          <h3 className="pb-3 text-sm font-medium">{t("assignments.addTitle")}</h3>
          <NewAssignmentForm personId={person.personId} kpis={kpis.map((kpi) => ({ id: kpi.id, name: `${kpi.name} (${kpi.code})` }))} defaultFrom={month} />
        </section>
      </div>
    );
  }

  const assignments = await listAssignments({ personIds: people.map((person) => person.personId) });
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("assignments.description")}</p>
      <ul className="flex flex-col divide-y rounded-xl border">
        {people.map((person) => {
          const current = assignments.filter((assignment) => assignment.personId === person.personId && coversMonth(assignment, month));
          return (
            <li key={person.personId} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
              <Link href={`/performance/admin/assignments?person=${person.personId}`} className="min-w-0 flex-1 font-medium hover:underline">
                {person.fullName}
              </Link>
              <span className={`text-xs ${current.length === 0 ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground"}`}>{current.length === 0 ? t("assignments.noneNow") : t("assignments.count", { count: current.length, weight: current.reduce((sum, assignment) => sum + assignment.weight, 0) })}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
