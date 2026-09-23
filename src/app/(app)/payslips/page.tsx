import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <section className="flex flex-col gap-3 rounded-xl border p-4">
          <h2 className="text-sm font-medium">{tCash("confirm")}</h2>
          {toConfirm.map((row) => (
            <div key={row.runId} className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <span>
                {row.month} · <span className="tabular-nums">{formatVnd(row.amount)}</span>
                <span className="ml-2 text-muted-foreground">{row.disbursedOn}</span>
              </span>
              <ConfirmReceiptButton runId={row.runId} />
            </div>
          ))}
        </section>
      ) : null}

      {payslips.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("entity")}</TableHead>
              <TableHead className="text-right">{t("net")}</TableHead>
              <TableHead>{t("published")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
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
                <TableCell className="text-right tabular-nums">{formatVnd(payslip.net)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{format.dateTime(payslip.publishedAt, { dateStyle: "medium" })}</TableCell>
                <TableCell className="text-right">
                  {payslip.openQueries > 0 ? <Badge variant="outline">{t("queryOpen")}</Badge> : null}
                  <Link href={`/payslips/${payslip.id}`} className="ml-2 text-sm hover:underline">
                    {t("open")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
