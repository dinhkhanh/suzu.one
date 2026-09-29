// Quotes — báo giá (FR-CRM-21..24). A quote belongs to a deal, has a number shared by its versions,
// and moves draft → (approval) → approved → sent → accepted / rejected / expired. Its totals are
// computed by the engine from its lines on every save and kept on the row, so the page, the PDF and
// the deal read one set of figures. VAT comes from the parameter store in force on the day.
//
// A line discount above the entity's threshold, or an estimated margin under the floor, sends the
// quote to the approval engine (`crm:manage` over the deal's entity) before it may go out. The
// margin is computed from an aggregate cost rate (payroll's `blendedCostRate`) whoever submits; only
// a `pjm:cost` holder ever reads the figure.
import "server-only";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, submitRequest, withdrawRequest } from "../platform/approvals/service";
import { can } from "../platform/rbac/policy";
import { blendedCostRate } from "@/modules/payroll/service";
import { jobPrefix, jobYear, nextJobNumber } from "@/modules/projects/service";
import { approvalReasons, type ApprovalReason, marginEstimate, type MarginEstimate, quoteTotals } from "./engine/quote";
import type { QuoteStatus } from "./enums";
import type { RoleMinutes } from "./schema";
import { crmSettings, vatRates } from "./stages";

type Executor = Tx | ReturnType<typeof db>;
export type QuoteRow = typeof schema.crmQuote.$inferSelect;
export type QuoteLineRow = typeof schema.crmQuoteLine.$inferSelect;
export type QuotePayload = { quoteId: string; dealId: string; number: string; version: number; reasons: ApprovalReason[] };

export const quoteRequestType = defineRequestType({
  type: "crm_quote",
  flow: { steps: [{ key: "sales_manager", mode: "any", approvers: [{ rule: "permission", permission: "crm:manage" }] }] },
  conditionFields: ["discount", "margin"],
  // A quote is read before it is approved: prices, discounts, what is promised.
  bulkApprovable: () => false,
  // The sales directors over the deal's entity read it; nobody else for an ordinary permission.
  canView: (viewer, subject) => can(viewer, "crm:manage", subject ?? {}),
});

export const findQuote = async (quoteId: string, executor: Executor = db()): Promise<QuoteRow | undefined> => (await executor.select().from(schema.crmQuote).where(eq(schema.crmQuote.id, quoteId)).limit(1))[0];

export async function getQuote(quoteId: string): Promise<{ quote: QuoteRow; lines: QuoteLineRow[] } | null> {
  const quote = await findQuote(quoteId);
  if (!quote) return null;
  const lines = await db().select().from(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quoteId)).orderBy(asc(schema.crmQuoteLine.sortOrder));
  return { quote, lines };
}

/** A deal's quotes, newest version first within each number. */
export async function listQuotes(dealId: string): Promise<QuoteRow[]> {
  return db().select().from(schema.crmQuote).where(eq(schema.crmQuote.dealId, dealId)).orderBy(desc(schema.crmQuote.createdAt), desc(schema.crmQuote.version));
}

async function lockQuote(tx: Tx, quoteId: string): Promise<QuoteRow> {
  const [quote] = await tx.select().from(schema.crmQuote).where(eq(schema.crmQuote.id, quoteId)).limit(1).for("update");
  if (!quote) throw new ActionError("quote_not_found");
  return quote;
}

async function dealOf(executor: Executor, dealId: string) {
  const [deal] = await executor.select().from(schema.crmDeal).where(eq(schema.crmDeal.id, dealId)).limit(1);
  if (!deal) throw new ActionError("deal_not_found");
  return deal;
}

/** A new quote on an open deal: the next number of the deal's entity, VAT and validity from the settings in force. */
export async function createQuote(dealId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<QuoteRow> {
  // Read from the parameter store's cache before the transaction opens, never inside it.
  const [settings, vat] = await Promise.all([crmSettings(today), vatRates(today)]);
  return db().transaction(async (tx) => {
    const deal = await dealOf(tx, dealId);
    if (deal.status !== "open") throw new ActionError("deal_closed");
    const [entity] = deal.entityId ? await tx.select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, deal.entityId)).limit(1) : [];
    const number = await nextJobNumber(tx, `BG-${jobPrefix(entity?.code)}`, jobYear(today));
    const [quote] = await tx
      .insert(schema.crmQuote)
      .values({ dealId, number, version: 1, title: deal.title, status: "draft", validUntil: addDays(today, settings.quoteValidityDays), vatRateBp: vat.defaultBp, createdByPersonId: actorPersonId })
      .returning();
    return quote;
  });
}

