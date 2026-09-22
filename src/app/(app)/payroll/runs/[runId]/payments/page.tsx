import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { hasReached } from "@/modules/payroll/lifecycle";
import { cashSheetOf, listCashPayments, listPaymentFiles, listPayables, openFileTotal, planPayment, settle } from "@/modules/payroll/payments";
import { canManageCompensation, canPayPayroll, canReadPayroll } from "@/modules/payroll/policy";
import { getRun } from "@/modules/payroll/runs";
import { formatVnd } from "@/modules/payroll/ui/money";
import { BankFileForm, DisbursementForm, OpenCashSheetButton } from "@/modules/payroll/ui/payment-forms";

export const metadata: Metadata = { title: "Payroll payment" };

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
        <Link href={`/payroll/runs/${runId}`} className="text-sm text-muted-foreground hover:underline">
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
        <ul className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
          {settlement.blockers.map((blocker) => (
            <li key={blocker}>{t(`blockers.${blocker}` as "blockers.bank_file_missing")}</li>
          ))}
        </ul>
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
      {pays && plan.banks.length > 0 ? <BankFileForm runId={runId} banks={plan.banks.map((group) => ({ key: group.key, name: group.name, people: group.people.length }))} defaultValueDate={today} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">{t("bank.generatedFiles")}</h2>
        {files.filter((file) => file.channel === "bank").length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("bank.noFiles")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("bank.file")}</TableHead>
                <TableHead>{t("bank.formatVersion")}</TableHead>
                <TableHead className="text-right">{t("bank.rows")}</TableHead>
                <TableHead className="text-right">{t("bank.total")}</TableHead>
                <TableHead>{t("bank.generatedAt")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files
                .filter((file) => file.channel === "bank")
                .map((file) => (
                  <TableRow key={file.id}>
                    <TableCell className="font-mono text-xs">{file.fileName}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{file.formatVersion}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {file.rowCount}
                      {file.skippedCount > 0 ? <span className="ml-2 text-xs text-destructive">+{file.skippedCount}</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatVnd(openFileTotal(file))}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{format.dateTime(file.generatedAt, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        )}
      </section>

      {/* ── The cash sheet (FR-PAY-39) ── */}
      {plan.cash.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-medium">{t("cash.title")}</h2>
              <p className="text-sm text-muted-foreground">{t("cash.hint")}</p>
            </div>
            <div className="flex items-center gap-3">
              {cash.length > 0 ? (
                <a href={`/payroll/runs/${runId}/payments/cash-sheet`} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted" download>
                  {t("cash.print")}
                </a>
              ) : null}
              {pays || manages ? <OpenCashSheetButton runId={runId} opened={cash.length > 0} /> : null}
            </div>
          </div>

          {cash.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cash.notOpened")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("cash.person")}</TableHead>
                  <TableHead className="text-right">{t("cash.amount")}</TableHead>
                  <TableHead>{t("cash.disbursedOn")}</TableHead>
                  <TableHead>{t("cash.receipt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cash.map((row) => (
                  <TableRow key={row.personId}>
                    <TableCell>
                      {row.fullName}
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatVnd(row.amount)}</TableCell>
                    <TableCell>{row.disbursedOn ? <span className="tabular-nums">{row.disbursedOn}</span> : pays ? <DisbursementForm runId={runId} personId={row.personId} defaultDate={today} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <Badge variant={row.receiptConfirmed ? "secondary" : "outline"}>{t(row.receiptConfirmed ? "cash.confirmed" : "cash.awaitingReceipt")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground">{t("cash.receiptNote")}</p>
        </section>
      ) : null}
    </div>
  );
}
