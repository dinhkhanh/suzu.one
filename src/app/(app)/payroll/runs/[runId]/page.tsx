import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollRun");

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

  // Which of the steps the run allows is *this* person's to take (SRS D17). The action checks again.
  const holds: Record<(typeof RUN_STEPS)[RunStep]["permission"], boolean> = {
    "payroll:propose": canManageCompensation(user.principal, run),
    "payroll:approve": canApprovePayroll(user.principal, run),
    "payroll:pay": canPayPayroll(user.principal, run),
  };
  const mySteps = view.steps.filter((step) => holds[RUN_STEPS[step].permission]);
  const inputCodes = catalogue.filter((component) => component.source === "input").map((component) => ({ code: component.code, name: `${component.code} — ${component.name}` }));
  const payslipOf = new Map(payslips.map((row) => [row.personId, row]));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/payroll/runs" className="text-sm text-link hover:underline">
            ← {t("runs.title")}
          </Link>
          <h1>
            {entity.code} · {run.month}
            {run.name ? ` — ${run.name}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground">
            <Badge dot variant={statusTone(run.status)}>{t(`runs.statuses.${run.status}`)}</Badge>
            <span className="ml-2">{t(`runs.kinds.${run.kind}`)}</span>
          </p>
        </div>
      </header>

      {view.unverifiedParameters.length > 0 ? (
        <Alert variant="warning">{t("runs.unverified", { keys: view.unverifiedParameters.join(", ") })}</Alert>
      ) : null}

      {/* ── The month in figures ── */}
      <section className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {(
          [
            ["headcount", String(totals.headcount)],
            ["gross", formatVnd(totals.grossEarnings)],
            ["deductions", formatVnd(totals.totalDeductions)],
            ["net", formatVnd(totals.net)],
            ["employerCost", formatVnd(totals.employerCost)],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">{t(`runs.totals.${key}`)}</div>
            <div className="text-lg font-semibold tabular-nums">{value}</div>
          </div>
        ))}
      </section>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(
          [
            ["netStatutory", formatVnd(totals.netStatutory)],
            ["netSimple", formatVnd(totals.netSimple)],
            ["pit", formatVnd(totals.pit)],
            ["insurance", formatVnd(totals.employeeInsurance + totals.employerInsurance)],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="rounded-xl border p-3">
            <div className="text-xs text-muted-foreground">{t(`runs.totals.${key}`)}</div>
            <div className="tabular-nums">{value}</div>
          </div>
        ))}
      </section>

      {/* ── Calculating (ADR-09) ── */}
      {progress.state === "queued" || progress.state === "running" ? (
        <p className="rounded-md border p-3 text-sm">{t("runs.progress", { done: progress.done, total: progress.total })}</p>
      ) : null}
      {progress.state === "failed" ? (
        <p className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{t("runs.calcError", { error: progress.error ?? "" })}</p>
      ) : null}

      {/* ── Carrying the run forward (SRS D17) ── */}
      <section className="flex flex-col gap-4 rounded-xl border p-4">
        <h2 className="text-sm font-medium">{t("runs.lifecycle")}</h2>
        <ol className="flex flex-wrap gap-4 text-sm">
          {(
            [
              ["proposed", run.proposedAt],
              ["approved", run.approvedAt],
              ["payment_prepared", run.paymentPreparedAt],
              ["paid", run.paidAt],
              ["locked", run.lockedAt],
            ] as const
          ).map(([key, at]) => (
            <li key={key} className={at ? "" : "text-muted-foreground"}>
              <span className="font-medium">{t(`runs.statuses.${key}`)}</span>
              <span className="ml-2 tabular-nums">{when(at)}</span>
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap items-end gap-6">
          {editable && canManageCompensation(user.principal, run) ? <CalculateRunButton runId={run.id} label={t(run.status === "draft" ? "runs.calculate" : "runs.recalculate")} /> : null}
          {mySteps.map((step) => (
            <RunStepForm key={step} runId={run.id} step={step} label={t(`runs.steps.${step}`)} destructive={step === "return"} />
          ))}
          {editable && canManageCompensation(user.principal, run) ? <CancelRunButton runId={run.id} /> : null}
        </div>
      </section>

      {/* ── The variance check (FR-PAY-31) ── */}
      <TableCard>
        <TableCardHeader
          title={t("runs.variance.title")}
          count={variance.flagged.length || null}
          description={
            variance.hasPrevious
              ? t("runs.variance.against", { month: variance.previousMonth, previous: formatVnd(variance.totals.previousNet), change: variance.totals.changeBp === null ? "—" : `${(variance.totals.changeBp / 100).toFixed(2)}%` })
              : t("runs.variance.noPrevious")
          }
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("salaries.person")}</TableHead>
              <TableHead kind="tags">{t("runs.variance.flags")}</TableHead>
              <TableHead kind="money">{t("runs.variance.previousNet")}</TableHead>
              <TableHead kind="money">{t("runs.net")}</TableHead>
              <TableHead kind="percent">{t("runs.variance.change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variance.flagged.length === 0 ? <TableEmpty>{t("runs.variance.clean")}</TableEmpty> : null}
            {variance.flagged.map((person) => (
              <TableRow key={person.personId}>
                <TableCell>{variance.names.get(person.personId)?.fullName ?? "—"}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap gap-1">
                    {person.flags.map((flag) => (
                      <Badge key={flag} variant={flag === "negative_net" || flag === "missing_bank_account" || flag === "missing_tax_code" ? "destructive" : "outline"}>
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
                <TableCell kind="money">{person.previousNet === null ? "—" : formatVnd(person.previousNet)}</TableCell>
                <TableCell kind="money">{formatVnd(person.net)}</TableCell>
                <TableCell kind="percent">{person.changeBp === null ? "—" : `${(person.changeBp / 100).toFixed(2)}%`}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── Typed-in figures: bonuses, advances, penalties ── */}
      {seesPayslips && editable ? <RunInputForm runId={run.id} people={people.map(({ personId, fullName }) => ({ personId, fullName }))} codes={inputCodes} /> : null}

      {/* ── Paying it out (FR-PAY-33, FR-PAY-39) ── */}
      {run.approvedAt ? (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
          <div>
            <h2 className="text-sm font-medium">{t("payments.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("payments.description")}</p>
          </div>
          <Link href={`/payroll/runs/${run.id}/payments`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            {t("runs.payments")}
          </Link>
        </section>
      ) : null}

      {/* ── Releasing the payslips (FR-PAY-32) ── */}
      {view.seesPayslips && run.approvedAt ? (
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("payslips.runTitle")}</h2>
              <p className="text-sm text-muted-foreground">
                {run.payslipsPublishedAt
                  ? `${t("payslips.released")} · ${when(run.payslipsPublishedAt)} · ${payslips.filter((row) => row.firstViewedAt).length}/${payslips.length} ${t("payslips.readBy")}`
                  : t("payslips.notReleased")}
              </p>
            </div>
            <PublishPayslipsButton runId={run.id} published={!!run.payslipsPublishedAt} />
          </div>
        </section>
      ) : null}

      {/* ── The people in the run ── */}
      <TableCard>
        <TableCardHeader title={t("runs.people")} count={people.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("salaries.person")}</TableHead>
              <TableHead kind="select">{t("profiles.profile")}</TableHead>
              {seesPayslips ? <TableHead kind="money">{t("runs.totals.gross")}</TableHead> : null}
              {seesPayslips ? <TableHead kind="money">{t("runs.totals.insurance")}</TableHead> : null}
              {seesPayslips ? <TableHead kind="money">{t("runs.totals.pit")}</TableHead> : null}
              <TableHead kind="money">{t("runs.net")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {people.length === 0 ? <TableEmpty>{t("runs.noPeople")}</TableEmpty> : null}
            {people.map((person) => (
              <TableRow key={person.personId}>
                <TableCell>
                  <Link href={`/payroll/salaries/${person.personId}`} className="font-medium hover:underline">
                    {person.fullName}
                  </Link>
                  {payslipOf.get(person.personId)?.payslipId ? (
                    <Link href={`/payslips/${payslipOf.get(person.personId)!.payslipId}`} className="ml-2 text-xs text-link hover:underline">
                      {t("payslips.open")}
                    </Link>
                  ) : null}
                  <span className="ml-2 font-mono text-xs text-muted-foreground">{person.employeeCode}</span>
                  {person.inputs.map((input) => (
                    <span key={input.code} className="ml-2 text-xs text-muted-foreground">
                      {input.code} {formatVnd(input.amount)} {editable ? <RemoveRunInputButton runId={run.id} personId={person.personId} code={input.code} /> : null}
                    </span>
                  ))}
                </TableCell>
                <TableCell>
                  <Badge variant={person.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${person.profile}`)}</Badge>
                </TableCell>
                {seesPayslips ? <TableCell kind="money">{formatVnd(person.result!.totals.grossEarnings)}</TableCell> : null}
                {seesPayslips ? <TableCell kind="money">{formatVnd(person.result!.totals.employeeInsurance)}</TableCell> : null}
                {seesPayslips ? <TableCell kind="money">{formatVnd(person.result!.totals.pit)}</TableCell> : null}
                <TableCell kind="money">{formatVnd(person.net)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* ── Every step, who took it, and what they said ── */}
      <TableCard>
        <TableCardHeader title={t("runs.history")} count={events.length || null} />
        <List>
          {events.length === 0 ? <ListEmpty>{t("runs.noHistory")}</ListEmpty> : null}
          {events.map((event) => (
            <ListItem key={event.id} className="flex-wrap gap-2">
              <span className="tabular-nums text-muted-foreground">{when(event.createdAt)}</span>
              <span>
                {t(`runs.statuses.${event.fromStatus}`)} → <span className="font-medium">{t(`runs.statuses.${event.toStatus}`)}</span>
              </span>
              {event.comment ? <span className="text-muted-foreground">“{event.comment}”</span> : null}
            </ListItem>
          ))}
        </List>
      </TableCard>
    </div>
  );
}
