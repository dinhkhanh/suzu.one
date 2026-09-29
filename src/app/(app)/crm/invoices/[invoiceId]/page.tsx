import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
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
  const [t, f] = await Promise.all([getTranslations("crm"), formatters()]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/crm/invoices" className="underline">
            {t("invoices.title")}
          </Link>{" "}
          ·{" "}
          <Link href={`/crm/accounts/${invoice.clientId}`} className="underline">
            {invoice.accountName}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {t("invoice.heading", { number: invoice.number })}
          <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
            {t(`enums.invoiceStanding.${invoice.standing}`)}
          </Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{[invoice.entityName, t("invoice.issuedIs", { date: f.date(invoice.issuedOn) }), t("invoice.dueIs", { date: f.date(invoice.dueOn) }), invoice.daysPastDue > 0 ? t("invoices.daysLate", { days: invoice.daysPastDue }) : null].filter(Boolean).join(" · ")}</p>
        <p className="text-sm">{t("invoice.figures", { subtotal: f.money(invoice.subtotalVnd), vat: f.money(invoice.vatVnd), rate: invoice.vatRateBp / 100, total: f.money(invoice.totalVnd), paid: f.money(invoice.paidVnd), outstanding: f.money(invoice.outstandingVnd) })}</p>
        {invoice.writtenOffReason ? <p className="text-sm text-muted-foreground">{t("invoice.writtenOffBecause", { reason: invoice.writtenOffReason })}</p> : null}
      </header>
      <CrmTabs current="invoices" show={shell.show} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("invoice.items")}</h2>
        <ul className="flex flex-col divide-y rounded-xl border">
          {items.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <span className="font-mono text-xs text-muted-foreground">{item.jobNumber ?? "—"}</span>
              <Link href={`/projects/${item.projectId}/acceptance`} className="hover:underline">
                {item.projectName}
              </Link>
              <span className="text-muted-foreground">{item.description}</span>
              <span className="ml-auto tabular-nums">{f.money(item.amountVnd)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">{t("invoice.payments")}</h2>
        {payments.length === 0 ? <p className="text-sm text-muted-foreground">{t("invoice.noPayments")}</p> : null}
        <ul className="flex flex-col divide-y rounded-xl border">
          {payments.map((payment) => (
            <li key={payment.id} className="flex flex-wrap items-center gap-2 p-3 text-sm">
              <span>{f.date(payment.receivedOn)}</span>
              <span className="text-muted-foreground">{[t(`invoice.methods.${payment.method as "transfer"}`), payment.reference, payment.recordedByName].filter(Boolean).join(" · ")}</span>
              <span className="ml-auto tabular-nums">{f.money(payment.amountVnd)}</span>
              {records && invoice.status !== "written_off" ? <RemovePaymentButton invoiceId={invoice.id} paymentId={payment.id} /> : null}
            </li>
          ))}
        </ul>
        {records && invoice.status === "open" ? (
          <div className="flex flex-col gap-3 rounded-xl border p-4">
            <PaymentForm invoiceId={invoice.id} outstanding={invoice.outstandingVnd} today={today} />
            <details>
              <summary className="cursor-pointer text-sm text-destructive">{t("invoice.writeOff")}</summary>
              <div className="pt-3">
                <WriteOffForm invoiceId={invoice.id} />
              </div>
            </details>
          </div>
        ) : null}
      </section>
      {invoice.note ? <p className="text-sm text-muted-foreground">{invoice.note}</p> : null}
    </div>
  );
}
