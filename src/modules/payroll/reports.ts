// Payroll reports (FR-PAY-34): the register, the cost breakdown, the insurance and PIT summaries,
// the union report and the cost trend.
//
// Every one of them is built from **stored run results** — never recalculated — so a report and
// the payslips behind it can never disagree (FR-PAY-20).
//
// Scoping: each function takes the viewer's principal and filters **in SQL** by `payroll:read`
// reach before a single figure is decrypted (FR-ACL-04). A viewer with no reach gets an empty
// report, not a refusal — there is nothing to tell them about.
//
// These reports are entity-level and department-level; the only one that names people is the
// register, which is the C&B working document and therefore takes `payroll:propose`.
import "server-only";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { listPayrollFacts } from "@/modules/core-hr/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { PersonPayResult } from "./engine/types";
import { canManageCompensation, compensationReach, payrollReadReach } from "./policy";
import { withinReach } from "./reach";
import { openResult, openTotals, type PayrollRunRow, type RunTotals } from "./run-storage";

export type ReportFilter = { entityId?: string | null; month?: string | null; fromMonth?: string | null; toMonth?: string | null };

/** A run in the viewer's reach, with its people already decrypted. */
type LoadedRun = { run: PayrollRunRow; entityCode: string; entityName: string; people: { personId: string; profile: "statutory" | "simple"; result: PersonPayResult }[] };

/**
 * Loads the runs a report needs, filtered in SQL. Cancelled runs are never in a report, and
 * neither are runs that have not been calculated — a draft is nobody's cost.
 */
async function loadRuns(principal: Principal, filter: ReportFilter, options: { withPeople?: boolean } = {}): Promise<LoadedRun[]> {
  const reach = payrollReadReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return [];

  const rows = await db()
    .select({ run: schema.payrollRun, entityCode: schema.entity.code, entityName: schema.entity.shortName })
    .from(schema.payrollRun)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.payrollRun.entityId))
    .where(
      and(
        withinReach(schema.payrollRun.entityId, reach),
        ne(schema.payrollRun.status, "cancelled"),
        ne(schema.payrollRun.status, "draft"),
        filter.entityId ? eq(schema.payrollRun.entityId, filter.entityId) : undefined,
        filter.month ? eq(schema.payrollRun.month, filter.month) : undefined,
      ),
    )
    .orderBy(desc(schema.payrollRun.month), schema.payrollRun.createdAt);

  const wanted = rows.filter((row) => inRange(row.run.month, filter));
  if (wanted.length === 0) return [];
  if (!options.withPeople) return wanted.map((row) => ({ ...row, people: [] }));

  const people = await db()
    .select()
    .from(schema.payrollRunPerson)
    .where(inArray(schema.payrollRunPerson.runId, wanted.map((row) => row.run.id)));

  return wanted.map((row) => ({
    ...row,
    people: people.filter((person) => person.runId === row.run.id).map((person) => ({ personId: person.personId, profile: person.profile, result: openResult(person) })),
  }));
}

const inRange = (month: string, filter: ReportFilter) => (!filter.fromMonth || month >= filter.fromMonth) && (!filter.toMonth || month <= filter.toMonth);

// ── The payroll register (FR-PAY-34) ────────────────────────────────────────────────────────

export type RegisterLine = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  departmentName: string | null;
  profile: "statutory" | "simple";
  gross: number;
  employeeInsurance: number;
  unionDues: number;
  pit: number;
  otherDeductions: number;
  net: number;
  employerInsurance: number;
  unionFund: number;
  employerCost: number;
};

export type Register = { entityCode: string; month: string; lines: RegisterLine[]; totals: RunTotals };

/**
 * One line per person in a month: what they earned, what came off, what they took home. This is
 * the one report that names people and their pay, so it takes **`payroll:propose`** over the
 * entity — C&B and the owner — not the wider `payroll:read` the totals reports use.
 */