export type QuoteLineInput = { serviceId: string | null; title: string; description: string | null; quantity: number; unit: string | null; unitPriceVnd: number; discountBp: number; months: number | null; format: string | null; channel: string | null; roleMinutes: RoleMinutes[] };
export type QuoteInput = { title: string; validUntil: IsoDate | null; vatRateBp: number; intro: string | null; terms: string | null; lines: QuoteLineInput[] };

/** Rewrites a draft: its header, its lines, and the totals computed from them. */
export async function saveQuote(quoteId: string, input: QuoteInput, today: IsoDate = todayInVietnam()): Promise<{ before: QuoteRow; after: QuoteRow }> {
  const { allowedBp } = await vatRates(today);
  if (!allowedBp.includes(input.vatRateBp)) throw new ActionError("quote_vat_invalid");
  return db().transaction(async (tx) => {
    const before = await lockQuote(tx, quoteId);
    if (before.status !== "draft") throw new ActionError("quote_locked");
    const totals = quoteTotals(input.lines, input.vatRateBp);
    await tx.delete(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quoteId));
    if (input.lines.length) await tx.insert(schema.crmQuoteLine).values(input.lines.map((line, index) => ({ ...line, quoteId, roleMinutes: line.roleMinutes.filter((entry) => entry.role.trim() && entry.minutes > 0), sortOrder: (index + 1) * 10 })));
    const [after] = await tx
      .update(schema.crmQuote)
      .set({ title: input.title, validUntil: input.validUntil, vatRateBp: input.vatRateBp, intro: input.intro, terms: input.terms, subtotalVnd: totals.subtotalVnd, discountVnd: totals.discountVnd, vatVnd: totals.vatVnd, totalVnd: totals.totalVnd, maxDiscountBp: totals.maxDiscountBp, updatedAt: new Date() })
      .where(eq(schema.crmQuote.id, quoteId))
      .returning();
    return { before, after };
  });
}

/** The delivering team's people, whose average hour the margin is estimated at. */
async function deliveringPeople(executor: Executor, teamId: string | null): Promise<string[]> {
  if (!teamId) return [];
  const rows = await executor.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(eq(schema.workTeamMember.teamId, teamId));
  return rows.map((row) => row.personId);
}

const monthsBack = (today: IsoDate, months: number): string => {
  const date = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date.toISOString().slice(0, 7);
};

/** The quote's estimated margin: its hours at the delivering team's average loaded hour over the last three signed months. */
export async function estimateMargin(quote: Pick<QuoteRow, "subtotalVnd" | "discountVnd" | "dealId">, lines: readonly Pick<QuoteLineRow, "roleMinutes">[], today: IsoDate = todayInVietnam()): Promise<MarginEstimate | null> {
  const deal = await dealOf(db(), quote.dealId);
  const people = await deliveringPeople(db(), deal.teamId);
  const rate = people.length ? await blendedCostRate(people, monthsBack(today, 3), monthsBack(today, 1)) : null;
  return marginEstimate(quote.subtotalVnd - quote.discountVnd, lines, rate);
}

/** Why this quote must be approved before it goes out (empty = it may go straight out). Never inside a transaction: it reads payroll's aggregate. */
export async function quoteApprovalReasons(quote: QuoteRow, lines: readonly QuoteLineRow[], today: IsoDate = todayInVietnam()): Promise<ApprovalReason[]> {
  const settings = await crmSettings(today);
  const margin = await estimateMargin(quote, lines, today);
  return approvalReasons({ maxDiscountBp: quote.maxDiscountBp }, margin, { discountThresholdBp: settings.quoteDiscountApprovalBp, marginFloorBp: settings.quoteMarginFloorBp });
}

/**
 * A draft to its approver, or straight to "approved" when nothing asks for approval (the flow
 * administration may still require it: a configured flow with a step that applies always runs).
 *
 * The reasons are worked out before the transaction — the margin reads payroll's aggregate — and
 * the draft is then locked and checked to be the very draft they were worked out for.
 */
