// Quotes, pure (FR-CRM-21, 22, 24): line and quote totals with VAT, whether a quote needs approval,
// and its estimated margin. Money is integer VND; rates are basis points (10% = 1000); every
// rounding is to the dong, half up, and written down here so the PDF, the page and the deal agree.
import type { RoleMinutes } from "../schema";

export type QuoteLineFigures = { quantity: number; unitPriceVnd: number; discountBp: number; /** null = one-off; n = monthly for n months. */ months: number | null };

const roundHalfUp = (value: number): number => Math.sign(value) * Math.round(Math.abs(value));

/** How many times the line's price is charged: once, or once a month. */
export const periodsOf = (line: Pick<QuoteLineFigures, "months">): number => (line.months && line.months > 0 ? line.months : 1);

/** Before discount: quantity × unit price × months. */
export const lineGross = (line: QuoteLineFigures): number => line.quantity * line.unitPriceVnd * periodsOf(line);

/** The line's discount in VND. */
export const lineDiscount = (line: QuoteLineFigures): number => roundHalfUp((lineGross(line) * clampBp(line.discountBp)) / 10_000);

/** After discount. */
export const lineNet = (line: QuoteLineFigures): number => lineGross(line) - lineDiscount(line);

/** A recurring line's net amount for one month. */
export const monthlyNet = (line: QuoteLineFigures): number => (line.months ? roundHalfUp(lineNet(line) / periodsOf(line)) : 0);

const clampBp = (bp: number): number => Math.min(10_000, Math.max(0, Math.round(bp)));

export type QuoteTotals = {
  subtotalVnd: number;
  discountVnd: number;
  netVnd: number;
  vatVnd: number;
  totalVnd: number;
  /** Net of one-off lines. */
  oneOffNetVnd: number;
  /** Net of recurring lines for one month, and the longest run of months among them. */
  monthlyNetVnd: number;
  months: number | null;
  maxDiscountBp: number;
};

/** The quote's totals. VAT is charged on the net total, rounded once — as an invoice would. */
export function quoteTotals(lines: readonly QuoteLineFigures[], vatRateBp: number): QuoteTotals {
  let subtotal = 0;
  let discount = 0;
  let oneOff = 0;
  let monthly = 0;
  let months: number | null = null;
  let maxDiscount = 0;
  for (const line of lines) {
    subtotal += lineGross(line);
    discount += lineDiscount(line);
    if (line.months) {
      monthly += monthlyNet(line);
      months = Math.max(months ?? 0, periodsOf(line));
    } else oneOff += lineNet(line);
    maxDiscount = Math.max(maxDiscount, clampBp(line.discountBp));
  }
  const net = subtotal - discount;
  const vat = roundHalfUp((net * clampBp(vatRateBp)) / 10_000);
  return { subtotalVnd: subtotal, discountVnd: discount, netVnd: net, vatVnd: vat, totalVnd: net + vat, oneOffNetVnd: oneOff, monthlyNetVnd: monthly, months, maxDiscountBp: maxDiscount };
}

/** Total estimated minutes of a quote, by role (the project's budget by role). */
export function minutesByRole(lines: readonly { roleMinutes: readonly RoleMinutes[] }[]): RoleMinutes[] {
  const byRole = new Map<string, number>();
  for (const line of lines) for (const entry of line.roleMinutes) if (entry.minutes > 0) byRole.set(entry.role, (byRole.get(entry.role) ?? 0) + entry.minutes);
  return [...byRole].map(([role, minutes]) => ({ role, minutes })).sort((a, b) => a.role.localeCompare(b.role));
}

/** A service's per-unit hours scaled to a line's quantity (and months, for a recurring line). */
export const scaleRoleMinutes = (perUnit: readonly RoleMinutes[], quantity: number, months: number | null): RoleMinutes[] => perUnit.map((entry) => ({ role: entry.role, minutes: entry.minutes * quantity * periodsOf({ months }) }));

export type MarginEstimate = { minutes: number; costVnd: number; marginVnd: number; marginBp: number | null };

/**
 * Estimated margin (FR-CRM-24): estimated hours × a blended loaded hourly cost against the net
 * price. The rate is an aggregate — the delivering team's average — never a person's. null rate =
 * no signed payroll to derive one from, and so no estimate.
 */
export function marginEstimate(netVnd: number, lines: readonly { roleMinutes: readonly RoleMinutes[] }[], hourlyCostVnd: number | null): MarginEstimate | null {
  if (hourlyCostVnd === null) return null;
  const minutes = minutesByRole(lines).reduce((sum, entry) => sum + entry.minutes, 0);
  const cost = roundHalfUp((minutes * hourlyCostVnd) / 60);
  const margin = netVnd - cost;
  return { minutes, costVnd: cost, marginVnd: margin, marginBp: netVnd > 0 ? Math.round((margin * 10_000) / netVnd) : null };
}

export type ApprovalRule = { discountThresholdBp: number; marginFloorBp: number };
export type ApprovalReason = "discount" | "margin";

/** Why a quote must be approved before it is sent; empty = it may go straight out. */
export function approvalReasons(totals: Pick<QuoteTotals, "maxDiscountBp">, margin: MarginEstimate | null, rule: ApprovalRule): ApprovalReason[] {
  const reasons: ApprovalReason[] = [];
  if (totals.maxDiscountBp > rule.discountThresholdBp) reasons.push("discount");
  if (margin && margin.marginBp !== null && margin.marginBp < rule.marginFloorBp) reasons.push("margin");
  return reasons;
}

/**
 * Whether the margin rule could be applied at all: there was a cost rate to estimate with and a
 * price to hold the cost against. When there was not, the quote still goes out on its discount
 * alone — and the trail says the margin was never checked, rather than letting silence read as "fine".
 */
export const marginWasChecked = (margin: MarginEstimate | null): boolean => margin !== null && margin.marginBp !== null;

/** What somebody drafting a quote is shown about approval: the reasons they may know, and the one step a draft offers. */
export type DraftApproval = { reasons: ApprovalReason[]; next: "submit" | "send" };

/**
 * The approval signal on a draft, for one reader (FR-CRM-22). A reader of margins (`pjm:cost`) sees
 * both rules as they stand. Everyone else sees the discount rule — it is their own figure — and
 * nothing of the margin rule: its verdict, shown while drafting, is an oracle. Vary the hours and
 * the price until it flips, and the boundary is the delivering team's average loaded hour — of a
 * team that may be two people. For them the margin is judged on the server when the quote is sent
 * (`sendQuote`), and whatever is passed here as `margin` is not looked at.
 */
export function draftApproval(totals: Pick<QuoteTotals, "maxDiscountBp">, margin: MarginEstimate | null, rule: ApprovalRule, seesMargin: boolean): DraftApproval {
  const reasons = approvalReasons(totals, seesMargin ? margin : null, rule);
  return { reasons, next: reasons.length ? "submit" : "send" };
}

/** Statuses from which a quote may still be edited, and the next steps each one allows. */
export const QUOTE_EDITABLE = new Set(["draft"]);
export const quoteNext = (status: string): string[] =>
  ({
    draft: ["submit", "send"],
    in_approval: ["withdraw"],
    approved: ["send", "revise"],
    sent: ["accept", "reject", "revise"],
    accepted: ["revise"],
    rejected: ["revise"],
    expired: ["revise"],
    superseded: [],
  })[status] ?? [];
