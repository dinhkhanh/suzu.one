// Leave types and their effective-dated policies (FR-LVE-01..03): HR's configuration.
import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import type { PolicyRules } from "./engine/entitlement";

type Executor = Tx | ReturnType<typeof db>;
export type LeaveTypeRow = typeof schema.leaveType.$inferSelect;
export type LeavePolicyRow = typeof schema.leavePolicy.$inferSelect;
export type StaffingRuleRow = typeof schema.teamStaffingRule.$inferSelect;

/** Every type, group-wide ones first. For the administration screens. */
export async function listLeaveTypes(executor: Executor = db()): Promise<(LeaveTypeRow & { entityName: string | null })[]> {
  const rows = await executor
    .select({ type: schema.leaveType, entityName: schema.entity.shortName })
    .from(schema.leaveType)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.leaveType.entityId))
    .orderBy(asc(schema.leaveType.sortOrder), asc(schema.leaveType.code));
  return rows.map((row) => ({ ...row.type, entityName: row.entityName }));
}

/** The types someone in this entity can pick from: the group's, with the entity's own row winning per code. */
export async function leaveTypesFor(entityId: string | null, executor: Executor = db(), options: { includeInactive?: boolean } = {}): Promise<LeaveTypeRow[]> {
  const rows = await executor
    .select()
    .from(schema.leaveType)
    .where(entityId ? or(isNull(schema.leaveType.entityId), eq(schema.leaveType.entityId, entityId)) : isNull(schema.leaveType.entityId))
    .orderBy(asc(schema.leaveType.sortOrder), asc(schema.leaveType.code));
  const byCode = new Map<string, LeaveTypeRow>();
  for (const row of rows) if (!byCode.has(row.code) || row.entityId) byCode.set(row.code, row);
  return [...byCode.values()].filter((row) => options.includeInactive || row.isActive);
}

export async function getLeaveType(id: string, executor: Executor = db()): Promise<LeaveTypeRow | undefined> {
  const [row] = await executor.select().from(schema.leaveType).where(eq(schema.leaveType.id, id)).limit(1);
  return row;
}

export type LeaveTypeInput = Omit<typeof schema.leaveType.$inferInsert, "id" | "createdAt" | "updatedAt"> & { id: string | null };

export async function saveLeaveType(input: LeaveTypeInput): Promise<{ before: LeaveTypeRow | null; after: LeaveTypeRow }> {
  const { id, ...values } = input;
  // Insurance-paid and unpaid leave is not paid by the company; keep the two fields telling one story.
  if (values.isPaid !== (values.payrollTreatment !== "unpaid")) throw new ActionError("leave_type_paid_mismatch");
  try {
    if (!id) {
      const [after] = await db().insert(schema.leaveType).values(values).returning();
      return { before: null, after };
    }
    const [before] = await db().select().from(schema.leaveType).where(eq(schema.leaveType.id, id)).limit(1);
    if (!before) throw new ActionError("leave_type_not_found");
    // A type keeps its owner and its code: ledger rows and requests point at it.
    const [after] = await db().update(schema.leaveType).set({ ...values, entityId: before.entityId, code: before.code, updatedAt: new Date() }).where(eq(schema.leaveType.id, id)).returning();
    return { before, after };
  } catch (error) {
    for (let cause: unknown = error; cause instanceof Error; cause = cause.cause) {
      const details = cause as { constraint_name?: string; constraint?: string };
      if ((details.constraint_name ?? details.constraint) === "leave_type_entity_code_key") throw new ActionError("leave_type_code_taken");
    }
    throw error;
  }
}

export const policyRules = (row: LeavePolicyRow): PolicyRules => ({
  accrualMethod: row.accrualMethod,
  baseSource: row.baseSource,
  fixedDaysCenti: row.fixedDaysCenti,
  extraDaysCenti: row.extraDaysCenti,
  seniorityBonus: row.seniorityBonus,
  prorate: row.prorate,
  rounding: row.rounding,
  probationRule: row.probationRule,
  carryOverCapCenti: row.carryOverCapCenti,
  carryOverExpiry: row.carryOverExpiry,
  payoutOnTermination: row.payoutOnTermination,
  allowNegativeCenti: row.allowNegativeCenti,
});

/** The version in force on a date, from rows already loaded: the entity's own policy before the group's. */
export function policyOn(policies: readonly LeavePolicyRow[], leaveTypeId: string, entityId: string | null, date: IsoDate): LeavePolicyRow | null {
  const inForce = policies.filter((row) => row.leaveTypeId === leaveTypeId && row.validFrom <= date && (row.validTo === null || date <= row.validTo));
  return inForce.find((row) => entityId !== null && row.entityId === entityId) ?? inForce.find((row) => row.entityId === null) ?? null;
}

