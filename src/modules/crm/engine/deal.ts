// Deals, pure: what a deal is worth (FR-CRM-11), its weighted value and the forecast by close month
// (FR-CRM-13), the gates a stage asks for (FR-CRM-12), and when a deal has gone quiet.
import { addDays, type IsoDate } from "@/lib/dates";
import type { StageCategory, StageGate } from "../enums";

export type DealValueParts = { oneOffVnd: number | null; monthlyVnd: number | null; months: number | null };

/** One-off amount plus the monthly amount over its months. A monthly amount without months counts one month. */
export function dealValue(deal: DealValueParts): number {
  const monthly = (deal.monthlyVnd ?? 0) * Math.max(1, deal.months ?? 1);
  return (deal.oneOffVnd ?? 0) + (deal.monthlyVnd ? monthly : 0);
}

/** The deal's own probability, else its stage's; won is 100 and lost 0 whatever was typed. */
export function effectiveProbability(deal: { probability: number | null }, stage: { category: StageCategory; probability: number }): number {
  if (stage.category === "won") return 100;
  if (stage.category === "lost") return 0;
  return Math.min(100, Math.max(0, deal.probability ?? stage.probability));
}

/** Value × probability, rounded to the dong. */
export const weightedValue = (value: number, probability: number): number => Math.round((value * probability) / 100);

export type ForecastDeal = DealValueParts & { expectedCloseOn: IsoDate | null; probability: number };
export type ForecastMonth = { month: string; count: number; value: number; weighted: number };

/**
 * Open deals by the month they are expected to close. A deal with no date, or a date already past,
 * is "overdue" (key "none") — a forecast that quietly drops them would look better than it is.
 */
export function forecastByMonth(deals: readonly ForecastDeal[], today: IsoDate): ForecastMonth[] {
  const months = new Map<string, ForecastMonth>();
  const thisMonth = today.slice(0, 7);
  for (const deal of deals) {
    const month = deal.expectedCloseOn && deal.expectedCloseOn.slice(0, 7) >= thisMonth ? deal.expectedCloseOn.slice(0, 7) : "none";
    const value = dealValue(deal);
    const row = months.get(month) ?? { month, count: 0, value: 0, weighted: 0 };
    row.count += 1;
    row.value += value;
    row.weighted += weightedValue(value, deal.probability);
    months.set(month, row);
  }
  return [...months.values()].sort((a, b) => (a.month === "none" ? -1 : b.month === "none" ? 1 : a.month.localeCompare(b.month)));
}

export type GateFacts = { contacts: number; expectedCloseOn: IsoDate | null; value: number; quoteAccepted: boolean; contractSigned: boolean; pitchProject: boolean };

/** The gates of a stage the deal does not meet yet. Empty = it may enter. */
export function unmetGates(gates: readonly StageGate[], facts: GateFacts): StageGate[] {
  const met: Record<StageGate, boolean> = {
    contacts: facts.contacts > 0,
    close_date: !!facts.expectedCloseOn,
    value: facts.value > 0,
    quote_accepted: facts.quoteAccepted,
    contract_signed: facts.contractSigned,
    pitch_project: facts.pitchProject,
  };
  return gates.filter((gate) => !met[gate]);
}

/** An open deal nobody has touched — no activity, no stage change — for `days`. */
export function isStale(deal: { lastTouchedOn: IsoDate }, today: IsoDate, days: number): boolean {
  return deal.lastTouchedOn < addDays(today, -days);
}

/** Win rate over closed deals, whole percent; null when nothing has closed. */
export function winRate(won: number, lost: number): number | null {
  return won + lost === 0 ? null : Math.round((won * 100) / (won + lost));
}

/** Whole days between two dates (the sales cycle of a deal: created → won). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