export async function payrollRegister(principal: Principal, entityId: string, month: string): Promise<Register | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const runs = await loadRuns(principal, { entityId, month }, { withPeople: true });
  if (runs.length === 0) return null;

  const personIds = [...new Set(runs.flatMap((loaded) => loaded.people.map((person) => person.personId)))];
  const facts = await listPayrollFacts({ personIds }, month);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));
  const departments = await db().select({ id: schema.orgUnit.id, name: schema.orgUnit.name }).from(schema.orgUnit);
  const departmentOf = new Map(departments.map((row) => [row.id, row.name]));

  // A month can hold a regular run and off-cycle runs; the register is the month, so they add up.
  const byPerson = new Map<string, RegisterLine>();
  for (const loaded of runs) {
    for (const person of loaded.people) {
      const fact = factOf.get(person.personId);
      const totals = person.result.totals;
      const existing = byPerson.get(person.personId);
      const line: RegisterLine = {
        personId: person.personId,
        fullName: fact?.fullName ?? "—",
        employeeCode: fact?.employeeCode ?? null,
        departmentName: fact?.departmentId ? (departmentOf.get(fact.departmentId) ?? null) : null,
        profile: person.profile,
        gross: (existing?.gross ?? 0) + totals.grossEarnings,
        employeeInsurance: (existing?.employeeInsurance ?? 0) + totals.employeeInsurance,
        unionDues: (existing?.unionDues ?? 0) + totals.unionDues,
        pit: (existing?.pit ?? 0) + totals.pit,
        otherDeductions: (existing?.otherDeductions ?? 0) + totals.otherDeductions,
        net: (existing?.net ?? 0) + totals.net,
        employerInsurance: (existing?.employerInsurance ?? 0) + totals.employerInsurance,
        unionFund: (existing?.unionFund ?? 0) + totals.unionFund,
        employerCost: (existing?.employerCost ?? 0) + totals.employerCost,
      };
      byPerson.set(person.personId, line);
    }
  }

  const lines = [...byPerson.values()].sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? "") || left.fullName.localeCompare(right.fullName));
  return { entityCode: runs[0].entityCode, month, lines, totals: sumRuns(runs) };
}

const sumRuns = (runs: readonly LoadedRun[]): RunTotals =>
  runs.reduce<RunTotals>(
    (totals, loaded) => {
      const run = openTotals(loaded.run);
      return {
        headcount: totals.headcount + run.headcount,
        grossEarnings: totals.grossEarnings + run.grossEarnings,
        employeeInsurance: totals.employeeInsurance + run.employeeInsurance,
        employerInsurance: totals.employerInsurance + run.employerInsurance,
        unionDues: totals.unionDues + run.unionDues,
        unionFund: totals.unionFund + run.unionFund,
        pit: totals.pit + run.pit,
        totalDeductions: totals.totalDeductions + run.totalDeductions,
        net: totals.net + run.net,
        employerCost: totals.employerCost + run.employerCost,
        netStatutory: totals.netStatutory + run.netStatutory,
        netSimple: totals.netSimple + run.netSimple,
      };
    },
    { headcount: 0, grossEarnings: 0, employeeInsurance: 0, employerInsurance: 0, unionDues: 0, unionFund: 0, pit: 0, totalDeductions: 0, net: 0, employerCost: 0, netStatutory: 0, netSimple: 0 },
  );

// ── Cost by entity and department (FR-PAY-34, FR-RPT-03) ────────────────────────────────────

export type CostRow = { key: string; label: string; headcount: number; gross: number; employerInsurance: number; unionFund: number; employerCost: number };
export type CostReport = { month: string; byEntity: CostRow[]; byDepartment: CostRow[]; total: CostRow };

/** What the month cost, per entity and per department. Totals only — nobody is named. */
export async function costReport(principal: Principal, filter: ReportFilter): Promise<CostReport> {
  const runs = await loadRuns(principal, filter, { withPeople: true });
  const month = filter.month ?? "";
  if (runs.length === 0) return { month, byEntity: [], byDepartment: [], total: { key: "total", label: "", headcount: 0, gross: 0, employerInsurance: 0, unionFund: 0, employerCost: 0 } };

  const personIds = [...new Set(runs.flatMap((loaded) => loaded.people.map((person) => person.personId)))];
  const facts = await listPayrollFacts({ personIds }, runs[0].run.month);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));
  const departments = await db().select({ id: schema.orgUnit.id, name: schema.orgUnit.name }).from(schema.orgUnit);
  const departmentOf = new Map(departments.map((row) => [row.id, row.name]));

  const entityRows = new Map<string, CostRow>();
  const departmentRows = new Map<string, CostRow>();
  const add = (rows: Map<string, CostRow>, key: string, label: string, result: PersonPayResult) => {
    const row = rows.get(key) ?? { key, label, headcount: 0, gross: 0, employerInsurance: 0, unionFund: 0, employerCost: 0 };
    rows.set(key, {
      ...row,
      headcount: row.headcount + 1,
      gross: row.gross + result.totals.grossEarnings,
      employerInsurance: row.employerInsurance + result.totals.employerInsurance,
      unionFund: row.unionFund + result.totals.unionFund,
      employerCost: row.employerCost + result.totals.employerCost,
    });
  };

  for (const loaded of runs) {
    for (const person of loaded.people) {
      add(entityRows, loaded.run.entityId, loaded.entityName, person.result);
      const departmentId = factOf.get(person.personId)?.departmentId;
      add(departmentRows, departmentId ?? "none", departmentId ? (departmentOf.get(departmentId) ?? "—") : "—", person.result);
    }
  }

  const totals = sumRuns(runs);
  return {
    month,
    byEntity: [...entityRows.values()].sort((left, right) => right.employerCost - left.employerCost),
    byDepartment: [...departmentRows.values()].sort((left, right) => right.employerCost - left.employerCost),
    total: { key: "total", label: "", headcount: totals.headcount, gross: totals.grossEarnings, employerInsurance: totals.employerInsurance, unionFund: totals.unionFund, employerCost: totals.employerCost },
  };
}

