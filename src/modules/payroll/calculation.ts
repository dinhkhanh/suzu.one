// Gathering one entity-month's payroll inputs and handing them to the pure engine.
//
// This is the only file in payroll that reads the database *for a calculation*: it turns the
// locked timesheet, the leave ledger, the salary structures, the pay profiles, the component
// catalogue, the entity's policy and the statutory snapshot into `PersonPayInput` records, and
// calls `calculatePerson` on each. It does not decide who may see the result — **no authorization
// inside**; the run use-cases (week 4) check `canManageCompensation` before calling.
import "server-only";
import { eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getLockedTimesheets, getTimesheetDays, type LockedTimesheet, type TimesheetDayRow } from "@/modules/attendance/service";
import { listPayrollFacts, type PayrollPersonFacts } from "@/modules/core-hr/service";
import { getLeaveUsage, type LeaveUsage } from "@/modules/leave/service";
import { resolveCatalogue, resolveCatalogueVersions } from "./components";
import { calculatePerson, PAYROLL_ENGINE_VERSION } from "./engine/calculate";
import type { ComponentDefinition } from "./engine/components";
import { payableOvertime, payPeriodOf, type PaySegment, type ProfileFacts } from "./engine/period";
import { isRoundingRule } from "./engine/rounding";
import type { PayInput, PersonPayInput, PersonPayResult, PriorInMonth, RetroItem } from "./engine/types";
import { getPayrollPolicy, getPayrollPolicyVersion } from "./policies";
import { getProfilesOn, listProfilesBetween, type PayProfileRow } from "./profiles";
import { listStructuresBetween, type SalaryStructureView } from "./salaries";
import { loadStatutoryParams, loadStatutoryParamsByVersion, type LoadedStatutoryParams } from "./statutory";

type Executor = Tx | ReturnType<typeof db>;

/** Everything one entity-month's calculation was made from — stored with the run (FR-PAY-20). */
export type CalculationContext = {
  entityId: string;
  month: string;
  engineVersion: string;
  policyVersionId: string;
  /** statutory key → the id of the version used. */
  parameterVersions: Record<string, string>;
  /** Statutory values the chief accountant has not confirmed yet: shown on every run until they are. */
  unverifiedParameters: string[];
  componentVersionIds: string[];
  lockedAt: Date;
};

export type PersonCalculation = { input: PersonPayInput; result: PersonPayResult; facts: PayrollPersonFacts };

export type EntityMonthCalculation = { context: CalculationContext; people: PersonCalculation[] };

/** Figures typed into a run, per person — bonuses, advances, penalties (`payroll_run_input`). */
export type RunInputs = ReadonlyMap<string, PayInput[]>;
/** Differences from earlier months to carry into this run, per person (FR-PAY-17). */
export type RunRetro = ReadonlyMap<string, RetroItem[]>;
/** What an earlier run of the same month already taxed, per person (FR-PAY-19). */
export type RunPrior = ReadonlyMap<string, PriorInMonth>;

export type CalculateOptions = {
  inputs?: RunInputs;
  retro?: RunRetro;
  /** Set on an off-cycle run; the regular run of the month supplies it. */
  prior?: RunPrior;
  kind?: "regular" | "off_cycle";
  /**
   * Reuse the statutory versions, pay policy and catalogue an earlier run was calculated with,
   * instead of what is in force today — how a past month is recomputed to derive a retro
   * difference, so the difference is the change that was made and not a change in the law.
   */
  context?: CalculationContext;
  executor?: Executor;
};

/**
 * Calculate an entity's month. Refuses rather than guesses: without a locked timesheet there is
 * nothing to pay on (FR-PAY-10), and a missing statutory value or pay policy stops the run.
 */
