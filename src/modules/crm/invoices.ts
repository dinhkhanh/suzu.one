// Invoices, payments and receivables (FR-CRM-30..32). An invoice is finance's record of what it
// issued in the accounting system — number, date, VAT — over one or more billing items of one
// client and entity; issuing it marks those items invoiced in the same transaction (the projects
// module's `invoiceItemsIn`). Payments are recorded against it; what is still owed ages from its
// due date. Legal e-invoices are not issued here.
//
// Every step can be corrected, and nothing issued is ever deleted (CRM-05): an invoice may be
// prepared as a draft — holding its items, changed or deleted freely — and issued when the
// accounting system has given it a number; an issued invoice that was wrong is voided with the
// reason, its items going back to finance's queue; a payment is never more than what is owed, and
// one recorded by mistake is reversed with the reason, kept on the invoice and counting for
// nothing. A payment recorded or reversed after its month's commission was stated reaches the
// statements (`followPaymentChange`).
//
// Who reads what: finance (`pjm:commercial`) over the entity records and reads everything; the
// account's manager and `crm:manage` over it read their accounts' receivables.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { entityReach } from "../platform/rbac/policy";
import { listPeopleHolding } from "../platform/rbac/service";
import { billingItemsByIds, type BillingItemRow, invoiceItemsIn, releaseInvoicedItemsIn } from "@/modules/projects/service";
import { type AccountRef, accountsById } from "./accounts";
import { followPaymentChange, type PaymentChangeResult } from "./commission";
import { agingBucket, daysPastDue, invoiceStanding, paymentTerms, reminderDue, vatOf } from "./engine/contract";
import type { AgingBucket } from "./enums";
import type { CrmViewer } from "./policy";
import { crmSettings, vatRates } from "./stages";

type Executor = Tx | ReturnType<typeof db>;
export type InvoiceRow = typeof schema.crmInvoice.$inferSelect;
export type PaymentRow = typeof schema.crmPayment.$inferSelect;

export type InvoiceInput = { itemIds: string[]; number: string | null; issuedOn: IsoDate; vatRateBp: number; amounts: Record<string, number>; note: string | null };
export type NewInvoice = InvoiceInput & { /** Prepared, not issued: holds its items, may have no number yet. */ draft?: boolean };

/** A payment that is not reversed: the only kind that counts. */
const live = isNull(schema.crmPayment.reversedAt);

/**
 * What an invoice over these items is made of: they must share a client (account) and an entity,
 * and the VAT rate must be one allowed on the day. The due date follows the payment terms of the
 * contract the items' projects are delivered under, else the account's, else the settings' default.
 */
async function frame(itemIds: readonly string[], issuedOn: IsoDate, vatRateBp: number): Promise<{ account: AccountRef; entityId: string | null; dueOn: IsoDate }> {
  const items = await billingItemsByIds(itemIds);
  if (items.length === 0 || items.length !== new Set(itemIds).size) throw new ActionError("billing_not_found");
  const accounts = await accountsById();
  const accountIds = new Set(items.map((item) => (item.clientId ? (accounts.get(item.clientId)?.client.id ?? null) : null)));
  const entityIds = new Set(items.map((item) => item.entityId));
  if (accountIds.has(null)) throw new ActionError("invoice_no_client");
  if (accountIds.size !== 1 || entityIds.size !== 1) throw new ActionError("invoice_mixed_items");
  const account = accounts.get([...accountIds][0]!)!;
  const [{ allowedBp }, settings] = await Promise.all([vatRates(issuedOn), crmSettings(issuedOn)]);
  if (!allowedBp.includes(vatRateBp)) throw new ActionError("quote_vat_invalid");
  const [contract] = await db()
    .select({ days: schema.crmContract.paymentTermsDays })
    .from(schema.crmContractProject)
    .innerJoin(schema.crmContract, eq(schema.crmContract.id, schema.crmContractProject.contractId))
    .where(and(inArray(schema.crmContractProject.projectId, [...new Set(items.map((item) => item.projectId))]), sql`${schema.crmContract.paymentTermsDays} is not null`))
    .orderBy(asc(schema.crmContract.paymentTermsDays))
    .limit(1);
  return { account, entityId: [...entityIds][0] ?? null, dueOn: addDays(issuedOn, paymentTerms(contract?.days, account.profile?.paymentTermsDays, settings.defaultPaymentTermsDays)) };
}

