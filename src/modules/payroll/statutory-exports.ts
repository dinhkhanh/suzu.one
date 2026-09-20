// The data behind the statutory filings (FR-PAY-35): the insurance increase/decrease list, the
// monthly or quarterly PIT declaration, the annual finalization with its appendices, the
// dependants register and a person's withholding certificate.
//
// Like the reports, every figure here comes from **stored run results** — never recalculated — so
// a filing and the payslips behind it can never disagree (FR-PAY-20). The only figures that do
// not come from a run are the year-to-date rows imported for months the system did not run.
//
// Scoping: each function takes the viewer's principal and answers `null` to anyone without
// `payroll:propose` over the entity. These exports name people and carry their tax codes and
// national IDs, so they are C&B and the owner only — the same rule as the payroll register.
import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { type DependantRegistration, listDependantRegistrations, listPayrollFacts, type PayrollPersonFacts } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { PersonPayResult } from "./engine/types";
import { progressiveTax } from "./engine/pit";
import type { D02ltReason, D02ltRow } from "./exports/statutory/d02lt";
import type { FinalizationRow } from "./exports/statutory/pit-finalization";
import type { PitPersonRow } from "./exports/statutory/pit-monthly";
import { canManageCompensation } from "./policy";
import { openResult, type PayrollRunRow } from "./run-storage";
import { loadStatutoryParams } from "./statutory";
import { listYtdForPeople, type YtdFigures } from "./ytd";

type LoadedPerson = { personId: string; profile: "statutory" | "simple"; result: PersonPayResult; run: PayrollRunRow };

/** The months a declaration period covers: "2026-08" → one; "2026-Q3" → three; a year → twelve. */
export function monthsOfPeriod(period: string): string[] {
  const quarter = /^(\d{4})-Q([1-4])$/.exec(period);
  if (quarter) {
    const first = (Number(quarter[2]) - 1) * 3 + 1;
    return [0, 1, 2].map((offset) => `${quarter[1]}-${String(first + offset).padStart(2, "0")}`);
  }
  if (/^\d{4}$/.test(period)) return Array.from({ length: 12 }, (_, index) => `${period}-${String(index + 1).padStart(2, "0")}`);
  return [period];
}

export const lastMonthOf = (period: string): string => monthsOfPeriod(period).at(-1) ?? period;

/** Every calculated person of an entity's runs in the given months. Draft and cancelled runs are nobody's filing. */
async function loadPeople(entityId: string, months: readonly string[]): Promise<LoadedPerson[]> {
  if (months.length === 0) return [];
  const runs = await db()
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, entityId), inArray(schema.payrollRun.month, [...months]), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.status, "draft")));
  if (runs.length === 0) return [];
  const rows = await db().select().from(schema.payrollRunPerson).where(inArray(schema.payrollRunPerson.runId, runs.map((run) => run.id)));
  return rows.flatMap((row) => {
    const run = runs.find((candidate) => candidate.id === row.runId);
    return run ? [{ personId: row.personId, profile: row.profile, result: openResult(row), run }] : [];
  });
}

const entityOf = async (entityId: string) => (await db().select().from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1))[0] ?? null;

// ── Insurance increase / decrease (D02-LT) ──────────────────────────────────────────────────

/**
 * What changed about this entity's insurance in the month, against the month before it: who
 * started contributing, whose base moved, and who stopped and why. Built by holding the two
 * months' stored results side by side — the same comparison the accountant does by eye.
 */
export async function insuranceChanges(principal: Principal, entityId: string, month: string): Promise<{ entityCode: string; month: string; rows: D02ltRow[] } | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const entity = await entityOf(entityId);
  if (!entity) return null;

  const previousMonth = shiftMonth(month, -1);
  const [current, previous] = await Promise.all([loadPeople(entityId, [month]), loadPeople(entityId, [previousMonth])]);
  if (current.length === 0 && previous.length === 0) return null;

  const regular = (people: LoadedPerson[]) => people.filter((person) => person.run.kind === "regular");
  const baseOf = (people: LoadedPerson[], personId: string): number | null => {
    const person = regular(people).find((candidate) => candidate.personId === personId);
    if (!person) return null;
    return person.result.insurance.covered ? person.result.insurance.bhxhBhytBase : 0;
  };

  const personIds = [...new Set([...regular(current), ...regular(previous)].map((person) => person.personId))];
  const facts = await listPayrollFacts({ personIds }, month);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));
  const positions = await positionNames(personIds, `${month}-01` as IsoDate);

  const rows: D02ltRow[] = [];
  for (const personId of personIds) {
    const now = baseOf(current, personId);
    const before = baseOf(previous, personId);
    if (now === before) continue;
    const fact = factOf.get(personId);
    const person = regular(current).find((candidate) => candidate.personId === personId);
    const reason = changeReason(before, now, person);
    if (!reason) continue;
    rows.push({
      fullName: fact?.fullName ?? "—",
      socialInsuranceNumber: fact?.socialInsuranceNumber ?? null,
      nationalId: fact?.nationalId ?? null,
      dateOfBirth: fact?.dateOfBirth ?? null,
      gender: fact?.gender ?? null,
      positionName: positions.get(personId) ?? null,
      month,
      previousBase: before ?? 0,
      newBase: now ?? 0,
      reason,
      note: person?.result.insurance.reason ? null : null,
      employeeCode: fact?.employeeCode ?? null,
    });
  }

  return { entityCode: entity.code, month, rows: rows.sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "")) };
}

