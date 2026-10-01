import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listCashAwaitingReceipt } from "@/modules/payroll/payments";
import { listMyPayslips } from "@/modules/payroll/payslips";
import { formatVnd } from "@/modules/payroll/ui/money";
import { ConfirmReceiptButton } from "@/modules/payroll/ui/payment-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payslips");

const monthLabel = (month: string) => month.split("-").reverse().join("/");

/** My payslips (FR-PAY-32). Every signed-in person has this page; it shows their own months only. */
export default async function MyPayslipsPage() {
  const user = await requireUser();
  requireStepUp(user, "/payslips");
  const [t, tCash, format, payslips, cash] = await Promise.all([getTranslations("payroll.payslips"), getTranslations("payroll.payments.cash"), getFormatter(), listMyPayslips(user.person.id), listCashAwaitingReceipt(user.person.id)]);
  // Cash that has been handed over and is waiting for this person's own confirmation (FR-PAY-39).
  const toConfirm = cash.filter((row) => row.disbursedOn);

  return (
    <Page>
      <PageHeader title={t("mine")} description={t("mineDescription")} />

      {toConfirm.length > 0 ? (
        <Section title={tCash("confirm")} count={toConfirm.length}>
          <List>
            {toConfirm.map((row) => (
              <ListItem key={row.runId} className="flex-wrap justify-between">
                <span className="flex flex-col">
                  <span className="font-medium">
                    <span className="font-mono tabular-nums">{monthLabel(row.month)}</span> · <span className="font-mono tabular-nums">{formatVnd(row.amount)}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{row.disbursedOn}</span>
                </span>
                <ConfirmReceiptButton runId={row.runId} />
              </ListItem>
            ))}
          </List>
        </Section>
      ) : null}

      <Table containerClassName="hidden md:block">
        <TableHeader>
          <TableRow>
            <TableHead kind="date">{t("month")}</TableHead>
            <TableHead kind="org">{t("entity")}</TableHead>
            <TableHead kind="money">{t("net")}</TableHead>
            <TableHead kind="date">{t("published")}</TableHead>
            <TableHead kind="status" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {payslips.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
          {payslips.map((payslip) => (
            <TableRow key={payslip.id}>
              <TableCell>
                <Link href={`/payslips/${payslip.id}`} className="font-mono font-medium tabular-nums hover:underline">
                  {monthLabel(payslip.month)}
                </Link>
                {payslip.kind === "off_cycle" ? <span className="ml-2 text-xs text-muted-foreground">{payslip.runName}</span> : null}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">{payslip.entityCode}</TableCell>
              <TableCell kind="money" className="font-medium">{formatVnd(payslip.net)}</TableCell>
              <TableCell className="text-muted-foreground">{format.dateTime(payslip.publishedAt, { dateStyle: "medium" })}</TableCell>
              <TableCell>
                <span className="flex gap-1.5">
                  {payslip.firstViewedAt ? null : <Badge dot variant="info">{t("new")}</Badge>}
                  {payslip.openQueries > 0 ? <Badge dot variant="warning">{t("queryOpen")}</Badge> : null}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <List className="md:hidden">
        {payslips.length === 0 ? <ListEmpty>{t("none")}</ListEmpty> : null}
        {payslips.map((payslip) => (
          <ListItem key={payslip.id} href={`/payslips/${payslip.id}`} className="justify-between">
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-mono font-medium tabular-nums">{monthLabel(payslip.month)}</span>
                {payslip.firstViewedAt ? null : <Badge dot variant="info">{t("new")}</Badge>}
                {payslip.openQueries > 0 ? <Badge dot variant="warning">{t("queryOpen")}</Badge> : null}
              </span>
              <span className="text-xs text-muted-foreground">
                {payslip.entityCode} · {format.dateTime(payslip.publishedAt, { dateStyle: "medium" })}
                {payslip.kind === "off_cycle" ? ` · ${payslip.runName}` : ""}
              </span>
            </span>
            <span className="font-mono text-[0.9375rem] font-medium tabular-nums">{formatVnd(payslip.net)}</span>
          </ListItem>
        ))}
      </List>
    </Page>
  );
}