// ── Insurance contribution summary (FR-PAY-34: reconciled with the BHXH monthly notice) ─────

export type InsuranceLine = { personId: string; fullName: string; employeeCode: string | null; socialInsuranceNumber: string | null; base: number; employee: { bhxh: number; bhyt: number; bhtn: number }; employer: { bhxh: number; bhyt: number; bhtn: number }; covered: boolean; reason: string | null };
export type InsuranceSummary = { month: string; entityCode: string; lines: InsuranceLine[]; totals: { base: number; employee: number; employer: number; grandTotal: number }; notCovered: number };

/**
 * Person by person, what was contributed and on what base — the figures the BHXH portal's monthly
 * notice is checked against. Names people, so it takes `payroll:propose` like the register.
 */
export async function insuranceSummary(principal: Principal, entityId: string, month: string): Promise<InsuranceSummary | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  // Only the regular run contributes: an off-cycle bonus never re-opens the month's insurance.
  const runs = (await loadRuns(principal, { entityId, month }, { withPeople: true })).filter((loaded) => loaded.run.kind === "regular");
  if (runs.length === 0) return null;

  const people = runs.flatMap((loaded) => loaded.people);
  const facts = await listPayrollFacts({ personIds: people.map((person) => person.personId) }, month);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  const lines = people
    .map((person): InsuranceLine => {
      const insurance = person.result.insurance;
      const fact = factOf.get(person.personId);
      return {
        personId: person.personId,
        fullName: fact?.fullName ?? "—",
        employeeCode: fact?.employeeCode ?? null,
        socialInsuranceNumber: fact?.socialInsuranceNumber ?? null,
        base: insurance.bhxhBhytBase,
        employee: insurance.employee,
        employer: insurance.employer,
        covered: insurance.covered,
        reason: insurance.reason,
      };
    })
    .sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? ""));

  const sum = (pick: (line: InsuranceLine) => number) => lines.reduce((total, line) => total + pick(line), 0);
  const employee = sum((line) => line.employee.bhxh + line.employee.bhyt + line.employee.bhtn);
  const employer = sum((line) => line.employer.bhxh + line.employer.bhyt + line.employer.bhtn);

  return {
    month,
    entityCode: runs[0].entityCode,
    lines,
    totals: { base: sum((line) => line.base), employee, employer, grandTotal: employee + employer },
    notCovered: lines.filter((line) => !line.covered).length,
  };
}

// ── PIT withholding summary (FR-PAY-34) ─────────────────────────────────────────────────────

export type PitLine = { personId: string; fullName: string; employeeCode: string | null; taxCode: string | null; hasTaxCode: boolean; method: PersonPayResult["pit"]["method"]; taxableIncome: number; assessableIncome: number; dependents: number; tax: number };
export type PitSummary = { month: string; entityCode: string; lines: PitLine[]; totals: { taxableIncome: number; tax: number }; byMethod: { method: string; people: number; tax: number }[]; missingTaxCodes: number };

/** What was withheld from whom — the working paper behind the monthly 05/KK-TNCN declaration. */
export async function pitSummary(principal: Principal, entityId: string, month: string): Promise<PitSummary | null> {
  if (!canManageCompensation(principal, { entityId })) return null;
  const runs = await loadRuns(principal, { entityId, month }, { withPeople: true });
  if (runs.length === 0) return null;

  const facts = await listPayrollFacts({ personIds: [...new Set(runs.flatMap((loaded) => loaded.people.map((person) => person.personId)))] }, month);
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  // A month's off-cycle runs are part of the same withholding: they add up per person.
  const byPerson = new Map<string, PitLine>();
  for (const loaded of runs) {
    for (const person of loaded.people) {
      const pit = person.result.pit;
      const fact = factOf.get(person.personId);
      const existing = byPerson.get(person.personId);
      byPerson.set(person.personId, {
        personId: person.personId,
        fullName: fact?.fullName ?? "—",
        employeeCode: fact?.employeeCode ?? null,
        taxCode: fact?.taxCode ?? null,
        hasTaxCode: !!fact?.hasTaxCode,
        method: pit.method,
        taxableIncome: (existing?.taxableIncome ?? 0) + pit.taxableIncome,
        assessableIncome: (existing?.assessableIncome ?? 0) + pit.assessableIncome,
        dependents: pit.dependents,
        tax: (existing?.tax ?? 0) + pit.tax,
      });
    }
  }

  const lines = [...byPerson.values()].sort((left, right) => (left.employeeCode ?? "").localeCompare(right.employeeCode ?? ""));
  const methods = new Map<string, { method: string; people: number; tax: number }>();
  for (const line of lines) {
    const row = methods.get(line.method) ?? { method: line.method, people: 0, tax: 0 };
    methods.set(line.method, { method: line.method, people: row.people + 1, tax: row.tax + line.tax });
  }

  return {
    month,
    entityCode: runs[0].entityCode,
    lines,
    totals: { taxableIncome: lines.reduce((total, line) => total + line.taxableIncome, 0), tax: lines.reduce((total, line) => total + line.tax, 0) },
    byMethod: [...methods.values()],
    // Somebody paid without a tax code is a problem for the declaration, not for the payslip.
    missingTaxCodes: lines.filter((line) => !line.hasTaxCode && line.tax > 0).length,
  };
}

