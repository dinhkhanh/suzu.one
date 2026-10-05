import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";
import { listEntityOptions } from "@/modules/payroll/options";
import { listParallelMonths, listParallelSignoffs, reconcile } from "@/modules/payroll/parallel";
import { commitParallelImportAction, stageParallelImportAction } from "@/modules/payroll/parallel-actions";
import { parallelTemplate } from "@/modules/payroll/parallel-import";
import { canManageCompensation, compensationReach } from "@/modules/payroll/policy";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ClassifyForm, DifferenceCell, ExportParallelButton, ParallelFilters, ReferenceForm, SignOffForm } from "@/modules/payroll/ui/parallel-forms";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";

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

  const [report, format] = await Promise.all([reconcile(entityId, month), getFormatter()]);
  const summary = report.summary;
  const signoffs = report.hasReference ? await listParallelSignoffs(entityId, month, summary) : [];
  const signedOff = signoffs.some((signoff) => signoff.current);
  const money = (value: number | null | undefined) => (value === null || value === undefined ? "—" : formatVnd(value));
  const gap = (left: number | null | undefined, right: number | null | undefined) => (typeof left === "number" && typeof right === "number" ? left - right : null);

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
        actions={report.rows.length > 0 ? <ExportParallelButton entityId={entityId} month={month} /> : undefined}
      />

      <ParallelFilters entities={entities} entityId={entityId} month={month} months={known} />

      {/* ── The one state that decides go-live ── */}
      {report.hasReference ? (
        <Alert variant={summary.zeroUnexplained ? "success" : "warning"}>
          {summary.zeroUnexplained ? t("verdict.clean", { month, people: summary.people }) : t("verdict.open", { lines: summary.unexplainedLines, people: summary.differing })}
        </Alert>
      ) : (
        <Alert variant="neutral">{t("verdict.noReference")}</Alert>
      )}

      {/* ── The month on each side: paid in hand, and what it cost the company ── */}
      {report.hasReference ? (
        <TileGrid>
          <Tile label={t("totals.netSystem")} value={<>{formatVnd(report.totals.system.net)}</>} />
          <Tile label={t("totals.netReference")} value={<>{formatVnd(report.totals.reference.net)}</>} hint={`${t("totals.difference")} ${formatVnd(report.totals.system.net - report.totals.reference.net)}`} tone={report.totals.system.net === report.totals.reference.net ? "success" : "warning"} />
          <Tile label={t("totals.costSystem")} value={<>{formatVnd(report.totals.system.employerCost)}</>} />
          <Tile label={t("totals.costReference")} value={<>{report.totals.reference.withEmployerCost > 0 ? formatVnd(report.totals.reference.employerCost) : "—"}</>} hint={t("totals.costCoverage", { count: report.totals.reference.withEmployerCost, people: summary.people })} />
        </TileGrid>
      ) : null}

      {report.rows.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">{t("summary.people", { count: summary.people })}</Badge>
            <Badge variant="outline">{t("summary.matching", { count: summary.matching })}</Badge>
            <Badge variant="outline">{t("summary.differing", { count: summary.differing })}</Badge>
            {summary.missingFromSystem > 0 ? <Badge variant="outline">{t("summary.missingFromSystem", { count: summary.missingFromSystem })}</Badge> : null}
            {summary.missingFromReference > 0 ? <Badge variant="outline">{t("summary.missingFromReference", { count: summary.missingFromReference })}</Badge> : null}
          </div>
          <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("person")}</TableHead>
                <TableHead kind="money">{t("columns.netSystem")}</TableHead>
                <TableHead kind="money">{t("columns.netReference")}</TableHead>
                <TableHead kind="money">{t("columns.netDifference")}</TableHead>
                <TableHead kind="money">{t("columns.costSystem")}</TableHead>
                <TableHead kind="money">{t("columns.costReference")}</TableHead>
                <TableHead kind="text">{t("differences")}</TableHead>
                <TableHead kind="actions" className="w-40 text-left">{t("action")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report.rows.map((row) => (
                <TableRow key={row.personId}>
                  <TableCell className="align-top">
                    <RecordLink kind="person" id={row.personId}>{row.fullName}</RecordLink>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                    {row.presence !== "both" ? <p className="text-xs text-warning">{t(`presence.${row.presence}`)}</p> : null}
                  </TableCell>
                  <TableCell kind="money" className="align-top">{money(row.system?.net)}</TableCell>
                  <TableCell kind="money" className="align-top text-muted-foreground">{money(row.reference?.net)}</TableCell>
                  <TableCell kind="money" className={`align-top ${gap(row.system?.net, row.reference?.net) ? "text-warning" : "text-muted-foreground"}`}>{money(gap(row.system?.net, row.reference?.net))}</TableCell>
                  <TableCell kind="money" className="align-top">{money(row.system?.employerCost)}</TableCell>
                  <TableCell kind="money" className="align-top text-muted-foreground">{money(row.reference?.employerCost)}</TableCell>
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
          </TableCard>
        </section>
      ) : null}

      {/* ── The sign-off record: who accepted the month, on what counts, and whether it still holds ── */}
      {report.hasReference ? (
        <Section title={t("signoff.title")} count={signoffs.length || undefined} description={summary.zeroUnexplained ? (signedOff ? t("signoff.current") : t("signoff.ready")) : t("signoff.notReady")}>
          <List>
            {signoffs.length === 0 ? <ListEmpty>{t("signoff.none")}</ListEmpty> : null}
            {signoffs.map((signoff) => (
              <ListItem key={signoff.id} className="flex-col items-stretch gap-1 py-3">
                <span className="flex flex-wrap items-center gap-2">
                  <Badge dot variant={signoff.current ? "success" : "outline"}>{t(signoff.current ? "signoff.holds" : "signoff.outdated")}</Badge>
                  <RecordLink kind="person" id={signoff.signedByPersonId} className="font-medium">
                    {signoff.signedByName ?? "—"}
                  </RecordLink>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums">{format.dateTime(signoff.signedAt, { dateStyle: "medium", timeStyle: "short" })}</span>
                </span>
                <span className="text-sm text-muted-foreground">
                  {t("signoff.counts", { people: signoff.people, matching: signoff.matching, explained: signoff.explainedLines })}
                  {signoff.checkedWith ? ` · ${t("signoff.with", { name: signoff.checkedWith })}` : ""}
                </span>
                {signoff.note ? <span className="text-sm text-muted-foreground">“{signoff.note}”</span> : null}
              </ListItem>
            ))}
          </List>
          {summary.zeroUnexplained && !signedOff ? <SignOffForm entityId={entityId} month={month} /> : null}
        </Section>
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
    </Page>
  );
}