/**
 * Takes the items for an invoice, under their lock: each still ready, and on no other live invoice
 * — an issued one has invoiced them already, a draft holds them. A voided invoice holds nothing.
 */
async function holdItems(tx: Tx, itemIds: readonly string[], invoiceId: string | null): Promise<BillingItemRow[]> {
  const rows = await tx.select().from(schema.projectBillingItem).where(inArray(schema.projectBillingItem.id, [...itemIds])).for("update");
  if (rows.length !== new Set(itemIds).size) throw new ActionError("billing_not_found");
  if (rows.some((row) => row.status !== "ready")) throw new ActionError("billing_decided");
  const [held] = await tx
    .select({ invoiceId: schema.crmInvoice.id })
    .from(schema.crmInvoiceItem)
    .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmInvoiceItem.invoiceId))
    .where(and(inArray(schema.crmInvoiceItem.billingItemId, [...itemIds]), ne(schema.crmInvoice.status, "void"), invoiceId ? ne(schema.crmInvoice.id, invoiceId) : undefined))
    .limit(1);
  if (held) throw new ActionError("invoice_item_held", { invoiceId: held.invoiceId });
  return rows;
}

/** An invoice number is the entity's once — a voided invoice keeps its own. */
async function numberFree(tx: Tx, number: string, entityId: string | null, invoiceId: string | null): Promise<void> {
  const [taken] = await tx
    .select({ id: schema.crmInvoice.id })
    .from(schema.crmInvoice)
    .where(and(eq(schema.crmInvoice.number, number), entityId ? eq(schema.crmInvoice.entityId, entityId) : isNull(schema.crmInvoice.entityId), invoiceId ? ne(schema.crmInvoice.id, invoiceId) : undefined))
    .limit(1);
  if (taken) throw new ActionError("invoice_number_taken");
}

/** A draft's lines: each item with the amount typed for it when the item has none of its own. */
const draftLines = (rows: readonly BillingItemRow[], amounts: Record<string, number>) => rows.map((row) => ({ billingItemId: row.id, amountVnd: row.amountVnd === null ? (amounts[row.id] ?? null) : null, counted: row.amountVnd ?? amounts[row.id] ?? 0 }));

const totals = (subtotal: number, vatRateBp: number) => {
  const vat = vatOf(subtotal, vatRateBp);
  return { subtotalVnd: subtotal, vatVnd: vat, totalVnd: subtotal + vat };
};

/** Issues inside the caller's transaction: the items invoiced, each line keeping the amount it was invoiced at. */
async function issueIn(tx: Tx, invoiceId: string, itemIds: readonly string[], invoice: { number: string; date: IsoDate }, amounts: ReadonlyMap<string, number>, actorPersonId: string): Promise<number> {
  const invoiced = await invoiceItemsIn(tx, itemIds, invoice, amounts, actorPersonId);
  await tx.delete(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoiceId));
  await tx.insert(schema.crmInvoiceItem).values(invoiced.map((item) => ({ billingItemId: item.id, invoiceId, amountVnd: item.amountVnd })));
  return invoiced.reduce((sum, item) => sum + (item.amountVnd ?? 0), 0);
}

/**
 * Records an invoice over ready billing items — issued (a number is then required), or as a draft
 * to be finished later. An item made without an amount takes the one finance types; a draft may
 * leave it blank until it is issued.
 */
