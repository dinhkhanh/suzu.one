import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityBankAccounts } from "@/modules/platform/org/service";
import { BANK_FORMATS, interbankFormat } from "@/modules/payroll/exports/banks";
import { hasReached, isLocked } from "@/modules/payroll/lifecycle";
import { cashSheetOf, listCashPayments, listCashSheetScans, listOtherPayments, listPaymentFiles, listPayables, openFileTotal, type PaymentState, type PersonPayment, planPayment, settle } from "@/modules/payroll/payments";
import { canManageCompensation, canPayPayroll, canReadPayroll } from "@/modules/payroll/policy";
import { getRun } from "@/modules/payroll/runs";
import { formatVnd } from "@/modules/payroll/ui/money";
import { BankFileForm, CashSheetScanLink, CashSheetScanUpload, DisbursementForm, OpenCashSheetButton, OtherPaymentForm, RemoveOtherPaymentButton } from "@/modules/payroll/ui/payment-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollPayment");

const STATE_TONE: Record<PaymentState, "success" | "warning" | "destructive" | "info" | "outline"> = {
  in_file: "success",
  awaiting_file: "warning",
  cannot_transfer: "destructive",
  paid_other: "info",
  cash_disbursed: "success",
  cash_pending: "warning",
  nothing_owed: "outline",
  negative_net: "warning",
};

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
  // Each thing read once; the settlement and the cash sheet are worked out from it. The signed
  // sheet's scans are for the people who may print the sheet — the accountant and C&B.
  const [t, format, payables, files, cashRows, others, accounts, scans] = await Promise.all([
    getTranslations("payroll.payments"),
    getFormatter(),
    listPayables(run),
    listPaymentFiles(runId),
    listCashPayments(runId),
    listOtherPayments(runId),
    listEntityBankAccounts(run.entityId),
    pays || manages ? listCashSheetScans(runId) : [],
  ]);
  const plan = planPayment(payables);
  const settlement = settle(plan, files, cashRows, others);
  const cash = cashSheetOf(cashRows, payables);
  const today = new Date().toISOString().slice(0, 10);
  // How a run is paid may still be written down until it is called "paid"; a locked run takes nothing.
  const beingPaid = !hasReached(run, "paid");
  const locked = isLocked(run);

  const bankFiles = files.filter((file) => file.channel === "bank");
  const latest = new Set(settlement.latestFileIds);
  const bankNameOf = new Map(plan.banks.map((group) => [group.key, group.name]));
  const accountOf = new Map(accounts.map((account) => [account.id, account]));
  const owedNothing = plan.nothingOwed.length + plan.negative.length;

  /** Where one person's pay goes and why — the routing rule's answer for them, in words. */
  const routeOf = (person: PersonPayment): string => {
    if (person.state === "nothing_owed" || person.state === "negative_net") return "—";
    if (person.route.channel === "cash") return t("routing.cash");
    if (person.route.channel === "none") return t(`bank.skipReasons.${person.route.reason}` as "bank.skipReasons.no_account");
    const bank = bankNameOf.get(person.route.bank) ?? person.route.bank;
    return person.route.via === "own_bank" ? t("routing.ownBank", { bank }) : t("routing.interbank", { bank, other: person.bankName ?? "—" });
  };

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
        <Tile label={t("settled")} value={<>{settlement.settled ? t("settledYes") : t("settledNo")}</>} tone={settlement.settled ? "success" : "warning"} hint={owedNothing > 0 ? t("owedNothing", { count: owedNothing }) : undefined} />
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

      {/* ── Anybody no file can carry: named, never dropped — and never a dead end ── */}
      {settlement.unpaidBank.length > 0 ? (
        <Alert variant="destructive">
          <ul className="flex w-full flex-col gap-0.5">
            <li className="font-medium">{t("unroutableTitle")}</li>
            {settlement.unpaidBank.map((person) => (
              <li key={person.personId}>
                <RecordLink kind="person" id={person.personId}>
                  {person.fullName}
                </RecordLink>{" "}
                — {t(`bank.skipReasons.${person.reason}` as "bank.skipReasons.no_account")}
              </li>
            ))}
            <li className="text-xs">{t("unroutableHint")}</li>
          </ul>
        </Alert>
      ) : null}

      {/* ── Who goes into which file, and why (FR-PAY-33) ── */}
      <Section
        title={t("routing.title")}
        count={settlement.people.length || undefined}
        description={t("routing.rule", {
          ownBanks: Object.values(BANK_FORMATS)
            .map((bankFormat) => bankFormat.name)
            .join(", "),
          interbank: interbankFormat()?.name ?? t("routing.noInterbank"),
        })}
      >
        <TableCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("routing.person")}</TableHead>
                <TableHead kind="money">{t("routing.net")}</TableHead>
                <TableHead kind="text">{t("routing.route")}</TableHead>
                <TableHead kind="status">{t("routing.state")}</TableHead>
                {pays && beingPaid ? <TableHead kind="actions">{t("routing.action")}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {settlement.people.length === 0 ? <TableEmpty>{t("routing.empty")}</TableEmpty> : null}
              {settlement.people.map((person) => (
                <TableRow key={person.personId}>
                  <TableCell>
                    <RecordLink kind="person" id={person.personId}>
                      {person.fullName}
                    </RecordLink>
                    <span className="ml-2 font-mono text-xs text-faint">{person.employeeCode}</span>
                  </TableCell>
                  <TableCell kind="money">{formatVnd(person.net)}</TableCell>
                  <TableCell className="whitespace-normal text-muted-foreground">{routeOf(person)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <Badge dot variant={STATE_TONE[person.state]}>
                      {t(`routing.states.${person.state}` as "routing.states.in_file")}
                    </Badge>
                    {person.state === "cannot_transfer" && person.problem && person.route.channel === "bank" ? (
                      <span className="ml-2 text-xs text-destructive">{t(`bank.skipReasons.${person.problem}` as "bank.skipReasons.no_account")}</span>
                    ) : null}
                    {person.other ? (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        <span className="font-mono tabular-nums">{person.other.paidOn}</span> · {person.other.reference} · {person.other.reason}
                      </span>
                    ) : null}
                  </TableCell>
                  {pays && beingPaid ? (
                    <TableCell>
                      {person.other ? (
                        <RemoveOtherPaymentButton runId={runId} personId={person.personId} />
                      ) : person.state === "cannot_transfer" || person.state === "awaiting_file" ? (
                        <OtherPaymentForm runId={runId} personId={person.personId} personName={person.fullName} defaultDate={today} />
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

      {/* ── The bank batches (FR-PAY-33): the latest of each bank counts, the rest are superseded ── */}
      <TableCard>
        <TableCardHeader title={t("bank.generatedFiles")} count={bankFiles.length || null} description={bankFiles.length > latest.size ? t("bank.supersededHint") : undefined} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="file">{t("bank.file")}</TableHead>
              <TableHead kind="status">{t("bank.fileState")}</TableHead>
              <TableHead kind="number">{t("bank.rows")}</TableHead>
              <TableHead kind="money">{t("bank.total")}</TableHead>
              <TableHead kind="id">{t("bank.payingAccount")}</TableHead>
              <TableHead kind="id">{t("bank.formatVersion")}</TableHead>
              <TableHead kind="date">{t("bank.generatedAt")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {bankFiles.length === 0 ? <TableEmpty>{t("bank.noFiles")}</TableEmpty> : null}
            {bankFiles.map((file) => {
              const current = latest.has(file.id);
              const account = file.payingAccountId ? accountOf.get(file.payingAccountId) : undefined;
              return (
                <TableRow key={file.id} className={current ? undefined : "text-muted-foreground"}>
                  <TableCell kind="id" className={current ? "text-foreground" : undefined}>
                    {file.fileName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={current ? "success" : "outline"}>{t(current ? "bank.current" : "bank.superseded")}</Badge>
                  </TableCell>
                  <TableCell kind="number">
                    {file.rowCount}
                    {file.skippedCount > 0 ? <span className={current ? "ml-2 text-xs text-destructive" : "ml-2 text-xs"}>+{file.skippedCount}</span> : null}
                  </TableCell>
                  <TableCell kind="money">{formatVnd(openFileTotal(file))}</TableCell>
                  <TableCell kind="id">{account ? account.accountNumber : t("bank.typedAccount")}</TableCell>
                  <TableCell kind="id">{file.formatVersion}</TableCell>
                  <TableCell className="text-muted-foreground">{format.dateTime(file.generatedAt, { dateStyle: "short", timeStyle: "short" })}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {pays && plan.banks.length > 0 ? (
          <TableAddRow label={t("bank.title")} open={bankFiles.length === 0}>
            <BankFileForm
              runId={runId}
              entityId={run.entityId}
              banks={plan.banks.map((group) => ({ key: group.key, name: group.name, people: group.people.length, interbank: group.interbank }))}
              accounts={accounts
                .filter((account) => account.isActive)
                .map((account) => ({ id: account.id, bank: account.bank, accountNumber: account.accountNumber, accountName: account.accountName, branch: account.branch, isDefault: account.isDefault }))}
              defaultValueDate={today}
            />
          </TableAddRow>
        ) : null}
      </TableCard>

      {/* ── The cash sheet (FR-PAY-39): what was actually handed over, against the net ── */}
      {plan.cash.length > 0 ? (
        <Section>
          <TableCard>
            <TableCardHeader
              title={t("cash.title")}
              count={cash.length || null}
              description={t("cash.hint")}
              actions={
                <>
                  {cash.length > 0 && (pays || manages) ? (
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
                  <TableHead kind="money">{t("cash.disbursedAmount")}</TableHead>
                  <TableHead kind="date">{t("cash.disbursedOn")}</TableHead>
                  <TableHead kind="status">{t("cash.receipt")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cash.length === 0 ? <TableEmpty>{t("cash.notOpened")}</TableEmpty> : null}
                {cash.map((row) => {
                  const recorded = row.disbursedOn && row.disbursedAmount !== null && row.disbursedAmount !== undefined ? { disbursedOn: row.disbursedOn, amount: row.disbursedAmount, note: row.note ?? null } : undefined;
                  const difference = recorded ? row.amount - recorded.amount : 0;
                  return (
                    <TableRow key={row.personId}>
                      <TableCell>
                        <RecordLink kind="person" id={row.personId}>
                          {row.fullName}
                        </RecordLink>
                        <span className="ml-2 font-mono text-xs text-faint">{row.employeeCode}</span>
                      </TableCell>
                      <TableCell kind="money">{formatVnd(row.amount)}</TableCell>
                      <TableCell kind="money" className="whitespace-normal">
                        {recorded ? formatVnd(recorded.amount) : <span className="text-muted-foreground">—</span>}
                        {recorded && difference !== 0 ? <span className="block text-xs text-warning">{t("cash.difference", { amount: formatVnd(difference) })}</span> : null}
                        {recorded?.note ? <span className="block text-xs text-muted-foreground">{recorded.note}</span> : null}
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        {recorded ? <span className="font-mono text-[0.8125rem] tabular-nums">{recorded.disbursedOn}</span> : null}
                        {pays && !locked ? <DisbursementForm runId={runId} personId={row.personId} net={row.amount} defaultDate={today} recorded={recorded} /> : recorded ? null : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <Badge dot variant={row.receiptConfirmed ? "success" : "warning"}>
                          {t(row.receiptConfirmed ? "cash.confirmed" : "cash.awaitingReceipt")}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              {cash.length > 0 ? (
                <TableFooter>
                  <TableRow>
                    <TableCell className="font-semibold">{t("cash.reconciliation")}</TableCell>
                    <TableCell kind="money" className="font-semibold">
                      {formatVnd(settlement.cashNet)}
                    </TableCell>
                    <TableCell kind="money" className="font-semibold">
                      {formatVnd(settlement.cashDisbursedTotal)}
                    </TableCell>
                    <TableCell colSpan={2} className={settlement.cashNet === settlement.cashDisbursedTotal ? "text-muted-foreground" : "text-warning"}>
                      {settlement.cashNet === settlement.cashDisbursedTotal ? t("cash.reconciled") : t("cash.notYetHandedOver", { amount: formatVnd(settlement.cashNet - settlement.cashDisbursedTotal) })}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
          </TableCard>
          <p className="px-0.5 text-xs text-faint">{t("cash.receiptNote")}</p>

          {/* The printed sheet, signed and scanned: evidence kept with the run, at the compensation tier. */}
          {cash.length > 0 && (pays || manages) ? (
            <TableCard>
              <TableCardHeader title={t("cash.scanTitle")} count={scans.length || null} description={t("cash.scanHint")} />
              <List>
                {scans.length === 0 ? <ListItem className="text-sm text-muted-foreground">{t("cash.scanEmpty")}</ListItem> : null}
                {scans.map((file) => (
                  <ListItem key={file.id} className="flex-wrap items-center justify-between gap-2">
                    <CashSheetScanLink runId={runId} fileId={file.id} fileName={file.fileName} removable={pays && !locked} />
                    <span className="font-mono text-xs text-faint tabular-nums">{format.dateTime(file.createdAt, { dateStyle: "short", timeStyle: "short" })}</span>
                  </ListItem>
                ))}
                <ListItem>
                  <CashSheetScanUpload runId={runId} />
                </ListItem>
              </List>
            </TableCard>
          ) : null}
        </Section>
      ) : null}
    </Page>
  );
}
