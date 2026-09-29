// Won deal → delivery plan, pure (FR-CRM-15): what a project made from a sale starts with. The
// accepted quote is the promise — its one-off lines become the deliverables register, its monthly
// lines the retainer's monthly scope, its estimates the hours budget by role; without a quote the
// deal's own values are all there is. The projects module writes the result; this only decides it.
import type { RoleMinutes } from "../schema";
import { lineNet, minutesByRole, monthlyNet, periodsOf, type QuoteLineFigures } from "./quote";

export type SaleLine = QuoteLineFigures & { title: string; format: string | null; channel: string | null; roleMinutes: readonly RoleMinutes[] };
export type SaleContact = { name: string; role: string | null; contact: string | null };
export type SaleDeal = { title: string; nextStep: string | null; oneOffVnd: number | null; monthlyVnd: number | null; months: number | null; serviceLines: readonly string[] };

export type SalePlan = {
  kind: "client" | "retainer";
  /** The project's fee: the one-off part of what was sold. null = none (a retainer bills monthly). */
  feeVnd: number | null;
  deliverables: { title: string; quantity: number; format: string | null; channel: string | null }[];
  retainer: { startMonth: string; endMonth: string | null; lines: { title: string; quantity: number; format: string | null; channel: string | null }[]; feePerMonthVnd: number | null; minutesPerMonth: number | null } | null;
  budgetByRole: RoleMinutes[];
  brief: { objective: string; scopeIn: string; clientContacts: { name: string; role?: string; contact?: string }[] };
};

/** "2026-10" plus n months. */
export function addMonths(month: string, count: number): string {
  const [year, mon] = month.split("-").map(Number);
  const index = year * 12 + (mon - 1) + count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

const describe = (line: Pick<SaleLine, "quantity" | "title">): string => `${line.quantity} × ${line.title}`;

/**
 * The plan of a project made from a won deal. `startMonth` is the first month of a retainer (the
 * project's start). A deal with monthly value is a retainer; everything else is a one-off client
 * project, whatever the quote held.
 */
export function salePlanFrom(deal: SaleDeal, lines: readonly SaleLine[], contacts: readonly SaleContact[], startMonth: string): SalePlan {
  const oneOff = lines.filter((line) => !line.months);
  const recurring = lines.filter((line) => !!line.months);
  const isRetainer = recurring.length > 0 || (lines.length === 0 && !!deal.monthlyVnd);
  const months = recurring.length ? Math.max(...recurring.map((line) => periodsOf(line))) : deal.months && deal.months > 0 ? deal.months : null;
  const feeOneOff = lines.length ? oneOff.reduce((sum, line) => sum + lineNet(line), 0) : (deal.oneOffVnd ?? 0);
  const feePerMonth = lines.length ? recurring.reduce((sum, line) => sum + monthlyNet(line), 0) : (deal.monthlyVnd ?? 0);
  // A recurring line's estimate covers all its months; the retainer's allowance is one month of it.
  const monthlyMinutes = recurring.reduce((sum, line) => sum + line.roleMinutes.reduce((total, entry) => total + entry.minutes, 0) / periodsOf(line), 0);
  const scope = lines.length ? lines.map((line) => (line.months ? `${describe(line)} / ${line.months}` : describe(line))).join("\n") : deal.serviceLines.join(", ");
  return {
    kind: isRetainer ? "retainer" : "client",
    feeVnd: feeOneOff > 0 ? feeOneOff : null,
    deliverables: oneOff.map((line) => ({ title: line.title, quantity: line.quantity, format: line.format, channel: line.channel })),
    retainer: isRetainer
      ? {
          startMonth,
          endMonth: months ? addMonths(startMonth, months - 1) : null,
          lines: recurring.map((line) => ({ title: line.title, quantity: line.quantity, format: line.format, channel: line.channel })),
          feePerMonthVnd: feePerMonth > 0 ? feePerMonth : null,
          minutesPerMonth: monthlyMinutes > 0 ? Math.round(monthlyMinutes) : null,
        }
      : null,
    budgetByRole: minutesByRole(oneOff),
    brief: {
      objective: [deal.title, deal.nextStep].filter(Boolean).join(" — "),
      scopeIn: scope,
      clientContacts: contacts.map((contact) => ({ name: contact.name, ...(contact.role ? { role: contact.role } : {}), ...(contact.contact ? { contact: contact.contact } : {}) })),
    },
  };
}