export async function recordInvoice(input: NewInvoice, actorPersonId: string): Promise<InvoiceRow> {
  if (!input.draft && !input.number) throw new ActionError("invoice_number_required");
  const { account, entityId, dueOn } = await frame(input.itemIds, input.issuedOn, input.vatRateBp);
  return db().transaction(async (tx) => {
    const rows = await holdItems(tx, input.itemIds, null);
    if (input.number) await numberFree(tx, input.number, entityId, null);
    const lines = draftLines(rows, input.amounts);
    const header = { entityId, clientId: account.client.id, number: input.number, issuedOn: input.issuedOn, dueOn, vatRateBp: input.vatRateBp, note: input.note, createdByPersonId: actorPersonId };
    const [invoice] = await tx
      .insert(schema.crmInvoice)
      .values({ ...header, status: "draft", ...totals(lines.reduce((sum, line) => sum + line.counted, 0), input.vatRateBp) })
      .returning();
    await tx.insert(schema.crmInvoiceItem).values(lines.map(({ billingItemId, amountVnd }) => ({ billingItemId, invoiceId: invoice.id, amountVnd })));
    if (input.draft) return invoice;
    const subtotal = await issueIn(tx, invoice.id, input.itemIds, { number: input.number!, date: input.issuedOn }, new Map(Object.entries(input.amounts)), actorPersonId);
    const [issued] = await tx.update(schema.crmInvoice).set({ status: "open", ...totals(subtotal, input.vatRateBp) }).where(eq(schema.crmInvoice.id, invoice.id)).returning();
    return issued;
  });
}

async function lockInvoice(tx: Tx, invoiceId: string): Promise<InvoiceRow> {
  const [invoice] = await tx.select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId)).limit(1).for("update");
  if (!invoice) throw new ActionError("invoice_not_found");
  return invoice;
}

/** Rewrites a draft: its items (of the same account and entity), number, date, VAT, typed amounts and note. */
export async function saveDraftInvoice(invoiceId: string, input: InvoiceInput): Promise<{ before: InvoiceRow; after: InvoiceRow }> {
  const { account, entityId, dueOn } = await frame(input.itemIds, input.issuedOn, input.vatRateBp);
  return db().transaction(async (tx) => {
    const before = await lockInvoice(tx, invoiceId);
    if (before.status !== "draft") throw new ActionError("invoice_not_draft");
    if (before.clientId !== account.client.id || before.entityId !== entityId) throw new ActionError("invoice_mixed_items");
    const rows = await holdItems(tx, input.itemIds, invoiceId);
    if (input.number) await numberFree(tx, input.number, entityId, invoiceId);
    const lines = draftLines(rows, input.amounts);
    await tx.delete(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoiceId));
    await tx.insert(schema.crmInvoiceItem).values(lines.map(({ billingItemId, amountVnd }) => ({ billingItemId, invoiceId, amountVnd })));
    const [after] = await tx
      .update(schema.crmInvoice)
      .set({ number: input.number, issuedOn: input.issuedOn, dueOn, vatRateBp: input.vatRateBp, note: input.note, ...totals(lines.reduce((sum, line) => sum + line.counted, 0), input.vatRateBp), updatedAt: new Date() })
      .where(eq(schema.crmInvoice.id, invoiceId))
      .returning();
    return { before, after };
  });
}

/** Issues a draft under the number the accounting system gave it, on the day it was issued. Every item needs an amount by now. */
export async function issueInvoice(invoiceId: string, input: { number: string; issuedOn: IsoDate }, actorPersonId: string): Promise<{ before: InvoiceRow; after: InvoiceRow }> {
  const draft = await findInvoice(invoiceId);
  if (!draft) throw new ActionError("invoice_not_found");
  const lines = await db().select().from(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoiceId));
  if (lines.length === 0) throw new ActionError("billing_not_found");
  const { entityId, dueOn } = await frame(lines.map((line) => line.billingItemId), input.issuedOn, draft.vatRateBp);
  return db().transaction(async (tx) => {
    const before = await lockInvoice(tx, invoiceId);
    if (before.status !== "draft") throw new ActionError("invoice_not_draft");
    const held = await tx.select().from(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoiceId));
    const itemIds = held.map((line) => line.billingItemId);
    await holdItems(tx, itemIds, invoiceId);
    await numberFree(tx, input.number, entityId, invoiceId);
    const typed = new Map(held.flatMap((line) => (line.amountVnd === null ? [] : [[line.billingItemId, line.amountVnd] as const])));
    const subtotal = await issueIn(tx, invoiceId, itemIds, { number: input.number, date: input.issuedOn }, typed, actorPersonId);
    const [after] = await tx
      .update(schema.crmInvoice)
      .set({ status: "open", number: input.number, issuedOn: input.issuedOn, dueOn, ...totals(subtotal, before.vatRateBp), updatedAt: new Date() })
      .where(eq(schema.crmInvoice.id, invoiceId))
      .returning();
    return { before, after };
  });
}

