// The entity's attendance policy (FR-ATT-08, 13 in part): company practice the timesheet engine
// follows — merge rule, grace, rounding, overtime thresholds, the correction cap. Effective-dated;
// an entity's own version wins over the group's default. Nothing legal lives here.
import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { minutesOf } from "./engine/calendar";
import type { TimesheetPolicy } from "./engine/timesheet";

type Executor = Tx | ReturnType<typeof db>;
export type AttendancePolicyRow = typeof schema.attendancePolicy.$inferSelect;

/** What the engine assumes when nobody has configured anything: count to the minute, forgive nothing, approve all overtime. */
const UNCONFIGURED: Omit<AttendancePolicyRow, "id" | "entityId" | "validFrom" | "validTo" | "createdByPersonId" | "createdAt"> = {
  mergeRule: "first_in_last_out", graceLateMinutes: 0, graceEarlyMinutes: 0, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: null,
};

export type ResolvedPolicy = TimesheetPolicy & { dayBoundary: number; monthlyCorrectionCap: number | null; policyId: string | null };

/** The version in force for an entity on a date: the entity's own, else the group's, else the unconfigured defaults. Pure. */
export function policyOn(rows: readonly AttendancePolicyRow[], entityId: string | null, date: IsoDate): ResolvedPolicy {
  const inForce = rows.filter((row) => row.validFrom <= date && (row.validTo === null || row.validTo >= date));
  const row = inForce.find((candidate) => entityId !== null && candidate.entityId === entityId) ?? inForce.find((candidate) => candidate.entityId === null) ?? null;
  const source = row ?? UNCONFIGURED;
  return {
    policyId: row?.id ?? null,
    mergeRule: source.mergeRule,
    graceLateMinutes: source.graceLateMinutes,
    graceEarlyMinutes: source.graceEarlyMinutes,
    roundingMinutes: source.roundingMinutes,
    otMinMinutes: source.otMinMinutes,
    otRequiresApproval: source.otRequiresApproval,
    duplicateWindowMinutes: source.duplicateWindowMinutes,
    breakStart: minutesOf(source.breakStart),
    dayBoundary: minutesOf(source.dayBoundary),
    monthlyCorrectionCap: source.monthlyCorrectionCap,
  };
}

export async function loadPolicies(executor: Executor = db()): Promise<AttendancePolicyRow[]> {
  return executor.select().from(schema.attendancePolicy);
}

/** For week 5's correction cap and anyone else who needs one entity's rules on one day. */
export async function getAttendancePolicy(entityId: string | null, date: IsoDate, executor: Executor = db()): Promise<ResolvedPolicy> {
  return policyOn(await loadPolicies(executor), entityId, date);
}

export async function listPolicies(): Promise<(AttendancePolicyRow & { entityName: string | null })[]> {
  const rows = await db().select({ policy: schema.attendancePolicy, entityName: schema.entity.shortName }).from(schema.attendancePolicy).leftJoin(schema.entity, eq(schema.entity.id, schema.attendancePolicy.entityId)).orderBy(asc(schema.entity.shortName), desc(schema.attendancePolicy.validFrom));
  return rows.map((row) => ({ ...row.policy, entityName: row.entityName }));
}

export type PolicyInput = Omit<AttendancePolicyRow, "id" | "validTo" | "createdByPersonId" | "createdAt">;

/** A new version from `validFrom`: the open version before it is closed the day before. History is never rewritten. */
export async function savePolicy(input: PolicyInput, actorPersonId: string): Promise<{ before: AttendancePolicyRow | null; after: AttendancePolicyRow; affectedFrom: IsoDate }> {
  if (input.roundingMinutes < 0 || input.roundingMinutes > 60 || input.graceLateMinutes < 0 || input.graceEarlyMinutes < 0 || input.otMinMinutes < 0 || input.duplicateWindowMinutes < 0) throw new ActionError("attendance_policy_invalid");
  return db().transaction(async (tx) => {
    const scope = input.entityId ? eq(schema.attendancePolicy.entityId, input.entityId) : isNull(schema.attendancePolicy.entityId);
    const [open] = await tx.select().from(schema.attendancePolicy).where(and(scope, isNull(schema.attendancePolicy.validTo))).orderBy(desc(schema.attendancePolicy.validFrom)).limit(1).for("update");
    if (open && open.validFrom >= input.validFrom) {
      // Same start date = a correction of that version; an earlier one would rewrite history.
      if (open.validFrom > input.validFrom) throw new ActionError("attendance_policy_before_current");
      const [after] = await tx.update(schema.attendancePolicy).set({ ...input }).where(eq(schema.attendancePolicy.id, open.id)).returning();
      return { before: open, after, affectedFrom: input.validFrom };
    }
    if (open) await tx.update(schema.attendancePolicy).set({ validTo: addDays(input.validFrom, -1) }).where(eq(schema.attendancePolicy.id, open.id));
    const [after] = await tx.insert(schema.attendancePolicy).values({ ...input, createdByPersonId: actorPersonId }).returning();
    return { before: open ?? null, after, affectedFrom: input.validFrom };
  });
}
