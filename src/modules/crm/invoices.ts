// Invoices, payments and receivables (FR-CRM-30..32). An invoice is finance's record of what it
// issued in the accounting system — number, date, VAT — over one or more billing items of one
// client and entity; recording it marks those items invoiced in the same transaction (the projects
// module's `invoiceItemsIn`). Payments are recorded against it; what is still owed ages from its
// due date. Legal e-invoices are not issued here.
//
// Who reads what: finance (`pjm:commercial`) over the entity records and reads everything; the
// account's manager and `crm:manage` over it read their accounts' receivables.
import "server-only";
import { and, asc, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { entityReach } from "../platform/rbac/policy";
import { listPeopleHolding } from "../platform/rbac/service";
import { billingItemsByIds, invoiceItemsIn } from "@/modules/projects/service";
import { accountsById } from "./accounts";
import { agingBucket, daysPastDue, invoiceStanding, paymentTerms, reminderDue, vatOf } from "./engine/contract";
import type { AgingBucket } from "./enums";
import type { CrmViewer } from "./policy";
import { crmSettings, vatRates } from "./stages";

export type InvoiceRow = typeof schema.crmInvoice.$inferSelect;
export type PaymentRow = typeof schema.crmPayment.$inferSelect;

export type NewInvoice = { itemIds: string[]; number: string; issuedOn: IsoDate; vatRateBp: number; amounts: Record<string, number>; note: string | null };

/**
 * Records an invoice over ready billing items. They must share a client (account) and an entity;
 * an item made without an amount takes the one finance types. The due date follows the payment
 * terms of the contract the items' projects are delivered under, else the account's, else the
 * settings' default.
 */
export async function recordInvoice(input: NewInvoice, actorPersonId: string): Promise<InvoiceRow> {
  const items = await billingItemsByIds(input.itemIds);
  if (items.length === 0 || items.length !== new Set(input.itemIds).size) throw new ActionError("billing_not_found");
  const accounts = await accountsById();
  const accountIds = new Set(items.map((item) => (item.clientId ? (accounts.get(item.clientId)?.client.id ?? null) : null)));
  const entityIds = new Set(items.map((item) => item.entityId));
  if (accountIds.has(null)) throw new ActionError("invoice_no_client");
  if (accountIds.size !== 1 || entityIds.size !== 1) throw new ActionError("invoice_mixed_items");
  const account = accounts.get([...accountIds][0]!)!;
  const entityId = [...entityIds][0] ?? null;
  const [{ allowedBp }, settings] = await Promise.all([vatRates(input.issuedOn), crmSettings(input.issuedOn)]);
  if (!allowedBp.includes(input.vatRateBp)) throw new ActionError("quote_vat_invalid");
  const [contract] = await db()
    .select({ days: schema.crmContract.paymentTermsDays })
    .from(schema.crmContractProject)
    .innerJoin(schema.crmContract, eq(schema.crmContract.id, schema.crmContractProject.contractId))
    .where(and(inArray(schema.crmContractProject.projectId, [...new Set(items.map((item) => item.projectId))]), sql`${schema.crmContract.paymentTermsDays} is not null`))
    .orderBy(asc(schema.crmContract.paymentTermsDays))
    .limit(1);
  const dueOn = addDays(input.issuedOn, paymentTerms(contract?.days, account.profile?.paymentTermsDays, settings.defaultPaymentTermsDays));

  return db().transaction(async (tx) => {
    const [taken] = await tx.select({ id: schema.crmInvoice.id }).from(schema.crmInvoice).where(and(eq(schema.crmInvoice.number, input.number), entityId ? eq(schema.crmInvoice.entityId, entityId) : sql`${schema.crmInvoice.entityId} is null`)).limit(1);
    if (taken) throw new ActionError("invoice_number_taken");
    const invoiced = await invoiceItemsIn(tx, input.itemIds, { number: input.number, date: input.issuedOn }, new Map(Object.entries(input.amounts)), actorPersonId);
    const subtotal = invoiced.reduce((sum, item) => sum + (item.amountVnd ?? 0), 0);
    const vat = vatOf(subtotal, input.vatRateBp);
    const [invoice] = await tx
      .insert(schema.crmInvoice)
      .values({ entityId, clientId: account.client.id, number: input.number, issuedOn: input.issuedOn, dueOn, vatRateBp: input.vatRateBp, subtotalVnd: subtotal, vatVnd: vat, totalVnd: subtotal + vat, note: input.note, createdByPersonId: actorPersonId })
      .returning();
    await tx.insert(schema.crmInvoiceItem).values(invoiced.map((item) => ({ billingItemId: item.id, invoiceId: invoice.id })));
    return invoice;
  });
}

export const findInvoice = async (invoiceId: string): Promise<InvoiceRow | undefined> => (await db().select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId)).limit(1))[0];

