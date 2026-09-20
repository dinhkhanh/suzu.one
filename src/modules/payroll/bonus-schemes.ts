// The year-end bonus scheme per entity and year (`bonus_scheme`, FR-PAY-21, SRS Q14).
//
// Same governance as the pay policy and the component catalogue (FR-PLT-39, SRS D17): C&B
// proposes a version, the **owner** decides it, and approved versions of one scope never overlap
// (a database exclusion constraint, not a hope). The formula is therefore configuration with a
// history — a bonus paid in January 2028 can still be pointed at the exact version that produced
// it, years later, and nothing in the code decides what a month's salary is worth.
//
// No authorization inside: `bonus-actions.ts` checks `canProposePayRules` / `canDecidePayRules`.
import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval, versionOn } from "@/modules/platform/statutory/engine/versions";
import { type BonusSchemeValue, bonusSchemeSchema } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type BonusSchemeRow = typeof schema.bonusScheme.$inferSelect;
export type ResolvedBonusScheme = { id: string; entityId: string | null; validFrom: IsoDate; value: BonusSchemeValue };

/** The day of a bonus year the scheme is read on: its last day, so the year's own version applies. */
export const schemeDateOf = (year: number): IsoDate => `${year}-12-31`;

export async function listBonusSchemeVersions(executor: Executor = db()): Promise<BonusSchemeRow[]> {
  return executor.select().from(schema.bonusScheme).orderBy(asc(schema.bonusScheme.entityId), desc(schema.bonusScheme.validFrom), desc(schema.bonusScheme.createdAt));
}

/**
 * The scheme an entity's bonus follows on `date`: its own approved version, else the group's.
 * A run refuses to be built without one — nobody computes a bonus off a default in code.
 */
export async function getBonusScheme(entityId: string | null, date: IsoDate, executor: Executor = db()): Promise<ResolvedBonusScheme> {
  const approved = await executor.select().from(schema.bonusScheme).where(eq(schema.bonusScheme.status, "approved"));
  const version = versionOn(approved.filter((row) => row.entityId === entityId), date) ?? versionOn(approved.filter((row) => row.entityId === null), date);
  if (!version) throw new ActionError("bonus_scheme_missing");
  return { id: version.id, entityId: version.entityId, validFrom: version.validFrom, value: bonusSchemeSchema.parse(version.value) };
}

/** Is there a scheme at all for this entity and date? What the screens ask before offering a run. */
export async function hasBonusScheme(entityId: string | null, date: IsoDate, executor: Executor = db()): Promise<boolean> {
  return getBonusScheme(entityId, date, executor).then(() => true).catch(() => false);
}

/** The exact version a stored line was computed by — for explaining an amount long afterwards. */
export async function getBonusSchemeVersion(id: string, executor: Executor = db()): Promise<ResolvedBonusScheme> {
  const [row] = await executor.select().from(schema.bonusScheme).where(eq(schema.bonusScheme.id, id)).limit(1);
  if (!row) throw new ActionError("bonus_scheme_missing");
  return { id: row.id, entityId: row.entityId, validFrom: row.validFrom, value: bonusSchemeSchema.parse(row.value) };
}

export function checkBonusSchemeValue(value: unknown): BonusSchemeValue {
  const parsed = bonusSchemeSchema.safeParse(value);
  if (!parsed.success) throw new ActionError("bonus_scheme_invalid", { issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) });
  return parsed.data;
}

export async function proposeBonusScheme(input: { entityId: string | null; value: unknown; validFrom: IsoDate; note: string | null }, actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<BonusSchemeRow> {
  const value = checkBonusSchemeValue(input.value);
  const [created] = await executor.insert(schema.bonusScheme).values({ entityId: input.entityId, value, validFrom: input.validFrom, note: input.note, proposedByPersonId: actorPersonId }).returning();
  await notify({ recipients: await listOwnerPersonIds(), kind: "payroll.rule_proposed", params: { rule: "Quy chế thưởng cuối năm", validFrom: created.validFrom }, link: "/payroll/bonus/scheme" });
  return created;
}

/** The owner's decision. Approving closes the version it succeeds the day before it starts. */
export async function decideBonusScheme(id: string, decision: "approve" | "reject", actorPersonId: string, executor: ReturnType<typeof db> = db()): Promise<{ before: BonusSchemeRow; after: BonusSchemeRow }> {
  return executor.transaction(async (tx) => {
    const table = schema.bonusScheme;
    const [before] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!before || before.status !== "proposed") throw new ActionError("proposal_not_found");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: new Date(), updatedAt: new Date() };
    if (decision === "reject") {
      const [after] = await tx.update(table).set({ status: "rejected", ...decided }).where(eq(table.id, id)).returning();
      return { before, after };
    }
    const approved = await tx.select().from(table).where(and(before.entityId ? eq(table.entityId, before.entityId) : isNull(table.entityId), eq(table.status, "approved"))).for("update");
    const plan = planApproval(approved, before.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`rule_${plan.reason}`);
    if (plan.kind === "succeed") await tx.update(table).set({ validTo: plan.closeOn, updatedAt: new Date() }).where(eq(table.id, plan.closeId));
    const [after] = await tx.update(table).set({ status: "approved", ...decided }).where(eq(table.id, id)).returning();
    return { before, after };
  });
}
