// How the final yearly result is combined (FR-PRF-09), as **effective-dated configuration**.
//
// Same governance as a pay policy (FR-PLT-39, `payroll/policies.ts`): HR proposes a version from a
// date, the owner decides it, approved versions never overlap, and history is never rewritten.
// The weights, the OKR mix and the bands are therefore never constants in code — SRS Q14 leaves
// the first version of the numbers to the company, and this is where they live.
//
// A year reads the version in force **on 31 December of that year**: the result is the year's, so
// it is combined by the rules that were in force when the year ended, whatever is approved later.
//
// No authorization inside; `result-actions.ts` checks first.
import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval, versionOn } from "@/modules/platform/statutory/engine/versions";
import { performanceWeightingSchema, type PerformanceWeightingValue } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type PerformanceWeightingRow = typeof schema.performanceWeighting.$inferSelect;
export type ResolvedWeighting = { id: string; entityId: string | null; validFrom: IsoDate; value: PerformanceWeightingValue };

/** The last day of a year — the date a year's result is weighted as of. */
export const weightingDateOf = (year: number): IsoDate => `${year}-12-31`;

export async function listWeightingVersions(executor: Executor = db()): Promise<PerformanceWeightingRow[]> {
  return executor.select().from(schema.performanceWeighting).orderBy(asc(schema.performanceWeighting.entityId), desc(schema.performanceWeighting.validFrom), desc(schema.performanceWeighting.createdAt));
}

/**
 * The weighting an entity's results follow on `date`: its own approved version, else the group's.
 * Throws when there is none — a result is never computed by a rule nobody approved.
 */
export async function getWeighting(entityId: string | null, date: IsoDate, executor: Executor = db()): Promise<ResolvedWeighting> {
  const approved = await executor.select().from(schema.performanceWeighting).where(eq(schema.performanceWeighting.status, "approved"));
  const version = (entityId ? versionOn(approved.filter((row) => row.entityId === entityId), date) : undefined) ?? versionOn(approved.filter((row) => row.entityId === null), date);
  if (!version) throw new ActionError("weighting_missing");
  return { id: version.id, entityId: version.entityId, validFrom: version.validFrom, value: performanceWeightingSchema.parse(version.value) };
}

/** The exact version a stored result used — for reading a locked figure back years later. */
export async function getWeightingVersion(id: string, executor: Executor = db()): Promise<ResolvedWeighting> {
  const [row] = await executor.select().from(schema.performanceWeighting).where(eq(schema.performanceWeighting.id, id)).limit(1);
  if (!row) throw new ActionError("weighting_missing");
  return { id: row.id, entityId: row.entityId, validFrom: row.validFrom, value: performanceWeightingSchema.parse(row.value) };
}

/** Is there a weighting at all for this year? Screens ask before offering to compute. */
export async function hasWeighting(entityId: string | null, year: number, executor: Executor = db()): Promise<boolean> {
  try {
    await getWeighting(entityId, weightingDateOf(year), executor);
    return true;
  } catch {
    return false;
  }
}

export function checkWeightingValue(value: unknown): PerformanceWeightingValue {
  const parsed = performanceWeightingSchema.safeParse(value);
  if (!parsed.success) throw new ActionError(`weighting_${parsed.error.issues[0]?.message ?? "invalid"}`);
  return parsed.data;
}

export async function proposeWeighting(input: { entityId: string | null; value: unknown; validFrom: IsoDate; note: string | null }, actorPersonId: string, executor: Executor = db()): Promise<PerformanceWeightingRow> {
  const value = checkWeightingValue(input.value);
  const [created] = await executor.insert(schema.performanceWeighting).values({ entityId: input.entityId, value, validFrom: input.validFrom, note: input.note, proposedByPersonId: actorPersonId }).returning();
  await notify({ recipients: await listOwnerPersonIds(), kind: "performance.rule_proposed", params: { validFrom: created.validFrom }, link: "/performance/admin/weighting" });
  return created;
}

/** The owner's decision. Approving closes the version it succeeds the day before it starts. */
export async function decideWeighting(id: string, decision: "approve" | "reject", actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: PerformanceWeightingRow; after: PerformanceWeightingRow }> {
  return executor.transaction(async (tx) => {
    const table = schema.performanceWeighting;
    const [before] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!before || before.status !== "proposed") throw new ActionError("weighting_proposal_not_found");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() };
    if (decision === "reject") {
      const [after] = await tx.update(table).set({ status: "rejected", ...decided }).where(eq(table.id, id)).returning();
      return { before, after };
    }
    const approved = await tx.select().from(table).where(and(before.entityId ? eq(table.entityId, before.entityId) : isNull(table.entityId), eq(table.status, "approved"))).for("update");
    const plan = planApproval(approved, before.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`weighting_${plan.reason}`);
    if (plan.kind === "succeed") await tx.update(table).set({ validTo: plan.closeOn, updatedAt: new Date() }).where(eq(table.id, plan.closeId));
    const [after] = await tx.update(table).set({ status: "approved", ...decided }).where(eq(table.id, id)).returning();
    return { before, after };
  });
}