export async function calculateEntityMonth(entityId: string, month: string, options: CalculateOptions = {}): Promise<EntityMonthCalculation> {
  const executor = options.executor ?? db();
  const period = payPeriodOf(month, 0);
  const locked = await getLockedTimesheets(entityId, month, executor);
  if (!locked) throw new ActionError("timesheet_not_locked", { entityId, month });

  const [entity] = await executor.select().from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1);
  if (!entity) throw new ActionError("entity_not_found");
  const wageRegion = asWageRegion(entity.wageRegion);

  const personIds = locked.people.map((row) => row.personId);
  const replay = options.context ?? null;
  const [statutory, policy, catalogue, structures, profiles, facts, leave, days] = await Promise.all([
    replay ? loadStatutoryParamsByVersion(replay.parameterVersions, executor) : loadStatutoryParams(period.end, executor),
    replay ? getPayrollPolicyVersion(replay.policyVersionId, executor) : getPayrollPolicy(entityId, period.end, executor),
    replay ? resolveCatalogueVersions(replay.componentVersionIds, executor) : resolveCatalogue(entityId, period.end, executor),
    listStructuresBetween(entityId, period.start, period.end, executor),
    listProfilesBetween(entityId, period.start, period.end, executor),
    listPayrollFacts({ personIds }, month, executor),
    personIds.length > 0 ? getLeaveUsage({ personIds }, period.start, period.end, executor) : Promise.resolve([] as LeaveUsage[]),
    // The frozen daily rows: how a month with a mid-month salary change is split exactly, rather
    // than in proportion to the calendar.
    getTimesheetDays(personIds, period.start, period.end, executor),
  ]);

  const components = catalogue.map(toComponentDefinition);
  // The month's own working days: the divisor, taken from the person the month asked most of —
  // a joiner's or leaver's shorter month must not shrink everybody's divisor.
  const monthStandardDays = locked.people.reduce((most, row) => Math.max(most, row.standardDays), 0);
  const currentProfiles = await getProfilesOn(personIds, period.end, executor);

  const people: PersonCalculation[] = [];
  for (const timesheet of locked.people) {
    const personFacts = facts.find((row) => row.personId === timesheet.personId);
    if (!personFacts) continue;
    const profile = profiles.filter((row) => row.personId === timesheet.personId).at(-1) ?? currentProfiles.get(timesheet.personId) ?? null;
    if (!profile) throw new ActionError("pay_profile_missing", { personId: timesheet.personId });
    const input = buildPersonInput({
      entityId,
      month,
      monthStandardDays,
      wageRegion,
      timesheet,
      facts: personFacts,
      profile,
      structures: structures.filter((row) => row.personId === timesheet.personId),
      days: days.filter((row) => row.personId === timesheet.personId),
      leave: leave.filter((row) => row.personId === timesheet.personId),
      components,
      inputs: options.inputs?.get(timesheet.personId) ?? [],
      retro: options.retro?.get(timesheet.personId) ?? [],
      priorInMonth: options.prior?.get(timesheet.personId) ?? null,
      runKind: options.kind ?? "regular",
      policy: policy.value,
      statutory,
    });
    people.push({ input, result: calculatePerson(input), facts: personFacts });
  }

  return {
    context: {
      entityId,
      month,
      engineVersion: PAYROLL_ENGINE_VERSION,
      policyVersionId: policy.id,
      parameterVersions: statutory.versions,
      unverifiedParameters: statutory.unverified,
      componentVersionIds: components.map((component) => component.versionId),
      lockedAt: locked.lockedAt,
    },
    people,
  };
}

/** One person, for a payslip preview or a re-check. Same path as the whole month. */
export async function calculateOnePerson(entityId: string, month: string, personId: string, options: { inputs?: PayInput[]; executor?: Executor } = {}): Promise<PersonCalculation | null> {
  const calculation = await calculateEntityMonth(entityId, month, { inputs: new Map([[personId, options.inputs ?? []]]), executor: options.executor });
  return calculation.people.find((person) => person.input.personId === personId) ?? null;
}

// ── Turning rows into the engine's plain input ──────────────────────────────────────────────

export function toComponentDefinition(row: typeof schema.payComponent.$inferSelect): ComponentDefinition {
  if (!isRoundingRule(row.roundingRule)) throw new ActionError("component_rounding_rule_unknown", { code: row.code });
  return {
    versionId: row.id,
    code: row.code,
    name: row.name,
    kind: row.kind,
    category: row.category,
    source: row.source,
    taxTreatment: row.taxTreatment,
    exemptCap: row.exemptCap,
    subjectToInsurance: row.subjectToInsurance,
    proration: row.proration,
    roundingRule: row.roundingRule,
    formula: row.formula,
    sortOrder: row.sortOrder,
  };
}

const asWageRegion = (region: number | null): 1 | 2 | 3 | 4 => {
  // Without a region there is no unemployment-insurance cap to apply; region I is the highest
  // minimum wage and therefore the highest cap, so defaulting to it never under-deducts.
  if (region === 2 || region === 3 || region === 4) return region;
  return 1;
};

