import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListItem } from "@/components/ui/list";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listCashAwaitingReceipt } from "@/modules/payroll/payments";
import { listMyPayslips } from "@/modules/payroll/payslips";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ConfirmReceiptButton } from "@/modules/payroll/ui/payment-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payslips");

/** My payslips (FR-PAY-32). Every signed-in person has this page; it shows their own months only. */
export default async function MyPayslipsPage() {
  const user = await requireUser();
  requireStepUp(user, "/payslips");
  const [t, tCash, format, payslips, cash] = await Promise.all([getTranslations("payroll.payslips"), getTranslations("payroll.payments.cash"), getFormatter(), listMyPayslips(user.person.id), listCashAwaitingReceipt(user.person.id)]);
  // Cash that has been handed over and is waiting for this person's own confirmation (FR-PAY-39).
  const toConfirm = cash.filter((row) => row.disbursedOn);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1>{t("mine")}</h1>
        <p className="text-sm text-muted-foreground">{t("mineDescription")}</p>
      </header>

      {toConfirm.length > 0 ? (
        <TableCard>
          <TableCardHeader title={tCash("confirm")} count={toConfirm.length} />
          <List>
            {toConfirm.map((row) => (
              <ListItem key={row.runId} className="flex-wrap justify-between">
                <span>
                  {row.month} · <span className="tabular-nums">{formatVnd(row.amount)}</span>
                  <span className="ml-2 text-muted-foreground">{row.disbursedOn}</span>
                </span>
                <ConfirmReceiptButton runId={row.runId} />
              </ListItem>
            ))}
          </List>
        </TableCard>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="date">{t("month")}</TableHead>
            <TableHead kind="org">{t("entity")}</TableHead>
            <TableHead kind="money">{t("net")}</TableHead>
            <TableHead kind="date">{t("published")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {payslips.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {payslips.map((payslip) => (
            <TableRow key={payslip.id}>
              <TableCell>
                <Link href={`/payslips/${payslip.id}`} className="font-medium hover:underline">
                  {payslip.month}
                </Link>
                {payslip.kind === "off_cycle" ? <span className="ml-2 text-xs text-muted-foreground">{payslip.runName}</span> : null}
                {payslip.firstViewedAt ? null : (
                  <Badge className="ml-2 text-[10px]" variant="default">
                    {t("new")}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">{payslip.entityCode}</TableCell>
              <TableCell kind="money">{formatVnd(payslip.net)}</TableCell>
              <TableCell className="text-muted-foreground">{format.dateTime(payslip.publishedAt, { dateStyle: "medium" })}</TableCell>
              <TableCell kind="actions">
                {payslip.openQueries > 0 ? <Badge variant="outline">{t("queryOpen")}</Badge> : null}
                <Link href={`/payslips/${payslip.id}`} className="ml-2 text-sm hover:underline">
                  {t("open")}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
