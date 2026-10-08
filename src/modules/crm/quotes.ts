// Quotes — báo giá (FR-CRM-21..24). A quote belongs to a deal, has a number shared by its versions,
// and moves draft → (approval) → approved → sent → accepted / rejected / expired. Its totals are
// computed by the engine from its lines on every save and kept on the row, so the page, the PDF and
// the deal read one set of figures. VAT comes from the parameter store in force on the day.
//
// A line discount above the entity's threshold, or an estimated margin under the floor, sends the
// quote to the approval engine (`crm:manage` over the deal's entity) before it may go out. The
// margin is computed from an aggregate cost rate (payroll's `blendedCostRate`) whoever submits; only
// a `pjm:cost` holder ever reads the figure — or the rule's verdict on a draft: for everyone else
// the margin is judged when the quote is sent, on the server, and a quote it stops goes to its
// approver then (`sendQuote`). A draft that showed "needs approval" flipping with the margin would
// hand a seller the team's average hourly cost for the price of a few edits.
//
// When the margin cannot be estimated (no delivering team, fewer than two people with a signed
// payroll month) the rule is not applied — and that is said: on the approval request's payload when
// there is one, and in the audit entry of the step that sent the quote out.
import "server-only";
import { and, asc, desc, eq, inArray, lt, ne } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { decideRequest, defineRequestType, submitRequest, withdrawRequest } from "../platform/approvals/service";
import { can } from "../platform/rbac/policy";
import { blendedCostRate } from "@/modules/payroll/service";
import { jobPrefix, jobYear, nextJobNumber } from "@/modules/projects/service";
import { approvalReasons, type ApprovalReason, draftApproval, type DraftApproval, marginEstimate, type MarginEstimate, marginWasChecked, quoteTotals } from "./engine/quote";
import type { QuoteStatus } from "./enums";
import type { RoleMinutes } from "./schema";
import { crmSettings, vatRates } from "./stages";

type Executor = Tx | ReturnType<typeof db>;
export type QuoteRow = typeof schema.crmQuote.$inferSelect;
export type QuoteLineRow = typeof schema.crmQuoteLine.$inferSelect;
/** `marginChecked: false` — the margin rule could not be applied to this quote; absent on requests made before that was recorded. */
export type QuotePayload = { quoteId: string; dealId: string; number: string; version: number; reasons: ApprovalReason[]; marginChecked?: boolean };
/** What the approval rules said of a quote, and whether the margin rule could be applied at all. */
export type QuoteApprovalCheck = { reasons: ApprovalReason[]; marginChecked: boolean };

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

export type QuoteLineInput = {
  serviceId: string | null;
  title: string;
  description: string | null;
  quantity: number;
  unit: string | null;
  unitPriceVnd: number;
  discountBp: number;
  months: number | null;
  format: string | null;
  channel: string | null;
  roleMinutes: RoleMinutes[];
};
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
    if (input.lines.length)
      await tx.insert(schema.crmQuoteLine).values(input.lines.map((line, index) => ({ ...line, quoteId, roleMinutes: line.roleMinutes.filter((entry) => entry.role.trim() && entry.minutes > 0), sortOrder: (index + 1) * 10 })));
    const [after] = await tx
      .update(schema.crmQuote)
      .set({
        title: input.title,
        validUntil: input.validUntil,
        vatRateBp: input.vatRateBp,
        intro: input.intro,
        terms: input.terms,
        subtotalVnd: totals.subtotalVnd,
        discountVnd: totals.discountVnd,
        vatVnd: totals.vatVnd,
        totalVnd: totals.totalVnd,
        maxDiscountBp: totals.maxDiscountBp,
        updatedAt: new Date(),
      })
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

/**
 * What the approval rules say of this quote, both of them, for the server's own use when a quote is
 * submitted or sent — never for a page (`quoteReaderView` is what a reader gets). Never inside a
 * transaction: it reads payroll's aggregate.
 */
async function checkQuoteApproval(quote: QuoteRow, lines: readonly QuoteLineRow[], today: IsoDate): Promise<QuoteApprovalCheck> {
  const settings = await crmSettings(today);
  const margin = await estimateMargin(quote, lines, today);
  return { reasons: approvalReasons({ maxDiscountBp: quote.maxDiscountBp }, margin, { discountThresholdBp: settings.quoteDiscountApprovalBp, marginFloorBp: settings.quoteMarginFloorBp }), marginChecked: marginWasChecked(margin) };
}

/** What one reader of a quote's page is given: the margin when they read margins, and — on a draft they may change — the approval signal they may know. */
export type QuoteReaderView = { margin: MarginEstimate | null; approval: DraftApproval | null };

/**
 * The quote's page for one reader. Without `pjm:cost` the margin is **not worked out at all** —
 * what was never computed cannot reach the page through a flag, a hidden step or a wording — and
 * the draft's approval signal is the discount rule alone (`draftApproval`).
 */
export async function quoteReaderView(quote: QuoteRow, lines: readonly QuoteLineRow[], reader: { seesMargin: boolean; drafts: boolean }, today: IsoDate = todayInVietnam()): Promise<QuoteReaderView> {
  const margin = reader.seesMargin ? await estimateMargin(quote, lines, today) : null;
  if (!reader.drafts || quote.status !== "draft" || lines.length === 0) return { margin, approval: null };
  const settings = await crmSettings(today);
  return { margin, approval: draftApproval({ maxDiscountBp: quote.maxDiscountBp }, margin, { discountThresholdBp: settings.quoteDiscountApprovalBp, marginFloorBp: settings.quoteMarginFloorBp }, reader.seesMargin) };
}

