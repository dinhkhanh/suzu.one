// Company pay rules per entity (`payroll_policy`): choices the law leaves open. Same governance
// as the component catalogue — propose, the owner decides, approved versions never overlap.
import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "@/modules/platform/notifications/service";
import { listOwnerPersonIds } from "@/modules/platform/rbac/service";
import { planApproval, versionOn } from "@/modules/platform/statutory/engine/versions";
import { payrollPolicySchema, type PayrollPolicyValue } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type PayrollPolicyRow = typeof schema.payrollPolicy.$inferSelect;
export type ResolvedPayrollPolicy = { id: string; entityId: string | null; validFrom: IsoDate; value: PayrollPolicyValue };

// Every version of every policy lives in the shared cache (src/lib/cache) — a handful of rows that
// change a few times a year; dates are resolved here, so the entry never depends on "today". The
// writes below drop it once committed. Inside a transaction, pass it: rows come from there.
const POLICIES_CACHE = "payroll:policies";
const POLICIES_TTL = 60 * 60;
const readsCache = (executor?: Executor) => !executor || executor === db();

const readVersions = (executor: Executor) => executor.select().from(schema.payrollPolicy).orderBy(asc(schema.payrollPolicy.entityId), desc(schema.payrollPolicy.validFrom), desc(schema.payrollPolicy.createdAt));

export async function listPolicyVersions(executor?: Executor): Promise<PayrollPolicyRow[]> {
  return readsCache(executor) ? cached(POLICIES_CACHE, POLICIES_TTL, () => readVersions(db())) : readVersions(executor!);
}

/** The policy an entity's payroll follows on `date`: its own approved version, else the group's. Payroll never runs without one. */
export async function getPayrollPolicy(entityId: string, date: IsoDate, executor?: Executor): Promise<ResolvedPayrollPolicy> {
  const approved = readsCache(executor) ? (await listPolicyVersions()).filter((row) => row.status === "approved") : await executor!.select().from(schema.payrollPolicy).where(eq(schema.payrollPolicy.status, "approved"));
  const version = versionOn(approved.filter((row) => row.entityId === entityId), date) ?? versionOn(approved.filter((row) => row.entityId === null), date);
  if (!version) throw new ActionError("payroll_policy_missing");
  return { id: version.id, entityId: version.entityId, validFrom: version.validFrom, value: payrollPolicySchema.parse(version.value) };
}

/** The exact policy version a past run used — for recomputing a paid month (FR-PAY-17, 20). */
export async function getPayrollPolicyVersion(id: string, executor?: Executor): Promise<ResolvedPayrollPolicy> {
  // A version never changes its value once written; the cached table answers unless it lacks the id.
  const hit = readsCache(executor) ? (await listPolicyVersions()).find((candidate) => candidate.id === id) : undefined;
  const [row] = hit ? [hit] : await (executor ?? db()).select().from(schema.payrollPolicy).where(eq(schema.payrollPolicy.id, id)).limit(1);
  if (!row) throw new ActionError("payroll_policy_missing");
  return { id: row.id, entityId: row.entityId, validFrom: row.validFrom, value: payrollPolicySchema.parse(row.value) };
}

export function checkPolicyValue(value: unknown): PayrollPolicyValue {
  const parsed = payrollPolicySchema.safeParse(value);
  if (!parsed.success) throw new ActionError("policy_invalid");
  if ((parsed.data.prorationBasis === "fixed_days") !== (parsed.data.fixedDays !== null)) throw new ActionError("policy_fixed_days");
  return parsed.data;
}

export async function proposePolicy(input: { entityId: string | null; value: unknown; validFrom: IsoDate; note: string | null }, actorPersonId: string): Promise<PayrollPolicyRow> {
  const value = checkPolicyValue(input.value);
  const [created] = await db().insert(schema.payrollPolicy).values({ entityId: input.entityId, value, validFrom: input.validFrom, note: input.note, proposedByPersonId: actorPersonId }).returning();
  await invalidate(POLICIES_CACHE);
  await notify({ recipients: await listOwnerPersonIds(), kind: "payroll.rule_proposed", params: { rule: "Chính sách tính lương", validFrom: created.validFrom }, link: "/payroll/policy" });
  return created;
}

export async function decidePolicy(id: string, decision: "approve" | "reject", actorPersonId: string): Promise<{ before: PayrollPolicyRow; after: PayrollPolicyRow }> {
  const result = await db().transaction(async (tx) => {
    const table = schema.payrollPolicy;
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
  await invalidate(POLICIES_CACHE);
  return result;
}
