import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listBillingQueue } from "@/modules/projects/service";
import { accountsById, canRecordInvoices, contractNumbersOfProjects, getInvoice, heldBillingItemIds, vatRates } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { DeleteDraftButton, IssueInvoiceForm, PaymentForm, RecordInvoiceForm, ReversePaymentButton, VoidInvoiceForm, WriteOffForm } from "@/modules/crm/ui/money-forms";
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
  const draft = invoice.status === "draft";
  const issued = invoice.status === "open" || invoice.status === "paid";
  const livePayments = payments.filter((payment) => !payment.reversedAt);
  const [t, tProjects, f] = await Promise.all([getTranslations("crm"), getTranslations("projects"), formatters()]);
  // A draft is changed against the account's ready items of its entity that no other invoice holds.
  const editing =
    draft && records
      ? await draftChoices(
          user.principal,
          invoice,
          items.map((item) => item.id),
        )
      : null;

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <>
            <Link href="/crm/invoices" className="underline">
              {t("invoices.title")}
            </Link>{" "}
            ·{" "}
            <RecordLink kind="account" id={invoice.clientId} className="underline">
              {invoice.accountName}
            </RecordLink>
          </>
        }
        title={
          <span className="inline-flex flex-wrap items-center gap-2">
            {draft ? [t("invoice.draftHeading"), invoice.number].filter(Boolean).join(" · ") : t("invoice.heading", { number: invoice.number ?? "" })}
            <Badge dot variant={statusTone(invoice.standing === "open" && invoice.daysPastDue > 0 ? "overdue" : invoice.standing === "part_paid" ? "pending" : invoice.standing)}>
              {t(`enums.invoiceStanding.${invoice.standing}`)}
            </Badge>
          </span>
        }
        actions={draft && records ? <DeleteDraftButton invoiceId={invoice.id} /> : null}
      >
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
        <p className="text-sm">
          {t("invoice.figures", {
            subtotal: f.money(invoice.subtotalVnd),
            vat: f.money(invoice.vatVnd),
            rate: invoice.vatRateBp / 100,
            total: f.money(invoice.totalVnd),
            paid: f.money(invoice.paidVnd),
            outstanding: f.money(invoice.outstandingVnd),
          })}
        </p>
        {invoice.writtenOffReason ? <p className="text-sm text-muted-foreground">{t("invoice.writtenOffBecause", { reason: invoice.writtenOffReason })}</p> : null}
        {invoice.status === "void" ? <p className="text-sm text-muted-foreground">{t("invoice.voidedBecause", { name: invoice.voidedByName ?? "—", date: f.when(invoice.voidedAt), reason: invoice.voidedReason ?? "" })}</p> : null}
        {draft ? <p className="text-sm text-muted-foreground">{t("invoice.draftIntro")}</p> : null}
      </PageHeader>
      <CrmTabs current="invoices" show={shell.show} />

      {editing ? (
        <>
          <Section title={t("invoice.editDraft")}>
            <RecordInvoiceForm
              items={editing.items}
              vatRates={editing.vat.allowedBp}
              defaultVat={invoice.vatRateBp}
              today={today}
              draft={{
                id: invoice.id,
                number: invoice.number,
                issuedOn: invoice.issuedOn,
                vatRateBp: invoice.vatRateBp,
                note: invoice.note,
                itemIds: items.map((item) => item.id),
                amounts: Object.fromEntries(items.flatMap((item) => (item.ownVnd === null && item.amountVnd !== null ? [[item.id, item.amountVnd]] : []))),
              }}
            />
          </Section>
          <Section title={t("invoice.issueTitle")} description={t("invoice.issueIntro")}>
            <IssueInvoiceForm invoiceId={invoice.id} number={invoice.number} issuedOn={invoice.issuedOn} today={today} />
          </Section>
        </>
      ) : (
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
      )}

      {draft ? null : (
        <TableCard>
          <TableCardHeader title={t("invoice.payments")} count={livePayments.length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{t("invoice.fields.receivedOn")}</TableHead>
                <TableHead kind="select">{t("invoice.fields.method")}</TableHead>
                <TableHead kind="id">{t("invoice.fields.reference")}</TableHead>
                <TableHead kind="person">{tProjects("meetings.fields.author")}</TableHead>
                <TableHead kind="money">{t("invoice.amount")}</TableHead>
                {records && issued ? <TableHead kind="actions" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {payments.length === 0 ? <TableEmpty>{t("invoice.noPayments")}</TableEmpty> : null}
              {payments.map((payment) => (
                <TableRow key={payment.id} className={payment.reversedAt ? "text-muted-foreground" : undefined}>
                  <TableCell>
                    <span className={payment.reversedAt ? "line-through" : undefined}>{f.date(payment.receivedOn)}</span>
                    {payment.reversedAt ? <p className="text-xs whitespace-normal">{t("invoice.reversed", { name: payment.reversedByName ?? "—", date: f.when(payment.reversedAt), reason: payment.reversedReason ?? "" })}</p> : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{t(`invoice.methods.${payment.method as "transfer"}`)}</Badge>
                  </TableCell>
                  <TableCell kind="id">{payment.reference ?? "—"}</TableCell>
                  <TableCell>
                    {payment.recordedByName ? (
                      <RecordLink kind="person" id={payment.recordedByPersonId}>
                        {payment.recordedByName}
                      </RecordLink>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell kind="money" className={payment.reversedAt ? "line-through" : undefined}>
                    {f.money(payment.amountVnd)}
                  </TableCell>
                  {records && issued ? <TableCell kind="actions">{payment.reversedAt ? null : <ReversePaymentButton invoiceId={invoice.id} paymentId={payment.id} />}</TableCell> : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {records && invoice.status === "open" ? (
            <TableAddRow label={t("invoice.recordPayment")} open={livePayments.length === 0}>
              <PaymentForm invoiceId={invoice.id} outstanding={invoice.outstandingVnd} today={today} />
            </TableAddRow>
          ) : null}
        </TableCard>
      )}
      {records && invoice.status === "open" ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm text-destructive">{t("invoice.writeOff")}</summary>
          <div className="pt-3">
            <WriteOffForm invoiceId={invoice.id} />
          </div>
        </details>
      ) : null}
      {records && issued ? (
        <details className="rounded-xl border p-4">
          <summary className="cursor-pointer text-sm text-destructive">{t("invoice.void")}</summary>
          <div className="flex flex-col gap-3 pt-3">
            <p className="text-sm text-muted-foreground">{t("invoice.voidIntro")}</p>
            <VoidInvoiceForm invoiceId={invoice.id} />
          </div>
        </details>
      ) : null}
      {invoice.note ? <p className="text-sm text-muted-foreground">{invoice.note}</p> : null}
    </Page>
  );
}

/**
 * What a draft can hold: the ready items of its account and entity in the reader's queue that no
 * other invoice holds, its own among them — read with the queue, one query for the holds.
 */
async function draftChoices(principal: Parameters<typeof listBillingQueue>[0], invoice: { id: string; clientId: string; entityId: string | null }, own: readonly string[]) {
  const [ready, accounts, vat] = await Promise.all([listBillingQueue(principal, { status: "ready", ...(invoice.entityId ? { entityId: invoice.entityId } : {}) }), accountsById(), vatRates(todayInVietnam())]);
  const mine = new Set(own);
  const sameAccount = ready.filter((item) => item.entityId === invoice.entityId && !!item.clientId && accounts.get(item.clientId)?.client.id === invoice.clientId);
  const [held, references] = await Promise.all([heldBillingItemIds(sameAccount.map((item) => item.id)), contractNumbersOfProjects([...new Set(sameAccount.map((item) => item.projectId))])]);
  const items = sameAccount
    .filter((item) => mine.has(item.id) || !held.has(item.id))
    .map((item) => ({
      id: item.id,
      projectId: item.projectId,
      projectName: item.projectName,
      jobNumber: item.jobNumber,
      description: item.description,
      amountVnd: item.amountVnd ?? null,
      reference: item.reference ?? references.get(item.projectId) ?? null,
    }));
  return { items, vat };
}