export function buildPersonInput(source: {
  entityId: string;
  month: string;
  monthStandardDays: number;
  wageRegion: 1 | 2 | 3 | 4;
  timesheet: LockedTimesheet;
  facts: PayrollPersonFacts;
  profile: PayProfileRow;
  structures: SalaryStructureView[];
  days: TimesheetDayRow[];
  leave: LeaveUsage[];
  components: ComponentDefinition[];
  inputs: PayInput[];
  /** Differences from months already paid (FR-PAY-17); empty on an ordinary month. */
  retro?: RetroItem[];
  /** An off-cycle run: what the month's regular run already taxed (FR-PAY-19). */
  priorInMonth?: PriorInMonth | null;
  runKind?: "regular" | "off_cycle";
  policy: PersonPayInput["policy"];
  statutory: LoadedStatutoryParams;
}): PersonPayInput {
  const period = payPeriodOf(source.month, source.monthStandardDays);
  const { timesheet } = source;
  // Overtime taken as time off in lieu is already in the leave ledger and must not be paid again.
  const overtime = payableOvertime(timesheet.overtime, timesheet.overtime.timeOffMinutes);

  // Days the insurance fund paid for instead of the company (maternity, long sick leave): paid
  // days on the timesheet, but months that do not carry a company contribution (FR-PAY-11).
  const insuranceLeaveDays = centiToDays(source.leave.filter((row) => row.payrollTreatment === "paid_insurance").reduce((sum, row) => sum + row.daysCenti, 0));
  const unpaidWorkingDays = centiToDays(source.leave.filter((row) => row.payrollTreatment === "unpaid").reduce((sum, row) => sum + row.daysCenti, 0));

  return {
    personId: source.facts.personId,
    entityId: source.entityId,
    period,
    wageRegion: source.wageRegion,
    employment: {
      startDate: source.facts.startDate && source.facts.startDate > period.start ? source.facts.startDate : null,
      endDate: source.facts.endDate && source.facts.endDate < period.end ? source.facts.endDate : null,
      dependents: source.facts.dependents,
      serviceMonths: monthsOfService(source.facts.seniorityDate ?? source.facts.startDate, period.end),
      // The month's KPI score is a Phase 8 input; nothing reads it until a formula does.
      kpiScoreBp: 0,
    },
    profile: toProfileFacts(source.profile),
    segments: buildSegments(source.structures, timesheet, period.start, period.end, source.days),
    timesheet: {
      standardDays: timesheet.standardDays,
      standardMinutes: timesheet.standardMinutes,
      paidDaysCenti: timesheet.paidDaysCenti,
      unpaidDaysCenti: timesheet.unpaidDaysCenti,
      workedMinutes: timesheet.workedMinutes,
      nightMinutes: timesheet.nightMinutes,
      overtime,
    },
    insuranceLeaveDays,
    unpaidWorkingDays,
    components: source.components,
    inputs: source.inputs,
    retro: source.retro ?? [],
    otherPitDeductions: 0,
    priorInMonth: source.priorInMonth ?? null,
    runKind: source.runKind ?? "regular",
    policy: source.policy,
    statutory: source.statutory.params,
  };
}

export const toProfileFacts = (profile: PayProfileRow): ProfileFacts => ({
  profile: profile.profile,
  taxResidency: profile.taxResidency,
  pitMethod: profile.pitMethod,
  pitCommitment: profile.pitCommitment,
  insuranceExemption: profile.insuranceExemption,
  unionMember: profile.unionMember,
});

/**
 * What one frozen day of the timesheet contributes, counted exactly as `summariseDays` counted it
 * into the month's totals — so the segments of a month always add back up to the locked figures.
 */
export function dayWeight(day: TimesheetDayRow): { standardDays: number; paidDaysCenti: number; unpaidDaysCenti: number } {
  const asked = day.requiredMinutes + day.holidayMinutes;
  if (asked <= 0) return { standardDays: 0, paidDaysCenti: 0, unpaidDaysCenti: 0 };
  const paid = day.workedMinutes + day.creditedMinutes + day.leavePaidMinutes + day.holidayMinutes;
  return {
    standardDays: 1,
    paidDaysCenti: Math.round((Math.min(asked, paid) * 100) / asked),
    unpaidDaysCenti: Math.round((Math.min(asked, day.leaveUnpaidMinutes + day.absenceMinutes) * 100) / asked),
  };
}

/**
 * The month cut at every salary change (FR-PAY-16).
 *
 * With the frozen daily rows of a locked month each piece gets exactly the days that fall inside
 * it — a raise on the 17th is paid on the days actually worked before and after, not on a share
 * of the calendar. Without them (a month whose days were never stored) the month's totals are
 * shared out in proportion to the days each piece spans, largest remainder first so the parts
 * still add up to the locked total.
 */