/** Which block of D02-LT the change belongs to. `null` when there is nothing to declare. */
function changeReason(before: number | null, now: number | null, person: LoadedPerson | undefined): D02ltReason | null {
  const stopped = person?.result.insurance.reason;
  if ((before ?? 0) === 0 && (now ?? 0) > 0) return "new_participant";
  if ((now ?? 0) === 0 && (before ?? 0) > 0) {
    if (!person) return "left";
    if (stopped === "unpaid_leave_threshold") return "unpaid_leave";
    if (stopped === "no_salary") return "insurance_leave";
    return stopped ? "other_stop" : "left";
  }
  if ((now ?? 0) > (before ?? 0)) return "base_increase";
  if ((now ?? 0) < (before ?? 0)) return "base_decrease";
  return null;
}

async function positionNames(personIds: readonly string[], onDate: IsoDate): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map();
  const rows = await db()
    .select({ personId: schema.employment.personId, name: schema.position.name, validFrom: schema.assignment.validFrom })
    .from(schema.assignment)
    .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
    .innerJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .where(and(inArray(schema.employment.personId, [...personIds]), eq(schema.assignment.kind, "primary")))
    .orderBy(schema.assignment.validFrom);
  const names = new Map<string, string>();
  for (const row of rows) if (row.validFrom <= onDate) names.set(row.personId, row.name);
  return names;
}

export function shiftMonth(month: string, by: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + by, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ── PIT declaration (05/KK-TNCN) ────────────────────────────────────────────────────────────

/** One row per person for the period, with every run of every month in it added together. */
export async function pitPeriodRows(principal: Principal, entityId: string, period: string): Promise<{ entityCode: string; period: string; rows: PitPersonRow[] } | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const entity = await entityOf(entityId);
  if (!entity) return null;

  const people = await loadPeople(entityId, monthsOfPeriod(period));
  if (people.length === 0) return null;
  const facts = await listPayrollFacts({ personIds: [...new Set(people.map((person) => person.personId))] }, lastMonthOf(period));
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  const byPerson = new Map<string, PitPersonRow>();
  for (const person of people) {
    const pit = person.result.pit;
    const fact = factOf.get(person.personId);
    const existing = byPerson.get(person.personId);
    const deductions = pit.personalDeduction + pit.dependentDeduction + pit.insuranceDeduction + pit.otherDeductions;
    byPerson.set(person.personId, {
      personId: person.personId,
      fullName: fact?.fullName ?? "—",
      employeeCode: fact?.employeeCode ?? null,
      taxCode: fact?.taxCode ?? null,
      // The method of the latest run in the period is the one the person is declared under.
      method: existing && person.run.kind !== "regular" ? existing.method : pit.method,
      taxableIncome: (existing?.taxableIncome ?? 0) + pit.taxableIncome,
      deductions: (existing?.deductions ?? 0) + deductions,
      assessableIncome: (existing?.assessableIncome ?? 0) + pit.assessableIncome,
      dependents: Math.max(existing?.dependents ?? 0, pit.dependents),
      tax: (existing?.tax ?? 0) + pit.tax,
    });
  }

  return { entityCode: entity.code, period, rows: [...byPerson.values()].sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "")) };
}

// ── Annual finalization (05/QTT-TNCN) ───────────────────────────────────────────────────────

/**
 * The year per person: every run of the year, plus the year-to-date figures imported for the
 * months the system did not run. `taxDue` re-taxes the year's assessable income with the brackets
 * in force at the year's end — a check against what was actually withheld, never a filing of
 * its own.
 */
export async function finalizationRows(principal: Principal, entityId: string, year: number): Promise<{ entityCode: string; year: number; rows: FinalizationRow[] } | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  return buildFinalizationRows(entityId, year);
}

/**
 * The finalization itself, with **no authorization inside** — every caller checks first. It is its
 * own function because a person's withholding certificate is one row of the entity's finalization,
 * and the two must never be able to disagree.
 */