export async function submitQuote(quoteId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ quote: QuoteRow; requestId: string | null; reasons: ApprovalReason[] }> {
  const found = await getQuote(quoteId);
  if (!found) throw new ActionError("quote_not_found");
  if (found.quote.status !== "draft") throw new ActionError("quote_locked");
  if (found.lines.length === 0) throw new ActionError("quote_empty");
  const reasons = await quoteApprovalReasons(found.quote, found.lines, today);
  const deal = await dealOf(db(), found.quote.dealId);
  return db().transaction(async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (quote.status !== "draft") throw new ActionError("quote_locked");
    if (quote.updatedAt.getTime() !== found.quote.updatedAt.getTime()) throw new ActionError("quote_changed");
    if (reasons.length === 0) {
      const [after] = await tx.update(schema.crmQuote).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
      return { quote: after, requestId: null, reasons };
    }
    const payload: QuotePayload = { quoteId, dealId: quote.dealId, number: quote.number, version: quote.version, reasons };
    const { request, outcome } = await submitRequest(tx, quoteRequestType, {
      entityId: deal.entityId,
      requesterPersonId: actorPersonId,
      subjectPersonId: null,
      subjectType: "crm_quote",
      subjectId: quoteId,
      summary: `${quote.number} v${quote.version} · ${quote.title}`.slice(0, 300),
      payload,
      conditionData: { discount: reasons.includes("discount"), margin: reasons.includes("margin") },
      link: `/crm/deals/${quote.dealId}/quotes/${quoteId}`,
      target: { entityId: deal.entityId },
    });
    const [after] = await tx
      .update(schema.crmQuote)
      .set({ status: outcome === "approved" ? "approved" : "in_approval", approvalRequestId: request.id, updatedAt: new Date() })
      .where(eq(schema.crmQuote.id, quoteId))
      .returning();
    return { quote: after, requestId: request.id, reasons };
  });
}

/** The approver's decision, applied in the same transaction: approved, or back to draft with the comment. */
export async function decideQuote(actorPersonId: string, requestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }): Promise<{ before: QuoteRow; after: QuoteRow; outcome: string }> {
  return db().transaction(async (tx) => {
    const { request, outcome } = await decideRequest(tx, quoteRequestType, requestId, actorPersonId, decision);
    const { quoteId } = request.payload as QuotePayload;
    const before = await lockQuote(tx, quoteId);
    if (before.approvalRequestId !== request.id) throw new ActionError("approval_not_found");
    const status: QuoteStatus = outcome === "approved" ? "approved" : outcome === "pending" ? "in_approval" : "draft";
    const [after] = await tx
      .update(schema.crmQuote)
      .set({ status, decisionNote: decision.comment, ...(status === "draft" ? { approvalRequestId: null } : {}), updatedAt: new Date() })
      .where(eq(schema.crmQuote.id, quoteId))
      .returning();
    return { before, after, outcome };
  });
}

