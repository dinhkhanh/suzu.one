import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { statusTone } from "@/components/ui/tone";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { resolveCatalogue } from "@/modules/payroll/components";
import { RUN_STEPS, type RunStep } from "@/modules/payroll/lifecycle";
import { canApprovePayroll, canManageCompensation, canPayPayroll } from "@/modules/payroll/policy";
import { getRunView } from "@/modules/payroll/run-views";
import { formatVnd } from "@/modules/payroll/ui/money";
import { listPayslipsOfRun } from "@/modules/payroll/payslips";
import { PublishPayslipsButton } from "@/modules/payroll/ui/payslip-forms";
import { CalculateRunButton, CancelRunButton, RemoveRunInputButton, RunInputForm, RunStepForm } from "@/modules/payroll/ui/run-forms";
import { RunStepper } from "@/modules/payroll/ui/run-stepper";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollRun");

const SERIOUS = new Set(["negative_net", "missing_bank_account", "missing_tax_code"]);

export default async function PayrollRunPage({ params }: PageProps<"/payroll/runs/[runId]">) {
  const user = await requireUser();
  const { runId } = await params;
  // A run outside the viewer's reach answers exactly like one that does not exist.
  const view = await getRunView(user.principal, runId);
  if (!view) notFound();
  requireStepUp(user, `/payroll/runs/${runId}`);

  const { run, entity, totals, progress, variance, people, events, seesPayslips } = view;
  const editable = run.status === "draft" || run.status === "calculated";
  const [t, format, payslips, catalogue] = await Promise.all([
    getTranslations("payroll"),
    getFormatter(),
    // Payslips exist only once the CEO has signed (FR-PAY-32); before that there is nothing to show.
    // The names are the ones the variance check already read.
    seesPayslips && run.approvedAt ? listPayslipsOfRun(run.id, variance.names) : [],
    seesPayslips && editable ? resolveCatalogue(run.entityId, `${run.month}-01` as `${number}-${number}-${number}`) : [],
  ]);
  const when = (value: Date | null) => (value ? format.dateTime(value, { dateStyle: "medium", timeStyle: "short" }) : "—");
  const percent = (bp: number | null) => (bp === null ? "—" : `${(bp / 100).toFixed(2)}%`);

  // Which of the steps the run allows is *this* person's to take (SRS D17). The action checks again.
  const holds: Record<(typeof RUN_STEPS)[RunStep]["permission"], boolean> = {
    "payroll:propose": canManageCompensation(user.principal, run),
    "payroll:approve": canApprovePayroll(user.principal, run),
    "payroll:pay": canPayPayroll(user.principal, run),
  };
  const mySteps = view.steps.filter((step) => holds[RUN_STEPS[step].permission]);
  const inputCodes = catalogue.filter((component) => component.source === "input").map((component) => ({ code: component.code, name: `${component.code} — ${component.name}` }));
  const payslipOf = new Map(payslips.map((row) => [row.personId, row]));
  const manages = canManageCompensation(user.principal, run);
  const hasActions = (editable && manages) || mySteps.length > 0;
  const milestones = [
    ["proposed", run.proposedAt],
    ["approved", run.approvedAt],
    ["payment_prepared", run.paymentPreparedAt],
    ["paid", run.paidAt],
    ["locked", run.lockedAt],
  ] as const;

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/payroll/runs" className="text-link hover:underline">
              ← {t("runs.title")}
            </Link>
            <span className="text-faint">·</span>
            <Badge dot variant={statusTone(run.status)}>{t(`runs.statuses.${run.status}`)}</Badge>
            <Badge variant="outline">{t(`runs.kinds.${run.kind}`)}</Badge>
          </span>
        }
        title={
          <>
            <span className="font-mono tabular-nums">{run.month}</span> · {entity.code}
            {run.name ? <span className="text-muted-foreground"> — {run.name}</span> : null}
          </>
        }
        actions={
          run.approvedAt ? (
            <Link href={`/payroll/runs/${run.id}/payments`} className={buttonVariants({ variant: "outline" })}>
              {t("runs.payments")}
            </Link>
          ) : undefined
        }
      />

      {view.unverifiedParameters.length > 0 ? <Alert variant="warning">{t("runs.unverified", { keys: view.unverifiedParameters.join(", ") })}</Alert> : null}
      {progress.state === "queued" || progress.state === "running" ? <Alert variant="info">{t("runs.progress", { done: progress.done, total: progress.total })}</Alert> : null}
      {progress.state === "failed" ? <Alert variant="destructive">{t("runs.calcError", { error: progress.error ?? "" })}</Alert> : null}

      {/* ── Where the run is, and the step this person may take (SRS D17) ── */}
      <Card>
        <CardContent className="flex flex-col gap-5">
          <RunStepper status={run.status} />
          <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            {milestones
              .filter(([, at]) => at)
              .map(([key, at]) => (
                <div key={key} className="flex gap-1.5">
                  <dt>{t(`runs.statuses.${key}`)}</dt>
                  <dd className="font-mono tabular-nums">{when(at)}</dd>
                </div>
              ))}
          </dl>
        </CardContent>
        {hasActions ? (
          <CardFooter className="flex-col items-stretch gap-4 md:flex-row md:flex-wrap md:items-end">
            {editable && manages ? <CalculateRunButton runId={run.id} label={t(run.status === "draft" ? "runs.calculate" : "runs.recalculate")} /> : null}
            {mySteps.map((step) => (
              <RunStepForm key={step} runId={run.id} step={step} label={t(`runs.steps.${step}`)} destructive={step === "return"} />
            ))}
            {editable && manages ? <CancelRunButton runId={run.id} /> : null}
          </CardFooter>
        ) : null}
      </Card>

      {/* ── The month in figures ── */}
      <TileGrid>
        <Tile label={t("runs.totals.gross")} value={<>{formatVnd(totals.grossEarnings)}</>} hint={`${t("runs.totals.headcount")}: ${totals.headcount}`} />
        <Tile label={t("runs.totals.net")} value={<>{formatVnd(totals.net)}</>} hint={`${t("runs.totals.netStatutory")} ${formatVnd(totals.netStatutory)}`} />
        <Tile label={t("runs.totals.insurance")} value={<>{formatVnd(totals.employerInsurance)}</>} hint={`${t("runs.totals.pit")} ${formatVnd(totals.pit)} · ${t("runs.totals.employerCost")} ${formatVnd(totals.employerCost)}`} />
        <Tile label={t("runs.exceptions")} value={<>{variance.flagged.length}</>} tone={variance.flagged.length > 0 ? "destructive" : "success"} hint={variance.hasPrevious ? t("runs.variance.against", { month: variance.previousMonth, previous: formatVnd(variance.totals.previousNet), change: percent(variance.totals.changeBp) }) : t("runs.variance.noPrevious")} />
      </TileGrid>

      {/* ── The variance check (FR-PAY-31): what to look at before signing ── */}
      <Section title={t("runs.exceptions")} count={variance.flagged.length || undefined}>
        <Table containerClassName="hidden md:block">
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("salaries.person")}</TableHead>
              <TableHead kind="tags">{t("runs.variance.flags")}</TableHead>
              <TableHead kind="money">{t("runs.variance.previousNet")}</TableHead>
              <TableHead kind="money">{t("runs.net")}</TableHead>
              <TableHead kind="percent">{t("runs.variance.change")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {variance.flagged.length === 0 ? <TableEmpty>{t("runs.variance.clean")}</TableEmpty> : null}
            {variance.flagged.map((person) => (
              <TableRow key={person.personId}>
                <TableCell className="font-medium">{variance.names.get(person.personId)?.fullName ?? "—"}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {person.flags.map((flag) => (
                      <Badge key={flag} dot variant={SERIOUS.has(flag) ? "destructive" : "warning"}>
                        {t(`runs.variance.flagNames.${flag}`)}
                      </Badge>
                    ))}
                    {person.warnings.map((warning) => (
                      <Badge key={warning} variant="outline">
                        {t(`runs.warnings.${warning}`)}
                      </Badge>
                    ))}
                  </span>
                </TableCell>
                <TableCell kind="money" className="text-muted-foreground">{person.previousNet === null ? "—" : formatVnd(person.previousNet)}</TableCell>
                <TableCell kind="money">{formatVnd(person.net)}</TableCell>
                <TableCell kind="percent" className={person.changeBp !== null && Math.abs(person.changeBp) >= 2000 ? "text-warning" : undefined}>{percent(person.changeBp)}</TableCell>
                <TableCell kind="actions">
                  <span className="flex justify-end gap-1.5">
                    <Link href={`/payroll/salaries/${person.personId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t("runs.openPayFile")}
                    </Link>
                    {payslipOf.get(person.personId)?.payslipId ? (
                      <Link href={`/payslips/${payslipOf.get(person.personId)!.payslipId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                        {t("payslips.open")}
                      </Link>
                    ) : null}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <List className="md:hidden">
          {variance.flagged.length === 0 ? <ListEmpty>{t("runs.variance.clean")}</ListEmpty> : null}
          {variance.flagged.map((person) => (
            <ListItem key={person.personId} className="flex-col items-stretch gap-1.5">
              <span className="flex items-center justify-between gap-2">
                <span className="truncate font-medium">{variance.names.get(person.personId)?.fullName ?? "—"}</span>
                <span className="font-mono text-[0.8125rem] tabular-nums">{formatVnd(person.net)}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {person.flags.map((flag) => (
                  <Badge key={flag} dot variant={SERIOUS.has(flag) ? "destructive" : "warning"}>
                    {t(`runs.variance.flagNames.${flag}`)}
                  </Badge>
                ))}
              </span>
              <span className="flex gap-1.5">
                <Link href={`/payroll/salaries/${person.personId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                  {t("runs.openPayFile")}
                </Link>
              </span>
            </ListItem>
          ))}
        </List>
      </Section>

      {/* ── Typed-in figures: bonuses, advances, penalties ── */}
      {seesPayslips && editable ? <RunInputForm runId={run.id} people={people.map(({ personId, fullName }) => ({ personId, fullName }))} codes={inputCodes} /> : null}

      {/* ── Releasing the payslips (FR-PAY-32) ── */}
      {view.seesPayslips && run.approvedAt ? (
        <Card size="sm">
          <CardContent className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-[0.9375rem]">{t("payslips.runTitle")}</h2>
              <p className="text-sm text-muted-foreground">{run.payslipsPublishedAt ? `${t("payslips.released")} · ${when(run.payslipsPublishedAt)} · ${payslips.filter((row) => row.firstViewedAt).length}/${payslips.length} ${t("payslips.readBy")}` : t("payslips.notReleased")}</p>
            </div>
            <PublishPayslipsButton runId={run.id} published={!!run.payslipsPublishedAt} />
          </CardContent>
        </Card>
      ) : null}

      {/* ── The people in the run ── */}
      <Section title={t("runs.people")} count={people.length || undefined}>
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("salaries.person")}</TableHead>
                <TableHead kind="select">{t("profiles.profile")}</TableHead>
                {seesPayslips ? <TableHead kind="money">{t("runs.totals.gross")}</TableHead> : null}
                {seesPayslips ? <TableHead kind="money">{t("runs.totals.insurance")}</TableHead> : null}
                {seesPayslips ? <TableHead kind="money">{t("runs.totals.pit")}</TableHead> : null}
                <TableHead kind="money">{t("runs.net")}</TableHead>
                <TableHead kind="status">{t("runs.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {people.length === 0 ? <TableEmpty>{t("runs.noPeople")}</TableEmpty> : null}
              {people.map((person) => {
                const payslip = payslipOf.get(person.personId);
                return (
                  <TableRow key={person.personId}>
                    <TableCell className="max-w-72 whitespace-normal">
                      <Link href={`/payroll/salaries/${person.personId}`} className="font-medium hover:underline">
                        {person.fullName}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-faint">{person.employeeCode}</span>
                      {person.inputs.length > 0 ? (
                        <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                          {person.inputs.map((input) => (
                            <span key={input.code} className="inline-flex items-center gap-1">
                              <span className="font-mono tabular-nums">
                                {input.code} {formatVnd(input.amount)}
                              </span>
                              {editable ? <RemoveRunInputButton runId={run.id} personId={person.personId} code={input.code} /> : null}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant={person.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${person.profile}`)}</Badge>
                    </TableCell>
                    {seesPayslips ? <TableCell kind="money">{formatVnd(person.result!.totals.grossEarnings)}</TableCell> : null}
                    {seesPayslips ? <TableCell kind="money" className="text-muted-foreground">{formatVnd(person.result!.totals.employeeInsurance)}</TableCell> : null}
                    {seesPayslips ? <TableCell kind="money" className="text-muted-foreground">{formatVnd(person.result!.totals.pit)}</TableCell> : null}
                    <TableCell kind="money" className="font-medium">{formatVnd(person.net)}</TableCell>
                    <TableCell>
                      {person.warnings.length > 0 ? (
                        <Badge dot variant="warning">{t(`runs.warnings.${person.warnings[0]}` as "runs.warnings.negative_net")}</Badge>
                      ) : payslip?.payslipId ? (
                        <Link href={`/payslips/${payslip.payslipId}`} className="inline-flex">
                          <Badge dot variant={payslip.firstViewedAt ? "success" : "info"} className="hover:underline">
                            {payslip.firstViewedAt ? t("runs.lineStatus.read") : t("runs.lineStatus.published")}
                          </Badge>
                        </Link>
                      ) : (
                        <Badge dot variant={statusTone(run.status)}>{t(`runs.statuses.${run.status}`)}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
        <p className="px-0.5 text-xs text-faint">{t("runs.compliance")}</p>
      </Section>

      {/* ── Every step, who took it, and what they said ── */}
      <Section title={t("runs.history")} count={events.length || undefined}>
        <List>
          {events.length === 0 ? <ListEmpty>{t("runs.noHistory")}</ListEmpty> : null}
          {events.map((event) => (
            <ListItem key={event.id} className="flex-wrap gap-x-3 gap-y-1">
              <span className="font-mono text-xs text-muted-foreground tabular-nums">{when(event.createdAt)}</span>
              <span>
                {t(`runs.statuses.${event.fromStatus}`)} → <span className="font-medium">{t(`runs.statuses.${event.toStatus}`)}</span>
              </span>
              {event.comment ? <span className="text-muted-foreground">“{event.comment}”</span> : null}
            </ListItem>
          ))}
        </List>
      </Section>
    </Page>
  );
}
