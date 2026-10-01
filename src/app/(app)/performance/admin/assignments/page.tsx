import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <TableCard>
          <TableCardHeader
            title={person.fullName}
            count={assignments.length || null}
            actions={
              <Link href={`/performance/kpis/${person.personId}`} className="text-sm underline underline-offset-4">
                {t("assignments.scorecard")}
              </Link>
            }
          />
          <List>
            {assignments.length === 0 ? <ListEmpty>{t("assignments.none")}</ListEmpty> : null}
            {assignments.map((assignment) => (
              <ListItem key={assignment.id} className="flex-col items-stretch gap-2">
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
                      <AssignmentRowForm assignment={{ id: assignment.id, weight: assignment.weight, unit: assignment.kpi.unit, targetText: metricValueText(assignment.kpi.unit, assignment.targetValue), toPeriod: assignment.toPeriod }} />
                    </div>
                  </details>
                ) : null}
              </ListItem>
            ))}
          </List>
          <TableAddRow label={t("assignments.addTitle")} open={assignments.length === 0}>
            <NewAssignmentForm personId={person.personId} kpis={kpis.map((kpi) => ({ id: kpi.id, name: `${kpi.name} (${kpi.code})`, unit: kpi.unit }))} defaultFrom={month} />
          </TableAddRow>
          <TableAddRow label={t("assignments.fromTemplate")} open={assignments.length === 0}>
            <ApplyTemplatesForm personId={person.personId} defaultFrom={month} label={t("positions.applyOne")} />
          </TableAddRow>
        </TableCard>
        <p className="text-xs text-muted-foreground">{t("assignments.closedHint")}</p>
      </div>
    );
  }

  const assignments = await listAssignments({ personIds: people.map((person) => person.personId) });
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-3xl text-sm text-muted-foreground">{t("assignments.description")}</p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("team.person")}</TableHead>
            <TableHead kind="number">{t("assignments.kpisNow")}</TableHead>
            <TableHead kind="number">{t("positions.weight")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {people.length === 0 ? <TableEmpty>{t("assignments.noPeople")}</TableEmpty> : null}
          {people.map((person) => {
            const current = assignments.filter((assignment) => assignment.personId === person.personId && coversMonth(assignment, month));
            return (
              <TableRow key={person.personId}>
                <TableCell>
                  <Link href={`/performance/admin/assignments?person=${person.personId}`} className="font-medium hover:underline">
                    {person.fullName}
                  </Link>
                </TableCell>
                <TableCell kind="number">{current.length === 0 ? <span className="text-warning">{t("assignments.noneNow")}</span> : current.length}</TableCell>
                <TableCell kind="number">{current.length === 0 ? "—" : current.reduce((sum, assignment) => sum + assignment.weight, 0)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