/** Taken back from its approver by whoever may change it: a draft again, the request withdrawn. */
export async function withdrawQuote(quoteId: string, actorPersonId: string): Promise<{ before: QuoteRow; after: QuoteRow }> {
  return db().transaction(async (tx) => {
    const before = await lockQuote(tx, quoteId);
    if (before.status !== "in_approval" || !before.approvalRequestId) throw new ActionError("quote_not_in_approval");
    const [request] = await tx.select({ status: schema.approvalRequest.status }).from(schema.approvalRequest).where(eq(schema.approvalRequest.id, before.approvalRequestId)).limit(1);
    if (request?.status === "pending" || request?.status === "returned") await withdrawRequest(tx, before.approvalRequestId, actorPersonId);
    const [after] = await tx.update(schema.crmQuote).set({ status: "draft", approvalRequestId: null, updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
    return { before, after };
  });
}

/** Sent to the client: an approved quote, or a draft nothing asks to approve. */
export async function sendQuote(quoteId: string, today: IsoDate = todayInVietnam()): Promise<{ before: QuoteRow; after: QuoteRow }> {
  const found = await getQuote(quoteId);
  if (!found) throw new ActionError("quote_not_found");
  if (found.quote.status === "draft") {
    if (found.lines.length === 0) throw new ActionError("quote_empty");
    if ((await quoteApprovalReasons(found.quote, found.lines, today)).length) throw new ActionError("quote_needs_approval");
  }
  return db().transaction(async (tx) => {
    const before = await lockQuote(tx, quoteId);
    if (before.status === "draft" ? before.updatedAt.getTime() !== found.quote.updatedAt.getTime() : before.status !== "approved") throw new ActionError(before.status === "draft" ? "quote_changed" : "quote_not_sendable");
    const [after] = await tx.update(schema.crmQuote).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
    return { before, after };
  });
}

/**
 * The client's answer. Accepted: the deal takes the quote's value (its one-off net, its monthly net
 * and months) and every other live version of the deal's quotes is superseded.
 */
export async function answerQuote(quoteId: string, accepted: boolean, note: string | null): Promise<{ before: QuoteRow; after: QuoteRow }> {
  return db().transaction(async (tx) => {
    const before = await lockQuote(tx, quoteId);
    if (before.status !== "sent") throw new ActionError("quote_not_sent");
    const [after] = await tx.update(schema.crmQuote).set({ status: accepted ? "accepted" : "rejected", decidedAt: new Date(), decisionNote: note, updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
    if (accepted) {
      const lines = await tx.select().from(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quoteId));
      const totals = quoteTotals(lines, before.vatRateBp);
      await tx
        .update(schema.crmQuote)
        .set({ status: "superseded", updatedAt: new Date() })
        .where(and(eq(schema.crmQuote.dealId, before.dealId), inArray(schema.crmQuote.status, ["accepted", "sent", "approved", "draft"]), ne(schema.crmQuote.id, quoteId)));
      await tx
        .update(schema.crmDeal)
        .set({ oneOffVnd: totals.oneOffNetVnd || null, monthlyVnd: totals.monthlyNetVnd || null, months: totals.months, updatedAt: new Date() })
        .where(and(eq(schema.crmDeal.id, before.dealId), eq(schema.crmDeal.status, "open")));
    }
    return { before, after };
  });
}

/** A new draft version of a quote, with its lines copied. The version before stays as it was until the new one is accepted. */
export async function reviseQuote(quoteId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<QuoteRow> {
  const settings = await crmSettings(today);
  return db().transaction(async (tx) => {
    const source = await lockQuote(tx, quoteId);
    if (source.status === "in_approval" || source.status === "superseded" || source.status === "draft") throw new ActionError("quote_not_revisable");
    const deal = await dealOf(tx, source.dealId);
    if (deal.status !== "open") throw new ActionError("deal_closed");
    const [latest] = await tx.select({ version: schema.crmQuote.version }).from(schema.crmQuote).where(eq(schema.crmQuote.number, source.number)).orderBy(desc(schema.crmQuote.version)).limit(1);
    const [quote] = await tx
      .insert(schema.crmQuote)
      .values({ dealId: source.dealId, number: source.number, version: (latest?.version ?? source.version) + 1, title: source.title, status: "draft", validUntil: addDays(today, settings.quoteValidityDays), vatRateBp: source.vatRateBp, subtotalVnd: source.subtotalVnd, discountVnd: source.discountVnd, vatVnd: source.vatVnd, totalVnd: source.totalVnd, maxDiscountBp: source.maxDiscountBp, intro: source.intro, terms: source.terms, createdByPersonId: actorPersonId })
      .returning();
    const lines = await tx.select().from(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quoteId));
    if (lines.length) await tx.insert(schema.crmQuoteLine).values(lines.map((line) => ({ serviceId: line.serviceId, title: line.title, description: line.description, quantity: line.quantity, unit: line.unit, unitPriceVnd: line.unitPriceVnd, discountBp: line.discountBp, months: line.months, format: line.format, channel: line.channel, roleMinutes: line.roleMinutes, sortOrder: line.sortOrder, quoteId: quote.id })));
    return quote;
  });
}

/**
 * The nightly pass: a sent quote past its validity is expired; a quote left "in approval" behind a
 * request the approvals inbox withdrew, cancelled or returned is a draft again.
 */
export async function reconcileQuotes(today: IsoDate = todayInVietnam()): Promise<{ quotesExpired: number; quotesReopened: number }> {
  const expired = await db()
    .update(schema.crmQuote)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(schema.crmQuote.status, "sent"), lt(schema.crmQuote.validUntil, today)))
    .returning({ id: schema.crmQuote.id });
  const waiting = await db()
    .select({ id: schema.crmQuote.id, requestStatus: schema.approvalRequest.status })
    .from(schema.crmQuote)
    .innerJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.crmQuote.approvalRequestId))
    .where(eq(schema.crmQuote.status, "in_approval"));
  const reopen = waiting.filter((row) => row.requestStatus === "withdrawn" || row.requestStatus === "cancelled" || row.requestStatus === "returned" || row.requestStatus === "rejected").map((row) => row.id);
  if (reopen.length) await db().update(schema.crmQuote).set({ status: "draft", approvalRequestId: null, updatedAt: new Date() }).where(inArray(schema.crmQuote.id, reopen));
  return { quotesExpired: expired.length, quotesReopened: reopen.length };
}

/** The approval request of a quote, for the approver's page. */
export async function quoteOfRequest(requestId: string): Promise<QuoteRow | undefined> {
  return (await db().select().from(schema.crmQuote).where(eq(schema.crmQuote.approvalRequestId, requestId)).limit(1))[0];
}