export async function listPolicies(leaveTypeIds?: readonly string[], executor: Executor = db()): Promise<LeavePolicyRow[]> {
  if (leaveTypeIds?.length === 0) return [];
  return executor.select().from(schema.leavePolicy).where(leaveTypeIds ? inArray(schema.leavePolicy.leaveTypeId, [...leaveTypeIds]) : undefined).orderBy(asc(schema.leavePolicy.leaveTypeId), desc(schema.leavePolicy.validFrom));
}

export type LeavePolicyInput = Omit<typeof schema.leavePolicy.$inferInsert, "id" | "createdAt" | "validTo" | "createdByPersonId">;

/**
 * A new version of a policy from `validFrom` on. The version in force until then ends the day
 * before; history is never rewritten, except that a version can be corrected on its own start date.
 */
export async function saveLeavePolicy(input: LeavePolicyInput, actorPersonId: string): Promise<{ before: LeavePolicyRow | null; after: LeavePolicyRow }> {
  if (input.carryOverExpiry && !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(input.carryOverExpiry)) throw new ActionError("leave_policy_expiry_invalid");
  return db().transaction(async (tx) => {
    const table = schema.leavePolicy;
    const sameScope = and(eq(table.leaveTypeId, input.leaveTypeId), input.entityId ? eq(table.entityId, input.entityId) : isNull(table.entityId));
    const [later] = await tx.select({ id: table.id }).from(table).where(and(sameScope, gt(table.validFrom, input.validFrom))).limit(1);
    if (later) throw new ActionError("leave_policy_later_version");
    const [current] = await tx.select().from(table).where(and(sameScope, isNull(table.validTo))).limit(1).for("update");
    if (current && current.validFrom === input.validFrom) {
      const [after] = await tx.update(table).set(input).where(eq(table.id, current.id)).returning();
      return { before: current, after };
    }
    if (current) await tx.update(table).set({ validTo: addDays(input.validFrom, -1) }).where(eq(table.id, current.id));
    const [after] = await tx.insert(table).values({ ...input, createdByPersonId: actorPersonId }).returning();
    return { before: current ?? null, after };
  });
}

// ── Minimum staffing ────────────────────────────────────────────────────────────────────────

export async function listStaffingRules(executor: Executor = db()) {
  return executor
    .select({ rule: schema.teamStaffingRule, entityName: schema.entity.shortName, departmentName: schema.department.name, teamName: schema.team.name })
    .from(schema.teamStaffingRule)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.teamStaffingRule.entityId))
    .leftJoin(schema.department, eq(schema.department.id, schema.teamStaffingRule.departmentId))
    .leftJoin(schema.team, eq(schema.team.id, schema.teamStaffingRule.teamId));
}

export async function getStaffingRule(id: string): Promise<StaffingRuleRow | undefined> {
  const [row] = await db().select().from(schema.teamStaffingRule).where(eq(schema.teamStaffingRule.id, id)).limit(1);
  return row;
}

export async function saveStaffingRule(input: { entityId: string | null; departmentId: string | null; teamId: string | null; minPresent: number }): Promise<StaffingRuleRow> {
  if (!input.departmentId && !input.teamId) throw new ActionError("leave_staffing_scope_required");
  const [row] = await db()
    .insert(schema.teamStaffingRule)
    .values(input)
    .onConflictDoUpdate({ target: [schema.teamStaffingRule.entityId, schema.teamStaffingRule.departmentId, schema.teamStaffingRule.teamId], set: { minPresent: input.minPresent, updatedAt: new Date() } })
    .returning();
  return row;
}

export async function deleteStaffingRule(id: string): Promise<StaffingRuleRow> {
  const [row] = await db().delete(schema.teamStaffingRule).where(eq(schema.teamStaffingRule.id, id)).returning();
  if (!row) throw new ActionError("leave_staffing_not_found");
  return row;
}

/** The rule that applies to a person's group: their team's, else their department's within the entity, else the department's everywhere. */
export function staffingRuleFor(rules: readonly StaffingRuleRow[], person: { entityId: string | null; departmentId: string | null; teamId: string | null }): StaffingRuleRow | null {
  if (person.teamId) {
    const team = rules.find((rule) => rule.teamId === person.teamId);
    if (team) return team;
  }
  if (!person.departmentId) return null;
  const ofDepartment = rules.filter((rule) => rule.teamId === null && rule.departmentId === person.departmentId);
  return ofDepartment.find((rule) => rule.entityId !== null && rule.entityId === person.entityId) ?? ofDepartment.find((rule) => rule.entityId === null) ?? null;
}
