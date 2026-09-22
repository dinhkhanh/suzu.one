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
import { and, desc, eq, inArray, lte, ne } from "drizzle-orm";
import { cache } from "react";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { type DependantRegistration, listDependantRegistrations, listPayrollFacts, type PayrollPersonFacts, payrollFactsOf } from "@/modules/core-hr/service";
import { listEntities } from "@/modules/platform/org/service";
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

/**
 * Every calculated person of an entity's runs in the given months. Draft and cancelled runs are
 * nobody's filing. Remembered for the request (React `cache`): the statutory screen builds the
 * insurance list, the PIT declaration and the finalization side by side over the same months.
 */
function loadPeople(entityId: string, months: readonly string[]): Promise<LoadedPerson[]> {
  return months.length === 0 ? Promise.resolve([]) : loadPeopleOnce(entityId, months.join(","));
}

const loadPeopleOnce = cache(async (entityId: string, monthList: string): Promise<LoadedPerson[]> => {
  const months = monthList.split(",");
  const runs = await db()
    .select()
    .from(schema.payrollRun)
    .where(and(eq(schema.payrollRun.entityId, entityId), inArray(schema.payrollRun.month, [...months]), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.status, "draft")));
  if (runs.length === 0) return [];
  const rows = await db().select().from(schema.payrollRunPerson).where(inArray(schema.payrollRunPerson.runId, runs.map((run) => run.id)));
  const runOf = new Map(runs.map((run) => [run.id, run]));
  return rows.flatMap((row) => {
    const run = runOf.get(row.runId);
    return run ? [{ personId: row.personId, profile: row.profile, result: openResult(row), run }] : [];
  });
});

/** The entity, from the shared cache of entities. */
const entityOf = async (entityId: string) => (await listEntities()).find((row) => row.id === entityId) ?? null;

// ── Insurance increase / decrease (D02-LT) ──────────────────────────────────────────────────

/**
 * What changed about this entity's insurance in the month, against the month before it: who
 * started contributing, whose base moved, and who stopped and why. Built by holding the two
 * months' stored results side by side — the same comparison the accountant does by eye.
 */
export async function insuranceChanges(principal: Principal, entityId: string, month: string): Promise<{ entityCode: string; month: string; rows: D02ltRow[] } | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const previousMonth = shiftMonth(month, -1);
  const [entity, current, previous] = await Promise.all([entityOf(entityId), loadPeople(entityId, [month]), loadPeople(entityId, [previousMonth])]);
  if (!entity) return null;
  if (current.length === 0 && previous.length === 0) return null;

  // Each person's regular-run line of the month, by id (the first one, as a scan would find it).
  const regular = (people: LoadedPerson[]) => {
    const byPerson = new Map<string, LoadedPerson>();
    for (const person of people) if (person.run.kind === "regular" && !byPerson.has(person.personId)) byPerson.set(person.personId, person);
    return byPerson;
  };
  const currentRegular = regular(current);
  const previousRegular = regular(previous);
  const baseOf = (people: Map<string, LoadedPerson>, personId: string): number | null => {
    const person = people.get(personId);
    if (!person) return null;
    return person.result.insurance.covered ? person.result.insurance.bhxhBhytBase : 0;
  };

  const personIds = [...new Set([...currentRegular.keys(), ...previousRegular.keys()])];
  const [facts, positions] = await Promise.all([payrollFactsOf(personIds, month), positionNames(personIds, `${month}-01` as IsoDate)]);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  const rows: D02ltRow[] = [];
  for (const personId of personIds) {
    const now = baseOf(currentRegular, personId);
    const before = baseOf(previousRegular, personId);
    if (now === before) continue;
    const fact = factOf.get(personId);
    const person = currentRegular.get(personId);
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
  // The latest primary assignment that had started by the day — one row per person (DISTINCT ON).
  const rows = await db()
    .selectDistinctOn([schema.employment.personId], { personId: schema.employment.personId, name: schema.position.name })
    .from(schema.assignment)
    .innerJoin(schema.employment, eq(schema.employment.id, schema.assignment.employmentId))
    .innerJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
    .where(and(inArray(schema.employment.personId, [...personIds]), eq(schema.assignment.kind, "primary"), lte(schema.assignment.validFrom, onDate)))
    .orderBy(schema.employment.personId, desc(schema.assignment.validFrom));
  return new Map(rows.map((row) => [row.personId, row.name]));
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
  const [entity, people] = await Promise.all([entityOf(entityId), loadPeople(entityId, monthsOfPeriod(period))]);
  if (!entity) return null;
  if (people.length === 0) return null;
  const facts = await payrollFactsOf(people.map((person) => person.personId), lastMonthOf(period));
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
  const months = monthsOfPeriod(String(year));
  // Somebody who only has imported figures still belongs in the finalization.
  const [entity, people, imported] = await Promise.all([
    entityOf(entityId),
    loadPeople(entityId, months),
    db().select({ personId: schema.payrollYtd.personId }).from(schema.payrollYtd).where(and(eq(schema.payrollYtd.entityId, entityId), eq(schema.payrollYtd.year, year))),
  ]);
  if (!entity) return null;
  const personIds = [...new Set([...people.map((person) => person.personId), ...imported.map((row) => row.personId)])];
  if (personIds.length === 0) return null;

  // The imported year-to-date figures of everyone in it (wherever they were imported), read once.
  const [facts, statutory, ytd] = await Promise.all([payrollFactsOf(personIds, `${year}-12`), loadStatutoryParams(`${year}-12-31` as IsoDate), listYtdForPeople(personIds, year)]);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));
  const peopleOf = new Map<string, LoadedPerson[]>();
  for (const person of people) peopleOf.set(person.personId, [...(peopleOf.get(person.personId) ?? []), person]);

  const rows = personIds.map((personId): FinalizationRow => {
    const mine = peopleOf.get(personId) ?? [];
    const fact = factOf.get(personId);
    const extra: YtdFigures | null = ytd.get(personId)?.figures ?? null;
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
  const [entity, rows] = await Promise.all([entityOf(entityId), listDependantRegistrations({ entityIds: [entityId] }, lastMonthOf(period))]);
  if (!entity) return null;
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

  // The whole-entity build is reused and then narrowed to this person, so a certificate and the
  // appendix the person appears in can never disagree. Access was decided above: either it is the
  // person's own year, or the viewer manages the entity's compensation.
  const [entity, all, facts, months] = await Promise.all([
    entityOf(input.entityId),
    buildFinalizationRows(input.entityId, input.year),
    listPayrollFacts({ personIds: [input.personId] }, `${input.year}-12`),
    db()
    .selectDistinct({ month: schema.payrollRun.month })
    .from(schema.payrollRunPerson)
    .innerJoin(schema.payrollRun, eq(schema.payrollRun.id, schema.payrollRunPerson.runId))
    .where(and(eq(schema.payrollRunPerson.personId, input.personId), eq(schema.payrollRun.entityId, input.entityId), ne(schema.payrollRun.status, "cancelled"), ne(schema.payrollRun.status, "draft"))),
  ]);
  if (!entity) return null;
  const person = all?.rows.find((row) => row.personId === input.personId);
  if (!person) return null;

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