async function paidOf(invoiceId: string, executor: Tx | ReturnType<typeof db> = db()): Promise<number> {
  const [row] = await executor.select({ paid: sql<number>`coalesce(sum(${schema.crmPayment.amountVnd}), 0)` }).from(schema.crmPayment).where(eq(schema.crmPayment.invoiceId, invoiceId));
  return Number(row?.paid ?? 0);
}

/** A payment received. Reaching the total pays the invoice; a payment on a paid or written-off invoice is refused. */
export async function recordPayment(invoiceId: string, input: { receivedOn: IsoDate; amountVnd: number; method: string; reference: string | null; note: string | null }, actorPersonId: string): Promise<{ payment: PaymentRow; invoice: InvoiceRow }> {
  if (input.amountVnd <= 0) throw new ActionError("payment_amount_invalid");
  return db().transaction(async (tx) => {
    const [invoice] = await tx.select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId)).limit(1).for("update");
    if (!invoice) throw new ActionError("invoice_not_found");
    if (invoice.status !== "open") throw new ActionError("invoice_closed");
    const [payment] = await tx.insert(schema.crmPayment).values({ invoiceId, ...input, recordedByPersonId: actorPersonId }).returning();
    const paid = await paidOf(invoiceId, tx);
    const [after] = paid >= invoice.totalVnd ? await tx.update(schema.crmInvoice).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.crmInvoice.id, invoiceId)).returning() : [invoice];
    return { payment, invoice: after };
  });
}

/** A payment recorded by mistake. A paid invoice it paid is open again. */
export async function removePayment(paymentId: string): Promise<{ payment: PaymentRow; invoice: InvoiceRow }> {
  return db().transaction(async (tx) => {
    const [payment] = await tx.delete(schema.crmPayment).where(eq(schema.crmPayment.id, paymentId)).returning();
    if (!payment) throw new ActionError("payment_not_found");
    const [invoice] = await tx.select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, payment.invoiceId)).limit(1).for("update");
    if (invoice.status === "written_off") throw new ActionError("invoice_closed");
    const paid = await paidOf(invoice.id, tx);
    const [after] = invoice.status === "paid" && paid < invoice.totalVnd ? await tx.update(schema.crmInvoice).set({ status: "open", updatedAt: new Date() }).where(eq(schema.crmInvoice.id, invoice.id)).returning() : [invoice];
    return { payment, invoice: after };
  });
}

/** What will not be collected, with the reason. */
export async function writeOffInvoice(invoiceId: string, reason: string): Promise<{ before: InvoiceRow; after: InvoiceRow }> {
  if (!reason.trim()) throw new ActionError("invoice_reason_required");
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId)).limit(1).for("update");
    if (!before) throw new ActionError("invoice_not_found");
    if (before.status !== "open") throw new ActionError("invoice_closed");
    const [after] = await tx.update(schema.crmInvoice).set({ status: "written_off", writtenOffReason: reason, updatedAt: new Date() }).where(eq(schema.crmInvoice.id, invoiceId)).returning();
    return { before, after };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

/**
 * The invoices this reader may see, as SQL: finance and `crm:manage` over the invoice's entity, and
 * the manager of its account. undefined = everything; null = nothing.
 */