async function buildFinalizationRows(entityId: string, year: number): Promise<{ entityCode: string; year: number; rows: FinalizationRow[] } | null> {
  const entity = await entityOf(entityId);
  if (!entity) return null;

  const months = monthsOfPeriod(String(year));
  const people = await loadPeople(entityId, months);
  const personIds = [...new Set(people.map((person) => person.personId))];
  const ytd = await listYtdForPeople(personIds, year);
  // Somebody who only has imported figures still belongs in the finalization.
  const imported = await db().select().from(schema.payrollYtd).where(and(eq(schema.payrollYtd.entityId, entityId), eq(schema.payrollYtd.year, year)));
  for (const row of imported) if (!personIds.includes(row.personId)) personIds.push(row.personId);
  if (personIds.length === 0) return null;

  const [facts, statutory] = await Promise.all([listPayrollFacts({ personIds }, `${year}-12`), loadStatutoryParams(`${year}-12-31` as IsoDate)]);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));
  const ytdAll = await listYtdForPeople(personIds, year);

  const rows = personIds.map((personId): FinalizationRow => {
    const mine = people.filter((person) => person.personId === personId);
    const fact = factOf.get(personId);
    const extra: YtdFigures | null = (ytdAll.get(personId) ?? ytd.get(personId))?.figures ?? null;
    const add = (pick: (result: PersonPayResult) => number) => mine.reduce((total, person) => total + pick(person.result), 0);
    const method = mine.at(-1)?.result.pit.method ?? "progressive";

    const taxableIncome = add((result) => result.pit.taxableIncome) + (extra?.taxableIncome ?? 0);
    const insuranceDeduction = add((result) => result.pit.insuranceDeduction) + (extra?.insuranceDeduction ?? 0);
    const personalDeduction = add((result) => result.pit.personalDeduction) + (extra?.personalDeduction ?? 0);
    const dependentDeduction = add((result) => result.pit.dependentDeduction) + (extra?.dependentDeduction ?? 0);
    const otherDeductions = add((result) => result.pit.otherDeductions) + (extra?.otherDeductions ?? 0);
    const assessableIncome = add((result) => result.pit.assessableIncome) + (extra?.assessableIncome ?? 0);
    const taxWithheld = add((result) => result.pit.tax) + (extra?.taxWithheld ?? 0);

    return {
      personId,
      fullName: fact?.fullName ?? "—",
      employeeCode: fact?.employeeCode ?? null,
      taxCode: fact?.taxCode ?? null,
      nationalId: fact?.nationalId ?? null,
      method,
      hasImportedPeriod: !!extra,
      taxableIncome,
      insuranceDeduction,
      personalDeduction,
      dependentDeduction,
      otherDeductions,
      dependents: mine.at(-1)?.result.pit.dependents ?? 0,
      assessableIncome,
      taxWithheld,
      // The year's brackets are the monthly ones times twelve; a flat-rate person owes what was withheld.
      taxDue: method === "progressive" ? progressiveTax(assessableIncome, statutory.params.pitBrackets.map((bracket) => ({ upTo: bracket.upTo === null ? null : bracket.upTo * 12, rate: bracket.rate }))).tax : taxWithheld,
    };
  });

  return { entityCode: entity.code, year, rows: rows.sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "")) };
}

// ── Dependants register and the withholding certificate ─────────────────────────────────────

export async function dependantRows(principal: Principal, entityId: string, period: string): Promise<{ entityCode: string; period: string; rows: DependantRegistration[] } | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const entity = await entityOf(entityId);
  if (!entity) return null;
  const rows = await listDependantRegistrations({ entityIds: [entityId] }, lastMonthOf(period));
  return { entityCode: entity.code, period, rows };
}

export type CertificateData = { entityName: string; entityTaxCode: string | null; entityAddress: string | null; year: number; person: FinalizationRow & { dateOfBirth: string | null }; months: string[]; issuedOn: string };

/**
 * One person's year as a withholding certificate (FR-PAY-35). Readable by C&B over the entity and
 * the owner — and, like a payslip, by the person it is about.
 */
export async function withholdingCertificate(principal: Principal, input: { personId: string; entityId: string; year: number }, today: string): Promise<CertificateData | null> {
  const own = !!principal.personId && principal.personId === input.personId;
  if (!own && !canManageCompensation(principal, { entityId: input.entityId })) return null;

  const entity = await entityOf(input.entityId);
  if (!entity) return null;
  // The whole-entity build is reused and then narrowed to this person, so a certificate and the
  // appendix the person appears in can never disagree. Access was decided above: either it is the
  // person's own year, or the viewer manages the entity's compensation.
  const all = await buildFinalizationRows(input.entityId, input.year);
  const person = all?.rows.find((row) => row.personId === input.personId);
  if (!person) return null;

  const facts = await listPayrollFacts({ personIds: [input.personId] }, `${input.year}-12`);
  const months = await db()
    .selectDistinct({ month: schema.payrollRun.month })
    .from(schema.payrollRunPerson)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
    .where(and(eq(schema.payrollRunPerson.personId, input.personId), eq(schema.payrollRun.entityId, input.entityId), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.status, "draft")));

  return {
    entityName: entity.legalName,
    entityTaxCode: entity.taxCode,
    entityAddress: entity.address,
    year: input.year,
    person: { ...person, dateOfBirth: facts[0]?.dateOfBirth ?? null },
    months: months.map((row) => row.month).filter((month) => month.startsWith(String(input.year))).sort(),
    issuedOn: today,
  };
}

export type { PayrollPersonFacts };