/** A draft nobody will issue: deleted, its items free again. Only a draft — an issued invoice is voided. */
export async function deleteDraftInvoice(invoiceId: string): Promise<InvoiceRow> {
  return db().transaction(async (tx) => {
    const before = await lockInvoice(tx, invoiceId);
    if (before.status !== "draft") throw new ActionError("invoice_not_draft");
    await tx.delete(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId));
    return before;
  });
}

/**
 * An issued invoice that was wrong — the wrong client, amounts or items — voided with the reason,
 * as the accounting system voids it. It stays, with its number, and owes nothing; its items go back
 * to finance's queue for the invoice that replaces it. A payment on it is reversed first.
 */
export async function voidInvoice(invoiceId: string, reason: string, actorPersonId: string): Promise<{ before: InvoiceRow; after: InvoiceRow; released: number }> {
  if (!reason.trim()) throw new ActionError("invoice_reason_required");
  return db().transaction(async (tx) => {
    const before = await lockInvoice(tx, invoiceId);
    if (before.status === "draft") throw new ActionError("invoice_not_issued");
    if (before.status !== "open" && before.status !== "paid") throw new ActionError("invoice_closed");
    if ((await paidOf(invoiceId, tx)) > 0) throw new ActionError("invoice_has_payments");
    const lines = await tx.select({ billingItemId: schema.crmInvoiceItem.billingItemId }).from(schema.crmInvoiceItem).where(eq(schema.crmInvoiceItem.invoiceId, invoiceId));
    const released = await releaseInvoicedItemsIn(tx, lines.map((line) => line.billingItemId), before.number ?? "");
    const now = new Date();
    const [after] = await tx.update(schema.crmInvoice).set({ status: "void", voidedReason: reason, voidedAt: now, voidedByPersonId: actorPersonId, updatedAt: now }).where(eq(schema.crmInvoice.id, invoiceId)).returning();
    return { before, after, released: released.length };
  });
}

export const findInvoice = async (invoiceId: string): Promise<InvoiceRow | undefined> => (await db().select().from(schema.crmInvoice).where(eq(schema.crmInvoice.id, invoiceId)).limit(1))[0];

/** What has been received on an invoice: its payments that are not reversed, summed in SQL. */
async function paidOf(invoiceId: string, executor: Executor = db()): Promise<number> {
  const [row] = await executor.select({ paid: sql<number>`coalesce(sum(${schema.crmPayment.amountVnd}), 0)` }).from(schema.crmPayment).where(and(eq(schema.crmPayment.invoiceId, invoiceId), live));
  return Number(row?.paid ?? 0);
}

/**
 * A payment received. Reaching the total pays the invoice; more than is still owed is refused, and
 * so is a payment on an invoice that is not open (a draft, paid, written off or voided).
 */
export async function recordPayment(invoiceId: string, input: { receivedOn: IsoDate; amountVnd: number; method: string; reference: string | null; note: string | null }, actorPersonId: string): Promise<{ payment: PaymentRow; invoice: InvoiceRow; commission: PaymentChangeResult }> {
  if (input.amountVnd <= 0) throw new ActionError("payment_amount_invalid");
  return db().transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    if (invoice.status !== "open") throw new ActionError("invoice_closed");
    const outstanding = invoice.totalVnd - (await paidOf(invoiceId, tx));
    if (input.amountVnd > outstanding) throw new ActionError("payment_above_outstanding", { outstandingVnd: Math.max(0, outstanding) });
    const [payment] = await tx.insert(schema.crmPayment).values({ invoiceId, ...input, recordedByPersonId: actorPersonId }).returning();
    const [after] = input.amountVnd === outstanding ? await tx.update(schema.crmInvoice).set({ status: "paid", updatedAt: new Date() }).where(eq(schema.crmInvoice.id, invoiceId)).returning() : [invoice];
    const commission = await followPaymentChange(tx, { receivedOn: input.receivedOn, entityId: invoice.entityId }, actorPersonId);
    return { payment, invoice: after, commission };
  });
}

