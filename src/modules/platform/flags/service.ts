import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { type FlagKey, FLAGS, type FlagSubject, isEnabled, OFF, type Rollout } from "./flags";

export type FlagRow = typeof schema.featureFlag.$inferSelect;

// Once per request: every check on a page shares one query.
const loadRollouts = cache(async (): Promise<Map<string, FlagRow>> => new Map((await db().select().from(schema.featureFlag)).map((row) => [row.key, row])));

export async function featureEnabled(key: FlagKey, person: { id: string; primaryEntityId: string | null; departmentId: string | null }): Promise<boolean> {
  const subject: FlagSubject = { personId: person.id, entityId: person.primaryEntityId, departmentId: person.departmentId };
  return isEnabled((await loadRollouts()).get(key), subject);
}

export async function listRollouts(): Promise<{ key: FlagKey; rollout: Rollout }[]> {
  const rows = await loadRollouts();
  return FLAGS.map((key) => ({ key, rollout: rows.get(key) ?? OFF }));
}

export async function setRollout(key: string, rollout: Rollout, actorPersonId: string): Promise<{ before: Rollout; after: FlagRow }> {
  if (!(FLAGS as readonly string[]).includes(key)) throw new ActionError("flag_unknown");
  const [existing] = await db().select().from(schema.featureFlag).where(eq(schema.featureFlag.key, key)).limit(1);
  const values = { enabledForAll: rollout.enabledForAll, entityIds: [...rollout.entityIds], departmentIds: [...rollout.departmentIds], personIds: [...rollout.personIds], updatedAt: new Date(), updatedByPersonId: actorPersonId };
  const [after] = await db().insert(schema.featureFlag).values({ key, ...values }).onConflictDoUpdate({ target: schema.featureFlag.key, set: values }).returning();
  return { before: existing ?? OFF, after };
}