export function invoiceReach(viewer: CrmViewer): SQL | undefined | null {
  const commercial = entityReach(viewer.principal, "pjm:commercial");
  const manage = entityReach(viewer.principal, "crm:manage");
  if (commercial.all || manage.all) return undefined;
  const entities = [...commercial.entityIds, ...manage.entityIds];
  const managed = [...viewer.ties].filter(([, ties]) => ties.includes("manager")).map(([clientId]) => clientId);
  const parts = [entities.length ? inArray(schema.crmInvoice.entityId, entities) : undefined, managed.length ? inArray(schema.crmInvoice.clientId, managed) : undefined].filter((part): part is SQL => !!part);
  return parts.length ? or(...parts)! : null;
}

export type InvoiceView = InvoiceRow & { accountName: string; entityName: string | null; managerPersonId: string | null; managerName: string | null; paidVnd: number; outstandingVnd: number; standing: ReturnType<typeof invoiceStanding>; daysPastDue: number; bucket: AgingBucket };

const paidSub = () =>
  db()
    .select({ invoiceId: schema.crmPayment.invoiceId, amount: sql<number>`sum(${schema.crmPayment.amountVnd})`.as("paid_amount") })
    .from(schema.crmPayment)
    .groupBy(schema.crmPayment.invoiceId)
    .as("paid");

export type InvoiceFilters = { status?: "open" | "overdue" | "paid" | "written_off" | "all"; entityId?: string | null; clientId?: string | null; managerId?: string | null };

export async function listInvoices(viewer: CrmViewer, filters: InvoiceFilters = {}, today: IsoDate = todayInVietnam(), limit = 500): Promise<InvoiceView[]> {
  const reach = invoiceReach(viewer);
  if (reach === null) return [];
  const paid = paidSub();
  const manager = alias(schema.person, "invoice_manager");
  const status = filters.status ?? "open";
  const rows = await db()
    .select({ invoice: schema.crmInvoice, accountName: schema.workClient.name, entityName: schema.entity.shortName, managerPersonId: schema.workClient.accountManagerPersonId, managerName: manager.fullName, paid: paid.amount })
    .from(schema.crmInvoice)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.crmInvoice.entityId))
    .leftJoin(manager, eq(manager.id, schema.workClient.accountManagerPersonId))
    .leftJoin(paid, eq(paid.invoiceId, schema.crmInvoice.id))
    .where(
      and(
        reach,
        status === "all" ? undefined : status === "overdue" ? and(eq(schema.crmInvoice.status, "open"), sql`${schema.crmInvoice.dueOn} < ${today}::date`) : eq(schema.crmInvoice.status, status),
        filters.entityId ? eq(schema.crmInvoice.entityId, filters.entityId) : undefined,
        filters.clientId ? eq(schema.crmInvoice.clientId, filters.clientId) : undefined,
        filters.managerId ? eq(schema.workClient.accountManagerPersonId, filters.managerId) : undefined,
      ),
    )
    .orderBy(asc(schema.crmInvoice.dueOn), desc(schema.crmInvoice.issuedOn))
    .limit(limit);
  return rows.map(({ invoice, paid: paidAmount, ...rest }) => {
    const paidVnd = Number(paidAmount ?? 0);
    return { ...invoice, ...rest, paidVnd, outstandingVnd: invoice.status === "open" ? Math.max(0, invoice.totalVnd - paidVnd) : 0, standing: invoiceStanding(invoice.totalVnd, paidVnd, invoice.status), daysPastDue: invoice.status === "open" ? daysPastDue(invoice.dueOn, today) : 0, bucket: agingBucket(invoice.dueOn, today) };
  });
}

export type AgingSummary = Record<AgingBucket, number> & { total: number; invoices: number };

