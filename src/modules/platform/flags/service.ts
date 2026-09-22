import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema } from "@/lib/db";
import { type FlagKey, FLAGS, type FlagSubject, isEnabled, OFF, type Rollout } from "./flags";

export type FlagRow = typeof schema.featureFlag.$inferSelect;

// The whole (tiny) table sits in the shared cache; `setRollout`, its only writer, drops the entry.
// Once per request on top of that: every check on a page shares one read.
const FLAGS_CACHE = "flags:rollouts";
const FLAGS_TTL = 60 * 60;
const loadRollouts = cache(async (): Promise<Map<string, FlagRow>> => new Map((await cached(FLAGS_CACHE, FLAGS_TTL, () => db().select().from(schema.featureFlag))).map((row) => [row.key, row])));

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
  await invalidate(FLAGS_CACHE);
  return { before: existing ?? OFF, after };
}