export function buildSegments(structures: readonly SalaryStructureView[], timesheet: LockedTimesheet, start: IsoDate, end: IsoDate, days: readonly TimesheetDayRow[] = []): PaySegment[] {
  const sorted = [...structures].sort((a, b) => a.validFrom.localeCompare(b.validFrom));
  if (sorted.length === 0) {
    return [{ from: start, to: end, terms: { baseSalary: 0, insuranceSalary: 0, allowances: [] }, standardDays: timesheet.standardDays, paidDaysCenti: timesheet.paidDaysCenti, unpaidDaysCenti: timesheet.unpaidDaysCenti }];
  }

  const bounds = sorted.map((structure, index) => ({
    structure,
    from: structure.validFrom > start ? structure.validFrom : start,
    to: nextDay(sorted[index + 1]?.validFrom) && nextDay(sorted[index + 1]!.validFrom)! < end ? nextDay(sorted[index + 1]!.validFrom)! : structure.validTo && structure.validTo < end ? structure.validTo : end,
  }));
  if (bounds.length === 1) {
    return [{ from: bounds[0].from, to: bounds[0].to, terms: bounds[0].structure.terms, standardDays: timesheet.standardDays, paidDaysCenti: timesheet.paidDaysCenti, unpaidDaysCenti: timesheet.unpaidDaysCenti }];
  }

  if (days.length > 0) {
    return bounds.map((bound) => {
      const inside = days.filter((day) => day.date >= bound.from && day.date <= bound.to).map(dayWeight);
      return {
        from: bound.from,
        to: bound.to,
        terms: bound.structure.terms,
        standardDays: inside.reduce((sum, day) => sum + day.standardDays, 0),
        paidDaysCenti: inside.reduce((sum, day) => sum + day.paidDaysCenti, 0),
        unpaidDaysCenti: inside.reduce((sum, day) => sum + day.unpaidDaysCenti, 0),
      };
    });
  }

  const spans = bounds.map((bound) => Math.max(0, dayCount(bound.from, bound.to)));
  const totalSpan = spans.reduce((sum, span) => sum + span, 0) || 1;
  const paid = shareOut(timesheet.paidDaysCenti, spans, totalSpan);
  const unpaid = shareOut(timesheet.unpaidDaysCenti, spans, totalSpan);
  const standard = shareOut(timesheet.standardDays, spans, totalSpan);
  return bounds.map((bound, index) => ({ from: bound.from, to: bound.to, terms: bound.structure.terms, standardDays: standard[index], paidDaysCenti: paid[index], unpaidDaysCenti: unpaid[index] }));
}

/** Splits `total` over the given weights, largest remainder first, so the parts add back to `total`. */
function shareOut(total: number, weights: readonly number[], totalWeight: number): number[] {
  const exact = weights.map((weight) => (total * weight) / totalWeight);
  const parts = exact.map(Math.floor);
  const order = exact.map((value, index) => ({ index, remainder: value - parts[index] })).sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let left = total - parts.reduce((sum, part) => sum + part, 0);
  for (const { index } of order) {
    if (left <= 0) break;
    parts[index] += 1;
    left -= 1;
  }
  return parts;
}

const dayCount = (from: IsoDate, to: IsoDate): number => Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const nextDay = (date: IsoDate | undefined): IsoDate | null => (date ? new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null);
const centiToDays = (centi: number): number => Math.round(centi / 100);

/** Whole months from a start date to the period's end — what a seniority formula reads. */
export function monthsOfService(from: IsoDate | null, to: IsoDate): number {
  if (!from || from > to) return 0;
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  return Math.max(0, (toYear - fromYear) * 12 + (toMonth - fromMonth) - (toDay < fromDay ? 1 : 0));
}

/** The people of a month who have no pay profile yet — a run must not start with one missing. */
export async function listPeopleWithoutProfile(entityId: string, month: string, executor: Executor = db()): Promise<string[]> {
  const locked = await getLockedTimesheets(entityId, month, executor);
  if (!locked) return [];
  const personIds = locked.people.map((row) => row.personId);
  if (personIds.length === 0) return [];
  const profiles = await getProfilesOn(personIds, payPeriodOf(month, 0).end, executor);
  const rows = await executor.select({ id: schema.person.id, fullName: schema.person.fullName }).from(schema.person).where(inArray(schema.person.id, personIds));
  return rows.filter((row) => !profiles.has(row.id)).map((row) => row.fullName);
}