// ── Union report (FR-PAY-34, FR-PAY-12) ─────────────────────────────────────────────────────

export type UnionReport = { month: string; rows: { entityCode: string; members: number; dues: number; fund: number; total: number }[]; total: { members: number; dues: number; fund: number; total: number } };

/** What the union costs, per entity: the members' dues and the employer's fund. */
export async function unionReport(principal: Principal, filter: ReportFilter): Promise<UnionReport> {
  const runs = await loadRuns(principal, filter, { withPeople: true });
  const rows = new Map<string, { entityCode: string; members: number; dues: number; fund: number; total: number }>();

  for (const loaded of runs) {
    const row = rows.get(loaded.entityCode) ?? { entityCode: loaded.entityCode, members: 0, dues: 0, fund: 0, total: 0 };
    const dues = loaded.people.reduce((sum, person) => sum + person.result.totals.unionDues, 0);
    const fund = loaded.people.reduce((sum, person) => sum + person.result.totals.unionFund, 0);
    rows.set(loaded.entityCode, {
      entityCode: loaded.entityCode,
      members: row.members + loaded.people.filter((person) => person.result.totals.unionDues > 0).length,
      dues: row.dues + dues,
      fund: row.fund + fund,
      total: row.total + dues + fund,
    });
  }

  const all = [...rows.values()];
  return {
    month: filter.month ?? "",
    rows: all,
    total: all.reduce((total, row) => ({ members: total.members + row.members, dues: total.dues + row.dues, fund: total.fund + row.fund, total: total.total + row.total }), { members: 0, dues: 0, fund: 0, total: 0 }),
  };
}

// ── Headcount and cost trend (FR-PAY-34) ────────────────────────────────────────────────────

export type TrendPoint = { month: string; headcount: number; gross: number; net: number; employerCost: number };

/** Month by month across the viewer's entities, newest last — what the cost is doing over time. */
export async function costTrend(principal: Principal, filter: ReportFilter): Promise<TrendPoint[]> {
  const runs = await loadRuns(principal, { entityId: filter.entityId, fromMonth: filter.fromMonth, toMonth: filter.toMonth });
  const points = new Map<string, TrendPoint>();
  for (const loaded of runs) {
    const totals = openTotals(loaded.run);
    const point = points.get(loaded.run.month) ?? { month: loaded.run.month, headcount: 0, gross: 0, net: 0, employerCost: 0 };
    points.set(loaded.run.month, {
      month: loaded.run.month,
      // Off-cycle runs pay people who are already counted; only the regular run is headcount.
      headcount: point.headcount + (loaded.run.kind === "regular" ? totals.headcount : 0),
      gross: point.gross + totals.grossEarnings,
      net: point.net + totals.net,
      employerCost: point.employerCost + totals.employerCost,
    });
  }
  return [...points.values()].sort((left, right) => left.month.localeCompare(right.month));
}

// ── What the screens need to offer ──────────────────────────────────────────────────────────

/** The entities a viewer may read payroll for, and the months that have a run. */
export async function reportOptions(principal: Principal): Promise<{ entities: { id: string; code: string; shortName: string }[]; months: string[] }> {
  const reach = payrollReadReach(principal);
  if (!reach.all && reach.entityIds.length === 0) return { entities: [], months: [] };
  const [entities, months] = await Promise.all([
    db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).where(withinReach(schema.entity.id, reach)).orderBy(schema.entity.code),
    db().selectDistinct({ month: schema.payrollRun.month }).from(schema.payrollRun).where(and(withinReach(schema.payrollRun.entityId, reach), ne(schema.payrollRun.status, "cancelled"))).orderBy(desc(schema.payrollRun.month)),
  ]);
  return { entities, months: months.map((row) => row.month) };
}

/** Can this viewer see the reports that name people? (The register, insurance and PIT summaries.) */
export const seesNamedReports = (principal: Principal): boolean => {
  const reach = compensationReach(principal);
  return reach.all || reach.entityIds.length > 0;
};