/** Outstanding by aging bucket, summed in SQL over the reader's open invoices (optionally one entity). */
export async function agingSummary(viewer: CrmViewer, filters: { entityId?: string | null; clientId?: string | null } = {}, today: IsoDate = todayInVietnam()): Promise<AgingSummary> {
  const empty: AgingSummary = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, total: 0, invoices: 0 };
  const reach = invoiceReach(viewer);
  if (reach === null) return empty;
  const paid = paidSub();
  const owed = sql`greatest(${schema.crmInvoice.totalVnd} - coalesce(${paid.amount}, 0), 0)`;
  const late = sql`(${today}::date - ${schema.crmInvoice.dueOn})`;
  const [row] = await db()
    .select({
      current: sql<number>`coalesce(sum(${owed}) filter (where ${late} <= 0), 0)`,
      d1_30: sql<number>`coalesce(sum(${owed}) filter (where ${late} between 1 and 30), 0)`,
      d31_60: sql<number>`coalesce(sum(${owed}) filter (where ${late} between 31 and 60), 0)`,
      d61_90: sql<number>`coalesce(sum(${owed}) filter (where ${late} between 61 and 90), 0)`,
      d90_plus: sql<number>`coalesce(sum(${owed}) filter (where ${late} > 90), 0)`,
      total: sql<number>`coalesce(sum(${owed}), 0)`,
      invoices: sql<number>`count(*)`,
    })
    .from(schema.crmInvoice)
    .leftJoin(paid, eq(paid.invoiceId, schema.crmInvoice.id))
    .where(and(reach, eq(schema.crmInvoice.status, "open"), filters.entityId ? eq(schema.crmInvoice.entityId, filters.entityId) : undefined, filters.clientId ? eq(schema.crmInvoice.clientId, filters.clientId) : undefined));
  return { current: Number(row.current), d1_30: Number(row.d1_30), d31_60: Number(row.d31_60), d61_90: Number(row.d61_90), d90_plus: Number(row.d90_plus), total: Number(row.total), invoices: Number(row.invoices) };
}

export type InvoiceDetail = { invoice: InvoiceView; items: { id: string; projectId: string; projectName: string; jobNumber: string | null; description: string; amountVnd: number | null }[]; payments: (PaymentRow & { recordedByName: string | null })[] };

export async function getInvoice(viewer: CrmViewer, invoiceId: string, today: IsoDate = todayInVietnam()): Promise<InvoiceDetail | null> {
  const reach = invoiceReach(viewer);
  if (reach === null) return null;
  const [found] = await db().select({ id: schema.crmInvoice.id }).from(schema.crmInvoice).where(and(eq(schema.crmInvoice.id, invoiceId), reach)).limit(1);
  if (!found) return null;
  const [[invoice], items, payments] = await Promise.all([
    listInvoicesByIds([invoiceId], today),
    db()
      .select({ id: schema.projectBillingItem.id, projectId: schema.projectBillingItem.projectId, projectName: schema.workProject.name, jobNumber: schema.projectBillingItem.jobNumber, description: schema.projectBillingItem.description, amountVnd: schema.projectBillingItem.amountVnd })
      .from(schema.crmInvoiceItem)
      .innerJoin(schema.projectBillingItem, eq(schema.projectBillingItem.id, schema.crmInvoiceItem.billingItemId))
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBillingItem.projectId))
      .where(eq(schema.crmInvoiceItem.invoiceId, invoiceId)),
    db().select({ payment: schema.crmPayment, recordedByName: schema.person.fullName }).from(schema.crmPayment).leftJoin(schema.person, eq(schema.person.id, schema.crmPayment.recordedByPersonId)).where(eq(schema.crmPayment.invoiceId, invoiceId)).orderBy(asc(schema.crmPayment.receivedOn)),
  ]);
  return invoice ? { invoice, items, payments: payments.map(({ payment, recordedByName }) => ({ ...payment, recordedByName })) } : null;
}

