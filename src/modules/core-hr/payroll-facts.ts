// What payroll (Phase 5) needs to know about people, in one read per run. Re-exported by
// service.ts. **No authorization inside**: the callers are payroll use-cases that have already
// checked compensation access — this file hands out restricted data (tax code, pay account), so
// nothing else may call it, and what it returns must never be logged or put into an audit row.
import "server-only";
import { and, desc, inArray, isNull } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { countDependentsInMonth } from "./engine/dependents";
import { type EmploymentFacts, listEmploymentFacts } from "./employment-facts";
import { sensitiveContext } from "./field-contexts";
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
  const facts = await listEmploymentFacts(filter, executor);
  if (facts.length === 0) return [];
  const ids = facts.map((fact) => fact.personId);
  const { last } = monthBounds(month);
  const [dependents, sensitive, contracts] = await Promise.all([
    executor.select({ personId: schema.dependent.personId, deductionFrom: schema.dependent.deductionFrom, deductionTo: schema.dependent.deductionTo }).from(schema.dependent).where(and(inArray(schema.dependent.personId, ids), isNull(schema.dependent.deletedAt))),
    executor.select().from(schema.personSensitive).where(inArray(schema.personSensitive.personId, ids)),
    executor.select().from(schema.contract).where(and(inArray(schema.contract.personId, ids), isNull(schema.contract.deletedAt), inArray(schema.contract.type, ["probation", "fixed_term", "indefinite", "service", "internship"]))).orderBy(desc(schema.contract.startDate)),
  ]);
  const cipher = sensitive.some((row) => row.taxCode || row.bankAccounts || row.socialInsuranceNumber) ? fieldCipher() : null;
  const open = (row: (typeof sensitive)[number] | undefined, field: "taxCode" | "socialInsuranceNumber" | "bankAccounts") => (row?.[field] && cipher ? cipher.decrypt(row[field], sensitiveContext(field, row.personId)) : null);

  return facts.map((fact) => {
    const row = sensitive.find((candidate) => candidate.personId === fact.personId);
    const accounts = open(row, "bankAccounts");
    const mine = contracts.filter((contract) => contract.personId === fact.personId && contract.startDate <= last);
    const inForce = mine.find((contract) => (contract.terminatedOn ?? contract.endDate ?? "9999-12-31") >= last) ?? mine[0] ?? null;
    const taxCode = open(row, "taxCode");
    return {
      ...fact,
      dependents: countDependentsInMonth(dependents.filter((dependent) => dependent.personId === fact.personId), month),
      taxCode,
      hasTaxCode: !!taxCode,
      socialInsuranceNumber: open(row, "socialInsuranceNumber"),
      bankAccount: accounts ? ((JSON.parse(accounts) as BankAccount[])[0] ?? null) : null,
      contract: inForce ? { type: inForce.type as "probation", startDate: inForce.startDate, endDate: inForce.terminatedOn ?? inForce.endDate } : null,
    };
  });
}

/**
 * Payroll's two entries on a person's timeline: an applied salary change and a move between pay
 * profiles. Never an amount — `details` says only what kind of change it was (the ops tracker
 * reads `salary_change` to open the insurance-adjustment obligation).
 */
export async function recordPayEvent(tx: Tx, event: { type: "salary_change" | "pay_profile_change"; personId: string; employmentId: string; entityId: string; effectiveDate: IsoDate; reason: string | null; details: Record<string, string | null>; approvalRequestId?: string | null }, actorPersonId: string | null) {
  return recordLifecycleEvent(tx, { ...event, status: "applied" }, actorPersonId);
}
