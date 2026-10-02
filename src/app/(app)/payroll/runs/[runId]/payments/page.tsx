import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
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
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href={`/payroll/runs/${runId}`} className="font-mono text-link tabular-nums hover:underline">
            ← {run.month}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />

      {/* ── Bank and cash are reported apart, all the way through (FR-PAY-39) ── */}
      <TileGrid>
        <Tile label={t("bankTotal")} value={<>{formatVnd(plan.bankTotal)}</>} hint={t("people", { count: settlement.bankPeople })} />
        <Tile label={t("cashTotal")} value={<>{formatVnd(plan.cashTotal)}</>} hint={t("people", { count: plan.cash.length })} />
        <Tile label={t("settled")} value={<>{settlement.settled ? t("settledYes") : t("settledNo")}</>} tone={settlement.settled ? "success" : "warning"} />
      </TileGrid>

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
        <Alert variant="destructive">
          <ul className="flex w-full flex-col gap-0.5">
            <li className="font-medium">{t("unroutableTitle")}</li>
            {settlement.unpaidBank.map((person) => (
              <li key={person.personId}>
                <RecordLink kind="person" id={person.personId}>{person.fullName}</RecordLink> — {t(`bank.skipReasons.${person.reason}` as "bank.skipReasons.no_account")}
              </li>
            ))}
          </ul>
        </Alert>
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
                  <TableCell kind="id" className="text-foreground">{file.fileName}</TableCell>
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
        <Section>
          <TableCard>
            <TableCardHeader
              title={t("cash.title")}
              count={cash.length || null}
              description={t("cash.hint")}
              actions={
                <>
                  {cash.length > 0 ? (
                    <a href={`/payroll/runs/${runId}/payments/cash-sheet`} className={buttonVariants({ variant: "outline", size: "sm" })} download>
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
                      <RecordLink kind="person" id={row.personId}>{row.fullName}</RecordLink>
                      <span className="ml-2 font-mono text-xs text-faint">{row.employeeCode}</span>
                    </TableCell>
                    <TableCell kind="money">{formatVnd(row.amount)}</TableCell>
                    <TableCell>{row.disbursedOn ? <span className="font-mono text-[0.8125rem] tabular-nums">{row.disbursedOn}</span> : pays ? <DisbursementForm runId={runId} personId={row.personId} defaultDate={today} /> : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      <Badge dot variant={row.receiptConfirmed ? "success" : "warning"}>{t(row.receiptConfirmed ? "cash.confirmed" : "cash.awaitingReceipt")}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <p className="px-0.5 text-xs text-faint">{t("cash.receiptNote")}</p>
        </Section>
      ) : null}
    </Page>
  );
}
