import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { notify } from "../notifications/service";
import { listOwnerPersonIds } from "../rbac/service";
import { isParameterKey, type ParameterKey, PARAMETERS, type ParameterValue } from "./catalogue";
import { planApproval, versionOn } from "./engine/versions";

export type ParameterRow = typeof schema.statutoryParameter.$inferSelect;

/**
 * The approved value of `key` in force on `date`. Engines never call this: their callers load the
 * parameters for the period and pass them in, so the engines stay pure.
 */
export async function getParameter<Key extends ParameterKey>(key: Key, date: IsoDate): Promise<ParameterValue<Key>> {
  const approved = await db().select().from(schema.statutoryParameter).where(and(eq(schema.statutoryParameter.key, key), eq(schema.statutoryParameter.status, "approved")));
  const version = versionOn(approved, date);
  if (!version) throw new Error(`No approved statutory parameter "${key}" on ${date}`);
  return PARAMETERS[key].parse(version.value) as ParameterValue<Key>;
}

/** Every version of every parameter, newest first within a key. */
export async function listParameterVersions(): Promise<ParameterRow[]> {
  return db().select().from(schema.statutoryParameter).orderBy(asc(schema.statutoryParameter.key), desc(schema.statutoryParameter.validFrom), desc(schema.statutoryParameter.createdAt));
}

export type ProposalInput = { key: string; value: unknown; validFrom: IsoDate; legalReference: string | null; note: string | null };

export async function proposeParameter(input: ProposalInput, actorPersonId: string): Promise<ParameterRow> {
  if (!isParameterKey(input.key)) throw new ActionError("parameter_unknown");
  const parsed = PARAMETERS[input.key].safeParse(input.value);
  if (!parsed.success) throw new ActionError("parameter_value_invalid");
  const [created] = await db()
    .insert(schema.statutoryParameter)
    .values({ key: input.key, value: parsed.data, validFrom: input.validFrom, legalReference: input.legalReference, note: input.note, proposedByPersonId: actorPersonId })
    .returning();
  // Nothing takes effect until an owner decides, so they are told there is something to decide.
  await notify({ recipients: await listOwnerPersonIds(), kind: "system.rule_proposed", params: { parameter: created.key, validFrom: created.validFrom }, link: "/admin/rules" });
  return created;
}

/** The owner's decision on a proposal (FR-PLT-39). Approving ends the version currently in force the day before. */
export async function decideParameter(id: string, decision: "approve" | "reject", actorPersonId: string): Promise<{ before: ParameterRow; after: ParameterRow }> {
  return db().transaction(async (tx) => {
    const table = schema.statutoryParameter;
    const [before] = await tx.select().from(table).where(eq(table.id, id)).limit(1).for("update");
    if (!before || before.status !== "proposed") throw new ActionError("proposal_not_found");
    const decided = { decidedByPersonId: actorPersonId, decidedAt: new Date() };

    if (decision === "reject") {
      const [after] = await tx.update(table).set({ status: "rejected", ...decided }).where(eq(table.id, id)).returning();
      return { before, after };
    }

    const approved = await tx.select().from(table).where(and(eq(table.key, before.key), eq(table.status, "approved"))).for("update");
    const plan = planApproval(approved, before.validFrom);
    if (plan.kind === "rejected") throw new ActionError(`parameter_${plan.reason}`);
    if (plan.kind === "succeed") await tx.update(table).set({ validTo: plan.closeOn }).where(eq(table.id, plan.closeId));
    // The owner's approval is also the confirmation that the value was checked against the law.
    const [after] = await tx.update(table).set({ status: "approved", isVerified: true, ...decided }).where(eq(table.id, id)).returning();
    return { before, after };
  });
}

/** Confirms a seeded value as checked against the source, without changing it. */
export async function verifyParameter(id: string, actorPersonId: string): Promise<{ before: ParameterRow; after: ParameterRow }> {
  const table = schema.statutoryParameter;
  const [before] = await db().select().from(table).where(and(eq(table.id, id), eq(table.status, "approved"), eq(table.isVerified, false))).limit(1);
  if (!before) throw new ActionError("proposal_not_found");
  const [after] = await db().update(table).set({ isVerified: true, decidedByPersonId: actorPersonId, decidedAt: new Date() }).where(eq(table.id, id)).returning();
  return { before, after };
}