/**
 * A payment recorded by mistake, reversed with the reason: it stays on the invoice, marked, and
 * counts for nothing — a paid invoice it paid is open again, and the commission of its month follows.
 */
export async function reversePayment(paymentId: string, reason: string, actorPersonId: string): Promise<{ before: PaymentRow; after: PaymentRow; invoice: InvoiceRow; commission: PaymentChangeResult }> {
  if (!reason.trim()) throw new ActionError("payment_reason_required");
  return db().transaction(async (tx) => {
    const [found] = await tx.select({ invoiceId: schema.crmPayment.invoiceId }).from(schema.crmPayment).where(eq(schema.crmPayment.id, paymentId)).limit(1);
    if (!found) throw new ActionError("payment_not_found");
    // The invoice first, as recording a payment takes them: two hands on one invoice queue up, never cross.
    const invoice = await lockInvoice(tx, found.invoiceId);
    const [before] = await tx.select().from(schema.crmPayment).where(eq(schema.crmPayment.id, paymentId)).limit(1).for("update");
    if (before.reversedAt) throw new ActionError("payment_reversed");
    if (invoice.status === "written_off") throw new ActionError("invoice_closed");
    const now = new Date();
    const [after] = await tx.update(schema.crmPayment).set({ reversedAt: now, reversedByPersonId: actorPersonId, reversedReason: reason }).where(eq(schema.crmPayment.id, paymentId)).returning();
    const paid = await paidOf(invoice.id, tx);
    const [current] = invoice.status === "paid" && paid < invoice.totalVnd ? await tx.update(schema.crmInvoice).set({ status: "open", updatedAt: now }).where(eq(schema.crmInvoice.id, invoice.id)).returning() : [invoice];
    const commission = await followPaymentChange(tx, { receivedOn: before.receivedOn, entityId: invoice.entityId }, actorPersonId);
    return { before, after, invoice: current, commission };
  });
}

