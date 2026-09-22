// Acceptance — biên bản nghiệm thu (FR-PJM-55) — and the billing hand-off it feeds (FR-PJM-56).
// Pure: no I/O.
//
// An acceptance is a snapshot: the register lines in its scope (one client-facing milestone, one
// retainer month, or the whole project) with what was promised, what the client accepted and what
// was delivered, taken when the record is made. The register moves on; the paper the client signs
// does not.
import type { AcceptanceItem } from "../schema";
import type { RegisterStatus } from "./register";

export const ACCEPTANCE_SCOPES = ["milestone", "retainer_period", "project"] as const;
export type AcceptanceScope = (typeof ACCEPTANCE_SCOPES)[number];
export const ACCEPTANCE_STATUSES = ["draft", "sent", "signed", "void"] as const;
export type AcceptanceStatus = (typeof ACCEPTANCE_STATUSES)[number];

export type ScopedLine = {
  id: string;
  title: string;
  milestoneId: string | null;
  retainerPeriodId: string | null;
  cancelled: boolean;
  promised: number;
  counts: Record<RegisterStatus, number>;
  accepted: number;
};

/**
 * The lines an acceptance covers. A milestone: the lines working towards it. A retainer month:
 * that month's lines. The project: every line outside the retainer months (each month is
 * accepted on its own). Cancelled lines were withdrawn promises and are not accepted.
 */
export function linesInScope<Line extends ScopedLine>(lines: readonly Line[], scope: AcceptanceScope, target: { milestoneId?: string | null; retainerPeriodId?: string | null }): Line[] {
  const live = lines.filter((line) => !line.cancelled);
  if (scope === "milestone") return live.filter((line) => !!target.milestoneId && line.milestoneId === target.milestoneId);
  if (scope === "retainer_period") return live.filter((line) => !!target.retainerPeriodId && line.retainerPeriodId === target.retainerPeriodId);
  return live.filter((line) => !line.retainerPeriodId);
}

/** Units at "delivered" or beyond (handed over or published). */
const deliveredOf = (counts: Record<RegisterStatus, number>) => counts.delivered + counts.published;

/** The items of the paper: promised, delivered and accepted per line, with the links that show them. */
export const acceptanceItems = (lines: readonly ScopedLine[], links: ReadonlyMap<string, readonly string[]>): AcceptanceItem[] =>
  lines.map((line) => ({ deliverableId: line.id, title: line.title, promised: line.promised, delivered: deliveredOf(line.counts), accepted: line.accepted, links: [...(links.get(line.id) ?? [])] }));

export type AcceptanceTotals = { promised: number; delivered: number; accepted: number; /** Every promise accepted. */ complete: boolean };
export function acceptanceTotals(items: readonly AcceptanceItem[]): AcceptanceTotals {
  const promised = items.reduce((sum, item) => sum + item.promised, 0);
  const delivered = items.reduce((sum, item) => sum + item.delivered, 0);
  const accepted = items.reduce((sum, item) => sum + item.accepted, 0);
  return { promised, delivered, accepted, complete: items.length > 0 && items.every((item) => item.accepted >= item.promised) };
}

export type AcceptanceAction = "send" | "sign" | "void";

/**
 * The paper's life: draft → sent → signed, or void before it is signed. A client may sign what was
 * never formally "sent" (handed over in the meeting). A signed record is final: it has made a
 * billing item, and a mistake is corrected by a new record, not by rewriting this one.
 */
export function acceptanceNext(status: AcceptanceStatus, action: AcceptanceAction): AcceptanceStatus | null {
  if (action === "send") return status === "draft" ? "sent" : null;
  if (action === "sign") return status === "draft" || status === "sent" ? "signed" : null;
  return status === "draft" || status === "sent" ? "void" : null;
}

/** The number the paper is quoted by: "SZM-26-042/NT-03". */
export const acceptanceNumber = (jobNumber: string | null, number: number): string => `${jobNumber ?? "NT"}/NT-${String(number).padStart(2, "0")}`;

/**
 * The items as the body of the biên bản: one numbered line per item, then its links. Plain text —
 * the document template decides everything around it.
 */
export function acceptanceItemsText(items: readonly AcceptanceItem[], words: { promised: string; delivered: string; accepted: string }): string {
  return items
    .map((item, index) => {
      const head = `${index + 1}. ${item.title} — ${words.promised}: ${item.promised}; ${words.delivered}: ${item.delivered}; ${words.accepted}: ${item.accepted}`;
      return [head, ...item.links.map((link) => `   ${link}`)].join("\n");
    })
    .join("\n");
}

// ── Billing items (FR-PJM-56) ────────────────────────────────────────────────────────────────

export const BILLING_SOURCES = ["acceptance", "milestone", "retainer", "manual"] as const;
export type BillingSource = (typeof BILLING_SOURCES)[number];
export const BILLING_STATUSES = ["ready", "invoiced", "waived"] as const;
export type BillingStatus = (typeof BILLING_STATUSES)[number];

/** Finance's two answers to a ready item; a decided item is settled for good. */
export const billingDecidable = (status: BillingStatus): boolean => status === "ready";

/**
 * What a whole-project acceptance bills: the project's fee less what its milestones and months
 * have billed already (waived items billed nothing). Never below zero; no fee, no amount.
 */
export function projectFeeLeft(feeVnd: number | null, billed: readonly { amountVnd: number | null; status: BillingStatus }[]): number | null {
  if (feeVnd === null) return null;
  const taken = billed.filter((item) => item.status !== "waived").reduce((sum, item) => sum + (item.amountVnd ?? 0), 0);
  return Math.max(0, feeVnd - taken);
}
