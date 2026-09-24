import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { listEntityOptions } from "@/modules/payroll/options";
import { listParallelMonths, reconcile } from "@/modules/payroll/parallel";
import { commitParallelImportAction, stageParallelImportAction } from "@/modules/payroll/parallel-actions";
import { parallelTemplate } from "@/modules/payroll/parallel-import";
import { canManageCompensation, compensationReach } from "@/modules/payroll/policy";
import { ClassifyForm, DifferenceCell, ParallelFilters, ReferenceForm } from "@/modules/payroll/ui/parallel-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("parallelRun");

/**
 * The parallel run (FR-PAY-38). C&B and the owner only.
 *
 * Go-live turns on one sentence of the development plan — "a parallel cycle with zero unexplained
 * differences" — so that state is what this page reports, in a banner nobody has to interpret.
 */
export default async function ParallelRunPage({ searchParams }: PageProps<"/payroll/parallel">) {
  const user = await requireUser();
  const [entities, params, t] = await Promise.all([listEntityOptions(compensationReach(user.principal)), searchParams, getTranslations("payroll.parallel")]);
  if (entities.length === 0) notFound();
  requireStepUp(user, "/payroll/parallel");

  const asString = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const entityId = entities.find((entity) => entity.id === asString(params.entityId))?.id ?? entities[0].id;
  // Re-checked here although the entity came from the viewer's own reach: the id is in the URL.
  if (!canManageCompensation(user.principal, { entityId })) notFound();

  // The reference form only needs names: the entity's people, nothing decrypted.
  const [known, people] = await Promise.all([listParallelMonths(entityId), listEmploymentFacts({ entityIds: [entityId] })]);
  const today = new Date();
  const wanted = asString(params.month);
  const month = wanted && /^\d{4}-(0[1-9]|1[0-2])$/.test(wanted) ? wanted : (known[0] ?? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`);

  const report = await reconcile(entityId, month);
  const summary = report.summary;

  return (
    <div className="flex flex-col gap-8">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <ParallelFilters entities={entities} entityId={entityId} month={month} months={known} />

      {/* ── The one state that decides go-live ── */}
      {report.hasReference ? (
        <p className={`rounded-xl border p-4 text-sm ${summary.zeroUnexplained ? "border-emerald-500/50 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5"}`}>
          {summary.zeroUnexplained ? t("verdict.clean", { month, people: summary.people }) : t("verdict.open", { lines: summary.unexplainedLines, people: summary.differing })}
        </p>
      ) : (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("verdict.noReference")}</p>
      )}

      {report.rows.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t("summary.people", { count: summary.people })}</Badge>
            <Badge variant="outline">{t("summary.matching", { count: summary.matching })}</Badge>
            <Badge variant="outline">{t("summary.differing", { count: summary.differing })}</Badge>
            {summary.missingFromSystem > 0 ? <Badge variant="outline">{t("summary.missingFromSystem", { count: summary.missingFromSystem })}</Badge> : null}
            {summary.missingFromReference > 0 ? <Badge variant="outline">{t("summary.missingFromReference", { count: summary.missingFromReference })}</Badge> : null}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("person")}</TableHead>
                <TableHead>{t("differences")}</TableHead>
                <TableHead className="w-40">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.personId}>
                  <TableCell className="align-top">
                    {row.fullName}
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                    {row.presence !== "both" ? <p className="text-xs text-warning">{t(`presence.${row.presence}`)}</p> : null}
                  </TableCell>
                  <TableCell className="align-top">
                    {row.matches ? (
                      <span className="text-sm text-muted-foreground">{t("identical")}</span>
                    ) : (
                      <div className="flex flex-col gap-2">
                        {row.differences.map((line) => (
                          <DifferenceCell key={line.field} line={line} />
                        ))}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-col gap-2">
                      {row.differences.map((line) => (
                        <ClassifyForm key={line.field} entityId={entityId} month={month} personId={row.personId} line={line} />
                      ))}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {/* ── Getting the other method's figures in: a file, or one person at a time ── */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-medium">{t("import.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("import.hint", { month })}</p>
        <ImportWizard title={t("import.wizard")} template={{ fileName: `doi-chieu-${month}.csv`, csv: parallelTemplate() }} stageAction={stageParallelImportAction} commitAction={commitParallelImportAction}>
          <input type="hidden" name="entityId" value={entityId} />
          <input type="hidden" name="month" value={month} />
        </ImportWizard>
      </section>

      {people.length > 0 ? <ReferenceForm entityId={entityId} month={month} people={people.map((fact) => ({ personId: fact.personId, fullName: fact.fullName, employeeCode: fact.employeeCode }))} /> : null}
    </div>
  );
}
