import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { hasReached } from "@/modules/payroll/lifecycle";
import { cashSheetOf, listCashPayments, listPaymentFiles, listPayables, openFileTotal, planPayment, settle } from "@/modules/payroll/payments";
import { canManageCompensation, canPayPayroll, canReadPayroll } from "@/modules/payroll/policy";
import { getRun } from "@/modules/payroll/runs";
import { formatVnd } from "@/modules/payroll/ui/money";
import { BankFileForm, DisbursementForm, OpenCashSheetButton } from "@/modules/payroll/ui/payment-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollPayment");

/**
 * Paying an approved run (FR-PAY-33, FR-PAY-39). The chief accountant works here; C&B and the
 * other payroll readers can see how far it has got, because the run cannot move to "paid" until
 * it is settled and everyone watching the calendar needs to know why.
 */
export default async function PayrollPaymentsPage({ params }: PageProps<"/payroll/runs/[runId]/payments">) {
  const user = await requireUser();
  const { runId } = await params;
  const run = await getRun(runId);
  // Out of reach answers exactly like not there.
  if (!run || !canReadPayroll(user.principal, run)) notFound();
  // Nothing to pay before the CEO has signed.
  if (!hasReached(run, "approved")) notFound();
  requireStepUp(user, `/payroll/runs/${runId}/payments`);

  const pays = canPayPayroll(user.principal, run);
  const manages = canManageCompensation(user.principal, run);
  // Each thing read once; the settlement and the cash sheet are worked out from it.
  const [t, format, payables, files, cashRows] = await Promise.all([getTranslations("payroll.payments"), getFormatter(), listPayables(run), listPaymentFiles(runId), listCashPayments(runId)]);
  const plan = planPayment(payables);
  const settlement = settle(plan, files, cashRows);
  const cash = cashSheetOf(cashRows, payables);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href={`/payroll/runs/${runId}`} className="text-sm text-link hover:underline">
          ← {run.month}
        </Link>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      {/* ── Bank and cash are reported apart, all the way through (FR-PAY-39) ── */}
      <section className="grid gap-3 sm:grid-cols-3">
        {(
          [
            ["bankTotal", formatVnd(plan.bankTotal), `${settlement.bankPeople}`],
            ["cashTotal", formatVnd(plan.cashTotal), `${plan.cash.length}`],
            ["settled", settlement.settled ? t("settledYes") : t("settledNo"), ""],
          ] as const
        ).map(([key, value, count]) => (
          <div key={key} className="rounded-xl border p-4">
            <div className="text-xs text-muted-foreground">{t(key)}</div>
            <div className="text-lg font-semibold tabular-nums">{value}</div>
            {count ? <div className="text-xs text-muted-foreground">{t("people", { count: Number(count) })}</div> : null}
          </div>
        ))}
      </section>

      {settlement.blockers.length > 0 ? (
        <Alert variant="warning">
          <ul className="flex w-full flex-col gap-0.5">
            {settlement.blockers.map((blocker) => (
              <li key={blocker}>{t(`blockers.${blocker}` as "blockers.bank_file_missing")}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {/* ── Anybody the bank channel cannot reach: named, never dropped ── */}
      {settlement.unpaidBank.length > 0 ? (
        <section className="rounded-md border border-destructive/40 p-3 text-sm">
          <p className="font-medium">{t("unroutableTitle")}</p>
          <ul>
            {settlement.unpaidBank.map((person) => (
              <li key={person.personId} className="text-muted-foreground">
                {person.fullName} — {t(`bank.skipReasons.${person.reason}` as "bank.skipReasons.no_account")}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* ── The bank batches (FR-PAY-33) ── */}
      <TableCard>
        <TableCardHeader title={t("bank.generatedFiles")} count={files.filter((file) => file.channel === "bank").length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="file">{t("bank.file")}</TableHead>
              <TableHead kind="id">{t("bank.formatVersion")}</TableHead>
              <TableHead kind="number">{t("bank.rows")}</TableHead>
              <TableHead kind="money">{t("bank.total")}</TableHead>
              <TableHead kind="date">{t("bank.generatedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.filter((file) => file.channel === "bank").length === 0 ? <TableEmpty>{t("bank.noFiles")}</TableEmpty> : null}
            {files
              .filter((file) => file.channel === "bank")
              .map((file) => (
                <TableRow key={file.id}>
                  <TableCell className="font-mono text-xs">{file.fileName}</TableCell>
                  <TableCell kind="id">{file.formatVersion}</TableCell>
                  <TableCell kind="number">
                    {file.rowCount}
                    {file.skippedCount > 0 ? <span className="ml-2 text-xs text-destructive">+{file.skippedCount}</span> : null}
                  </TableCell>
                  <TableCell kind="money">{formatVnd(openFileTotal(file))}</TableCell>
                  <TableCell className="text-muted-foreground">{format.dateTime(file.generatedAt, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        {pays && plan.banks.length > 0 ? (
          <TableAddRow label={t("bank.title")} open={files.filter((file) => file.channel === "bank").length === 0}>
            <BankFileForm runId={runId} banks={plan.banks.map((group) => ({ key: group.key, name: group.name, people: group.people.length }))} defaultValueDate={today} />
          </TableAddRow>
        ) : null}
      </TableCard>

      {/* ── The cash sheet (FR-PAY-39) ── */}
      {plan.cash.length > 0 ? (
        <section className="flex flex-col gap-3">
          <TableCard>
            <TableCardHeader
              title={t("cash.title")}
              count={cash.length || null}
              description={t("cash.hint")}
              actions={
                <>
                  {cash.length > 0 ? (
                    <a href={`/payroll/runs/${runId}/payments/cash-sheet`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" download>
                      {t("cash.print")}
                    </a>
                  ) : null}
                  {pays || manages ? <OpenCashSheetButton runId={runId} opened={cash.length > 0} /> : null}
                </>
              }
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead kind="person">{t("cash.person")}</TableHead>
                  <TableHead kind="money">{t("cash.amount")}</TableHead>
                  <TableHead kind="date">{t("cash.disbursedOn")}</TableHead>
                  <TableHead kind="status">{t("cash.receipt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cash.length === 0 ? <TableEmpty>{t("cash.notOpened")}</TableEmpty> : null}
                {cash.map((row) => (
                  <TableRow key={row.personId}>
                    <TableCell>
                      {row.fullName}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                    </TableCell>
                    <TableCell kind="money">{formatVnd(row.amount)}</TableCell>
                    <TableCell>{row.disbursedOn ? <span className="tabular-nums">{row.disbursedOn}</span> : pays ? <DisbursementForm runId={runId} personId={row.personId} defaultDate={today} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <Badge variant={row.receiptConfirmed ? "secondary" : "outline"}>{t(row.receiptConfirmed ? "cash.confirmed" : "cash.awaitingReceipt")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <p className="text-xs text-muted-foreground">{t("cash.receiptNote")}</p>
        </section>
      ) : null}
    </div>
  );
}
