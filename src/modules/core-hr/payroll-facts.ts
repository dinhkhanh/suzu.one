// What payroll (Phase 5) needs to know about people, in one read per run. Re-exported by
// service.ts. **No authorization inside**: the callers are payroll use-cases that have already
// checked compensation access — this file hands out restricted data (tax code, pay account), so
// nothing else may call it, and what it returns must never be logged or put into an audit row.
import "server-only";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { cache } from "react";
import { fieldCipher } from "@/lib/crypto";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { countDependentsInMonth } from "./engine/dependents";
import { type EmploymentFacts, listEmploymentFacts, peopleScope } from "./employment-facts";
import { dependentContext, sensitiveContext } from "./field-contexts";
import { recordLifecycleEvent } from "./lifecycle-events";
import type { BankAccount } from "./records";

type Executor = Tx | ReturnType<typeof db>;

export type PayrollPersonFacts = EmploymentFacts & {
  /** Dependents whose deduction months include the payroll month (FR-PAY-13: "per registered months"). */
  dependents: number;
  /** Decrypted — for the PIT exports only. `hasTaxCode` is what variance checks use. */
  taxCode: string | null;
  hasTaxCode: boolean;
  socialInsuranceNumber: string | null;
  /** The insurance and PIT forms match a person on their national ID when no code is on file. */
  nationalId: string | null;
  /** The first account on file is the pay account. */
  bankAccount: BankAccount | null;
  /** The contract in force on the month's last day (else the latest before it); appendices and NDAs ignored. */
  contract: { type: "probation" | "fixed_term" | "indefinite" | "service" | "internship"; startDate: IsoDate; endDate: IsoDate | null } | null;
};

const monthBounds = (month: string): { first: IsoDate; last: IsoDate } => {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { first: `${month}-01` as IsoDate, last: `${month}-${String(lastDay).padStart(2, "0")}` as IsoDate };
};

/** Facts for a payroll month ("2026-08") about the given people, or everyone of the given entities. */
export async function listPayrollFacts(filter: { personIds?: readonly string[]; entityIds?: readonly string[] }, month: string, executor: Executor = db()): Promise<PayrollPersonFacts[]> {
  if (filter.personIds?.length === 0 || filter.entityIds?.length === 0) return [];
  const scope = peopleScope(filter, executor);
  const { last } = monthBounds(month);
  // Everything in one round trip: each read names the same people by the same condition.
  const [facts, dependents, sensitive, contracts] = await Promise.all([
    listEmploymentFacts(filter, executor),
    executor.select({ personId: schema.dependent.personId, deductionFrom: schema.dependent.deductionFrom, deductionTo: schema.dependent.deductionTo }).from(schema.dependent).where(and(scope(schema.dependent.personId), isNull(schema.dependent.deletedAt))),
    executor.select().from(schema.personSensitive).where(scope(schema.personSensitive.personId)),
    executor.select().from(schema.contract).where(and(scope(schema.contract.personId), isNull(schema.contract.deletedAt), inArray(schema.contract.type, ["probation", "fixed_term", "indefinite", "service", "internship"]))).orderBy(desc(schema.contract.startDate)),
  ]);
  if (facts.length === 0) return [];
  const cipher = sensitive.some((row) => row.taxCode || row.bankAccounts || row.socialInsuranceNumber || row.nationalId) ? fieldCipher() : null;
  const open = (row: (typeof sensitive)[number] | undefined, field: "taxCode" | "socialInsuranceNumber" | "bankAccounts" | "nationalId") => (row?.[field] && cipher ? cipher.decrypt(row[field], sensitiveContext(field, row.personId)) : null);
  const sensitiveOf = new Map(sensitive.map((row) => [row.personId, row]));
  const group = <Row extends { personId: string }>(rows: readonly Row[]) => {
    const by = new Map<string, Row[]>();
    for (const row of rows) by.set(row.personId, [...(by.get(row.personId) ?? []), row]);
    return by;
  };
  const dependentsOf = group(dependents);
  const contractsOf = group(contracts);

  return facts.map((fact) => {
    const row = sensitiveOf.get(fact.personId);
    const accounts = open(row, "bankAccounts");
    const mine = (contractsOf.get(fact.personId) ?? []).filter((contract) => contract.startDate <= last);
    const inForce = mine.find((contract) => (contract.terminatedOn ?? contract.endDate ?? "9999-12-31") >= last) ?? mine[0] ?? null;
    const taxCode = open(row, "taxCode");
    return {
      ...fact,
      dependents: countDependentsInMonth(dependentsOf.get(fact.personId) ?? [], month),
      taxCode,
      hasTaxCode: !!taxCode,
      socialInsuranceNumber: open(row, "socialInsuranceNumber"),
      nationalId: open(row, "nationalId"),
      bankAccount: accounts ? ((JSON.parse(accounts) as BankAccount[])[0] ?? null) : null,
      contract: inForce ? { type: inForce.type as "probation", startDate: inForce.startDate, endDate: inForce.terminatedOn ?? inForce.endDate } : null,
    };
  });
}