/** What will not be collected, with the reason. */
export async function writeOffInvoice(invoiceId: string, reason: string): Promise<{ before: InvoiceRow; after: InvoiceRow }> {
  if (!reason.trim()) throw new ActionError("invoice_reason_required");
  return db().transaction(async (tx) => {
    const before = await lockInvoice(tx, invoiceId);
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
    .where(live)
    .groupBy(schema.crmPayment.invoiceId)
    .as("paid");

export type InvoiceFilters = { status?: "draft" | "open" | "overdue" | "paid" | "written_off" | "void" | "all"; entityId?: string | null; clientId?: string | null; managerId?: string | null };

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

export type InvoiceDetail = {
  invoice: InvoiceView & { voidedByName: string | null };
  /** `amountVnd`: what the line is invoiced at (on a draft, the item's own amount or the one typed); `ownVnd`: the item's own amount, null when it was made without one. */
  items: { id: string; projectId: string; projectName: string; jobNumber: string | null; description: string; reference: string | null; amountVnd: number | null; ownVnd: number | null }[];
  payments: (PaymentRow & { recordedByName: string | null; reversedByName: string | null })[];
};

export async function getInvoice(viewer: CrmViewer, invoiceId: string, today: IsoDate = todayInVietnam()): Promise<InvoiceDetail | null> {
  const reach = invoiceReach(viewer);
  if (reach === null) return null;
  const [found] = await db().select({ id: schema.crmInvoice.id }).from(schema.crmInvoice).where(and(eq(schema.crmInvoice.id, invoiceId), reach)).limit(1);
  if (!found) return null;
  const recorder = alias(schema.person, "payment_recorder");
  const reverser = alias(schema.person, "payment_reverser");
  const [[invoice], items, payments] = await Promise.all([
    listInvoicesByIds([invoiceId], today),
    db()
      .select({ id: schema.projectBillingItem.id, projectId: schema.projectBillingItem.projectId, projectName: schema.workProject.name, jobNumber: schema.projectBillingItem.jobNumber, description: schema.projectBillingItem.description, reference: schema.projectBillingItem.reference, line: schema.crmInvoiceItem.amountVnd, ownVnd: schema.projectBillingItem.amountVnd })
      .from(schema.crmInvoiceItem)
      .innerJoin(schema.projectBillingItem, eq(schema.projectBillingItem.id, schema.crmInvoiceItem.billingItemId))
      .innerJoin(schema.workProject, eq(schema.workProject.id, schema.projectBillingItem.projectId))
      .where(eq(schema.crmInvoiceItem.invoiceId, invoiceId))
      .orderBy(asc(schema.workProject.name), asc(schema.projectBillingItem.createdAt)),
    db()
      .select({ payment: schema.crmPayment, recordedByName: recorder.fullName, reversedByName: reverser.fullName })
      .from(schema.crmPayment)
      .leftJoin(recorder, eq(recorder.id, schema.crmPayment.recordedByPersonId))
      .leftJoin(reverser, eq(reverser.id, schema.crmPayment.reversedByPersonId))
      .where(eq(schema.crmPayment.invoiceId, invoiceId))
      .orderBy(asc(schema.crmPayment.receivedOn), asc(schema.crmPayment.createdAt)),
  ]);
  if (!invoice) return null;
  const [voider] = invoice.voidedByPersonId ? await db().select({ name: schema.person.fullName }).from(schema.person).where(eq(schema.person.id, invoice.voidedByPersonId)).limit(1) : [];
  return {
    invoice: { ...invoice, voidedByName: voider?.name ?? null },
    items: items.map(({ line, ...item }) => ({ ...item, amountVnd: line ?? item.ownVnd })),
    payments: payments.map(({ payment, recordedByName, reversedByName }) => ({ ...payment, recordedByName, reversedByName })),
  };
}

/** Of these billing items, those a live invoice holds — a draft's, or an issued one's — in one query: not to be offered to another invoice. */
export async function heldBillingItemIds(itemIds: readonly string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const rows = await db()
    .selectDistinct({ id: schema.crmInvoiceItem.billingItemId })
    .from(schema.crmInvoiceItem)
    .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmInvoiceItem.invoiceId))
    .where(and(inArray(schema.crmInvoiceItem.billingItemId, [...itemIds]), ne(schema.crmInvoice.status, "void")));
  return new Set(rows.map((row) => row.id));
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
      if (recipients.length) await notify({ recipients, kind: "crm.invoice_overdue", params: { invoice: row.invoice.number ?? "", account: row.accountName, days: daysPastDue(row.invoice.dueOn, today) }, link: `/crm/invoices/${row.invoice.id}` }, tx);
    }
  });
  return { invoicesReminded: due.length };
}

/** Money collected per account in a range (the dashboard, KPI actuals, commission): payments received and not reversed, summed in SQL. */
export async function collectedByAccount(range: { from: IsoDate; to: IsoDate }, clientIds?: readonly string[]): Promise<Map<string, number>> {
  const rows = await db()
    .select({ clientId: schema.crmInvoice.clientId, amount: sql<number>`sum(${schema.crmPayment.amountVnd})` })
    .from(schema.crmPayment)
    .innerJoin(schema.crmInvoice, eq(schema.crmInvoice.id, schema.crmPayment.invoiceId))
    .where(and(sql`${schema.crmPayment.receivedOn} between ${range.from}::date and ${range.to}::date`, live, clientIds ? inArray(schema.crmInvoice.clientId, [...clientIds]) : undefined))
    .groupBy(schema.crmInvoice.clientId);
  return new Map(rows.map((row) => [row.clientId, Number(row.amount)]));
}