async function listInvoicesByIds(ids: readonly string[], today: IsoDate): Promise<InvoiceView[]> {
  const paid = paidSub();
  const manager = alias(schema.person, "invoice_manager");
  const rows = await db()
    .select({ invoice: schema.crmInvoice, accountName: schema.workClient.name, entityName: schema.entity.shortName, managerPersonId: schema.workClient.accountManagerPersonId, managerName: manager.fullName, paid: paid.amount })
    .from(schema.crmInvoice)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
    .leftJoin(schema.entity, eq(schema.entity.id, schema.crmInvoice.entityId))
    .leftJoin(manager, eq(manager.id, schema.workClient.accountManagerPersonId))
    .leftJoin(paid, eq(paid.invoiceId, schema.crmInvoice.id))
    .where(inArray(schema.crmInvoice.id, [...ids]));
  return rows.map(({ invoice, paid: paidAmount, ...rest }) => {
    const paidVnd = Number(paidAmount ?? 0);
    return { ...invoice, ...rest, paidVnd, outstandingVnd: invoice.status === "open" ? Math.max(0, invoice.totalVnd - paidVnd) : 0, standing: invoiceStanding(invoice.totalVnd, paidVnd, invoice.status), daysPastDue: invoice.status === "open" ? daysPastDue(invoice.dueOn, today) : 0, bucket: agingBucket(invoice.dueOn, today) };
  });
}

// ── Reminders (FR-CRM-32) ───────────────────────────────────────────────────────────────────

/**
 * The morning pass over open invoices past due: at each configured threshold (days past due) not yet
 * reminded, the account's manager and finance over the entity are told — once per threshold, and
 * only the highest crossed when several are. Returns how many invoices were reminded about.
 */
export async function sendReceivableReminders(today: IsoDate = todayInVietnam()): Promise<{ invoicesReminded: number }> {
  const { receivableReminderDays } = await crmSettings(today);
  const rows = await db()
    .select({ invoice: schema.crmInvoice, accountName: schema.workClient.name, manager: schema.workClient.accountManagerPersonId })
    .from(schema.crmInvoice)
    .innerJoin(schema.workClient, eq(schema.workClient.id, schema.crmInvoice.clientId))
    .where(and(eq(schema.crmInvoice.status, "open"), sql`${schema.crmInvoice.dueOn} < ${today}::date`));
  const due = rows.flatMap((row) => {
    const threshold = reminderDue(row.invoice.dueOn, today, receivableReminderDays, row.invoice.reminded);
    return threshold === null ? [] : [{ ...row, threshold }];
  });
  if (due.length === 0) return { invoicesReminded: 0 };
  const entityIds = [...new Set(due.map((row) => row.invoice.entityId))];
  const finance = await Promise.all(entityIds.map((entityId) => listPeopleHolding("pjm:commercial", { entityId }, { includeWildcard: false })));
  const financeByEntity = new Map(entityIds.map((entityId, index) => [entityId, finance[index]]));
  await db().transaction(async (tx) => {
    for (const row of due) {
      // Every threshold up to the one crossed counts as sent: a late find is one reminder, not several.
      const sent = [...new Set([...row.invoice.reminded, ...receivableReminderDays.filter((days) => days <= row.threshold)])].sort((a, b) => a - b);
      await tx.update(schema.crmInvoice).set({ reminded: sent }).where(eq(schema.crmInvoice.id, row.invoice.id));
      const recipients = [...new Set([row.manager, ...(financeByEntity.get(row.invoice.entityId) ?? [])].filter((id): id is string => !!id))];
      if (recipients.length) await notify({ recipients, kind: "crm.invoice_overdue", params: { invoice: row.invoice.number, account: row.accountName, days: daysPastDue(row.invoice.dueOn, today) }, link: `/crm/invoices/${row.invoice.id}` }, tx);
    }
  });
  return { invoicesReminded: due.length };
}

/** Money collected per account in a range (the dashboard, KPI actuals, commission): payments received, summed in SQL. */
export async function collectedByAccount(range: { from: IsoDate; to: IsoDate }, clientIds?: readonly string[]): Promise<Map<string, number>> {
  const rows = await db()
    .select({ clientId: schema.crmInvoice.clientId, amount: sql<number>`sum(${schema.crmPayment.amountVnd})` })
    .from(schema.crmPayment)
    .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
    .where(and(sql`${schema.crmPayment.receivedOn} between ${range.from}::date and ${range.to}::date`, clientIds ? inArray(schema.crmInvoice.clientId, [...clientIds]) : undefined))
    .groupBy(schema.crmInvoice.clientId);
  return new Map(rows.map((row) => [row.clientId, Number(row.amount)]));
}