type FoundQuote = { quote: QuoteRow; lines: QuoteLineRow[] };
export type SubmittedQuote = { quote: QuoteRow; requestId: string | null; reasons: ApprovalReason[]; marginChecked: boolean };

/** The draft the check was worked out for, to its approver — or straight to "approved" when nothing asks. */
async function routeQuote(found: FoundQuote, check: QuoteApprovalCheck, actorPersonId: string): Promise<SubmittedQuote> {
  const { reasons, marginChecked } = check;
  const quoteId = found.quote.id;
  const deal = await dealOf(db(), found.quote.dealId);
  return db().transaction(async (tx) => {
    const quote = await lockQuote(tx, quoteId);
    if (quote.status !== "draft") throw new ActionError("quote_locked");
    if (quote.updatedAt.getTime() !== found.quote.updatedAt.getTime()) throw new ActionError("quote_changed");
    if (reasons.length === 0) {
      const [after] = await tx.update(schema.crmQuote).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
      return { quote: after, requestId: null, reasons, marginChecked };
    }
    const payload: QuotePayload = { quoteId, dealId: quote.dealId, number: quote.number, version: quote.version, reasons, marginChecked };
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
    return { quote: after, requestId: request.id, reasons, marginChecked };
  });
}

/**
 * A draft to its approver, or straight to "approved" when nothing asks for approval (the flow
 * administration may still require it: a configured flow with a step that applies always runs).
 *
 * The reasons are worked out before the transaction — the margin reads payroll's aggregate — and
 * the draft is then locked and checked to be the very draft they were worked out for.
 */
export async function submitQuote(quoteId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<SubmittedQuote> {
  const found = await getQuote(quoteId);
  if (!found) throw new ActionError("quote_not_found");
  if (found.quote.status !== "draft") throw new ActionError("quote_locked");
  if (found.lines.length === 0) throw new ActionError("quote_empty");
  return routeQuote(found, await checkQuoteApproval(found.quote, found.lines, today), actorPersonId);
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

/**
 * Sent to the client: an approved quote, or a draft nothing asks to approve. A draft the rules do
 * ask about is not refused: it goes to its approver instead, here and now. The person drafting was
 * not told beforehand what the margin rule would say (see the top of this file), so "send" is where
 * it is judged — and `check` says what was found, including a margin that could not be checked.
 */
export async function sendQuote(quoteId: string, actorPersonId: string, today: IsoDate = todayInVietnam()): Promise<{ before: QuoteRow; after: QuoteRow; check: QuoteApprovalCheck | null }> {
  const found = await getQuote(quoteId);
  if (!found) throw new ActionError("quote_not_found");
  let check: QuoteApprovalCheck | null = null;
  if (found.quote.status === "draft") {
    if (found.lines.length === 0) throw new ActionError("quote_empty");
    check = await checkQuoteApproval(found.quote, found.lines, today);
    if (check.reasons.length) return { before: found.quote, after: (await routeQuote(found, check, actorPersonId)).quote, check };
  }
  return db().transaction(async (tx) => {
    const before = await lockQuote(tx, quoteId);
    if (before.status === "draft" ? before.updatedAt.getTime() !== found.quote.updatedAt.getTime() : before.status !== "approved") throw new ActionError(before.status === "draft" ? "quote_changed" : "quote_not_sendable");
    const [after] = await tx.update(schema.crmQuote).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(schema.crmQuote.id, quoteId)).returning();
    return { before, after, check };
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
    const [after] = await tx
      .update(schema.crmQuote)
      .set({ status: accepted ? "accepted" : "rejected", decidedAt: new Date(), decisionNote: note, updatedAt: new Date() })
      .where(eq(schema.crmQuote.id, quoteId))
      .returning();
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
      .values({
        dealId: source.dealId,
        number: source.number,
        version: (latest?.version ?? source.version) + 1,
        title: source.title,
        status: "draft",
        validUntil: addDays(today, settings.quoteValidityDays),
        vatRateBp: source.vatRateBp,
        subtotalVnd: source.subtotalVnd,
        discountVnd: source.discountVnd,
        vatVnd: source.vatVnd,
        totalVnd: source.totalVnd,
        maxDiscountBp: source.maxDiscountBp,
        intro: source.intro,
        terms: source.terms,
        createdByPersonId: actorPersonId,
      })
      .returning();
    const lines = await tx.select().from(schema.crmQuoteLine).where(eq(schema.crmQuoteLine.quoteId, quoteId));
    if (lines.length)
      await tx.insert(schema.crmQuoteLine).values(
        lines.map((line) => ({
          serviceId: line.serviceId,
          title: line.title,
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceVnd: line.unitPriceVnd,
          discountBp: line.discountBp,
          months: line.months,
          format: line.format,
          channel: line.channel,
          roleMinutes: line.roleMinutes,
          sortOrder: line.sortOrder,
          quoteId: quote.id,
        })),
      );
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