/**
 * `listPayrollFacts` remembered for the rest of the request (React `cache`): a page whose parts
 * each ask about the same people and month decrypts them once. Readers only — a caller inside a
 * transaction, or one that has just written, calls `listPayrollFacts` itself.
 */
export function payrollFactsOf(personIds: readonly string[], month: string): Promise<PayrollPersonFacts[]> {
  return factsByKey([...new Set(personIds)].sort().join(","), month);
}
const factsByKey = cache((key: string, month: string) => listPayrollFacts({ personIds: key ? key.split(",") : [] }, month));

/** The same for everyone of one entity. */
export const entityPayrollFactsOf = cache((entityId: string, month: string) => listPayrollFacts({ entityIds: [entityId] }, month));

export type PayrollName = { personId: string; fullName: string; employeeCode: string | null; departmentId: string | null };

/**
 * Who the people are, for screens that only put a name beside a figure: the name, the code of the
 * latest employment and the department. One query and nothing decrypted — cheaper than
 * `listPayrollFacts`, which opens every tax code and pay account it reads.
 */
export async function listPayrollNames(personIds: readonly string[], executor: Executor = db()): Promise<PayrollName[]> {
  if (personIds.length === 0) return [];
  const latest = executor.select({ employeeCode: schema.employment.employeeCode }).from(schema.employment).where(eq(schema.employment.personId, schema.person.id)).orderBy(desc(schema.employment.startDate)).limit(1).as("latest");
  return executor
    .select({ personId: schema.person.id, fullName: schema.person.fullName, employeeCode: latest.employeeCode, departmentId: schema.person.departmentId })
    .from(schema.person)
    .leftJoinLateral(latest, sql`true`)
    .where(inArray(schema.person.id, [...new Set(personIds)]));
}

/**
 * Payroll's two entries on a person's timeline: an applied salary change and a move between pay
 * profiles. Never an amount — `details` says only what kind of change it was (the ops tracker
 * reads `salary_change` to open the insurance-adjustment obligation).
 */
export async function recordPayEvent(tx: Tx, event: { type: "salary_change" | "pay_profile_change"; personId: string; employmentId: string; entityId: string; effectiveDate: IsoDate; reason: string | null; details: Record<string, string | null>; approvalRequestId?: string | null }, actorPersonId: string | null) {
  return recordLifecycleEvent(tx, { ...event, status: "applied" }, actorPersonId);
}

/**
 * The PIT family-deduction register as the tax office wants to see it (FR-PAY-35: dependants
 * registration list). One row per dependant with the months it is claimed for, decrypted here
 * because this module owns the cipher contexts. Restricted data: only payroll's statutory exports
 * call it, and only after they have checked compensation access.
 */
export type DependantRegistration = {
  personId: string;
  personName: string;
  employeeCode: string | null;
  personTaxCode: string | null;
  dependantName: string;
  relationship: string;
  dateOfBirth: IsoDate | null;
  idNumber: string | null;
  taxCode: string | null;
  deductionFrom: IsoDate;
  deductionTo: IsoDate | null;
};

export async function listDependantRegistrations(filter: { entityIds?: readonly string[]; personIds?: readonly string[] }, month: string, executor: Executor = db()): Promise<DependantRegistration[]> {
  const facts = await listPayrollFacts(filter, month, executor);
  if (facts.length === 0) return [];
  const ids = facts.map((fact) => fact.personId);
  const rows = await executor.select().from(schema.dependent).where(and(inArray(schema.dependent.personId, ids), isNull(schema.dependent.deletedAt))).orderBy(schema.dependent.deductionFrom);
  if (rows.length === 0) return [];
  const cipher = fieldCipher();
  const factOf = new Map(facts.map((fact) => [fact.personId, fact]));

  return rows.flatMap((row) => {
    const person = factOf.get(row.personId);
    if (!person) return [];
    return [
      {
        personId: row.personId,
        personName: person.fullName,
        employeeCode: person.employeeCode,
        personTaxCode: person.taxCode,
        dependantName: row.fullName,
        relationship: row.relationship,
        dateOfBirth: row.dateOfBirth as IsoDate | null,
        idNumber: row.idNumber ? cipher.decrypt(row.idNumber, dependentContext("idNumber", row.id)) : null,
        taxCode: row.taxCode ? cipher.decrypt(row.taxCode, dependentContext("taxCode", row.id)) : null,
        deductionFrom: row.deductionFrom as IsoDate,
        deductionTo: row.deductionTo as IsoDate | null,
      },
    ];
  });
}
