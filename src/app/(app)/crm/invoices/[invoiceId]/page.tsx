import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { canRecordInvoices, getInvoice } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { PaymentForm, RemovePaymentButton, WriteOffForm } from "@/modules/crm/ui/money-forms";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmInvoice");

export default async function InvoicePage({ params }: PageProps<"/crm/invoices/[invoiceId]">) {
  const user = await requireUser();
  const { invoiceId } = await params;
  const shell = await crmShell(user);
  const today = todayInVietnam();
  const detail = /^[0-9a-f-]{36}$/.test(invoiceId) ? await getInvoice(shell.viewer, invoiceId, today) : null;
  if (!detail) notFound();
  const { invoice, items, payments } = detail;
  const records = canRecordInvoices(shell.viewer, invoice.entityId);
  const [t, tProjects, f] = await Promise.all([getTranslations("crm"), getTranslations("projects"), formatters()]);

  return (
    <Page width="default">
      <PageHeader eyebrow={<><Link href="/crm/invoices" className="underline">
            {t("invoices.title")}
          </Link>{" "}
          ·{" "}
          <RecordLink kind="account" id={invoice.clientId} className="underline">
            {invoice.accountName}
          </RecordLink></>} title={<span className="inline-flex flex-wrap items-center gap-2">{t("invoice.heading", { number: invoice.number })}
          <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
            {t(`enums.invoiceStanding.${invoice.standing}`)}
          </Badge></span>}>
        <p className="text-sm text-muted-foreground">
          {[
            invoice.entityName ? (
              <RecordLink key="entity" kind="entity" id={invoice.entityId}>
                {invoice.entityName}
              </RecordLink>
            ) : null,
            t("invoice.issuedIs", { date: f.date(invoice.issuedOn) }),
            t("invoice.dueIs", { date: f.date(invoice.dueOn) }),
            invoice.daysPastDue > 0 ? t("invoices.daysLate", { days: invoice.daysPastDue }) : null,
          ]
            .filter(Boolean)
            .flatMap((part, index) => (index ? [" · ", part] : [part]))}
        </p>
        <p className="text-sm">{t("invoice.figures", { subtotal: f.money(invoice.subtotalVnd), vat: f.money(invoice.vatVnd), rate: invoice.vatRateBp / 100, total: f.money(invoice.totalVnd), paid: f.money(invoice.paidVnd), outstanding: f.money(invoice.outstandingVnd) })}</p>
        {invoice.writtenOffReason ? <p className="text-sm text-muted-foreground">{t("invoice.writtenOffBecause", { reason: invoice.writtenOffReason })}</p> : null}
      </PageHeader>
      <CrmTabs current="invoices" show={shell.show} />

      <TableCard>
        <TableCardHeader title={t("invoice.items")} count={items.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{tProjects("fields.jobNumber")}</TableHead>
              <TableHead kind="text">{t("contract.fields.project")}</TableHead>
              <TableHead kind="text">{t("quote.description")}</TableHead>
              <TableHead kind="money">{t("invoice.amount")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell kind="id">{item.jobNumber ?? "—"}</TableCell>
                <TableCell>
                  <Link href={`/projects/${item.projectId}/acceptance`} className="hover:underline">
                    {item.projectName}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-normal text-muted-foreground">{item.description}</TableCell>
                <TableCell kind="money">{f.money(item.amountVnd)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard>
        <TableCardHeader title={t("invoice.payments")} count={payments.length || null} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("invoice.fields.receivedOn")}</TableHead>
              <TableHead kind="select">{t("invoice.fields.method")}</TableHead>
              <TableHead kind="id">{t("invoice.fields.reference")}</TableHead>
              <TableHead kind="person">{tProjects("meetings.fields.author")}</TableHead>
              <TableHead kind="money">{t("invoice.amount")}</TableHead>
              {records && invoice.status !== "written_off" ? <TableHead kind="actions" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.length === 0 ? <TableEmpty>{t("invoice.noPayments")}</TableEmpty> : null}
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>{f.date(payment.receivedOn)}</TableCell>
                <TableCell>
                  <Badge variant="outline">{t(`invoice.methods.${payment.method as "transfer"}`)}</Badge>
                </TableCell>
                <TableCell kind="id">{payment.reference ?? "—"}</TableCell>
                <TableCell>{payment.recordedByName ? <RecordLink kind="person" id={payment.recordedByPersonId}>{payment.recordedByName}</RecordLink> : "—"}</TableCell>
                <TableCell kind="money">{f.money(payment.amountVnd)}</TableCell>
                {records && invoice.status !== "written_off" ? (
                  <TableCell kind="actions">
                    <RemovePaymentButton invoiceId={invoice.id} paymentId={payment.id} />
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {records && invoice.status === "open" ? (
          <TableAddRow label={t("invoice.recordPayment")} open={payments.length === 0}>
            <PaymentForm invoiceId={invoice.id} outstanding={invoice.outstandingVnd} today={today} />
          </TableAddRow>
        ) : null}
      </TableCard>
      {records && invoice.status === "open" ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm text-destructive">{t("invoice.writeOff")}</summary>
          <div className="pt-3">
            <WriteOffForm invoiceId={invoice.id} />
          </div>
        </details>
      ) : null}
      {invoice.note ? <p className="text-sm text-muted-foreground">{invoice.note}</p> : null}
    </Page>
  );
}
