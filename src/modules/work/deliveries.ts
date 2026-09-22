// Delivery records (FR-PJM-53): what went to the client — which version, when, by whom, to whom,
// with the final files or Drive links. The deliverables register reads `deliveryFactsByTask`
// (delivery-facts.ts) to mark its lines delivered.
import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { notifyFollowers } from "./followers";
import { type LoadedTask, loadTask, logActivity } from "./tasks";

export type DeliveryRow = typeof schema.workDelivery.$inferSelect;
export type DeliveryInput = { deliverableId: string | null; deliveredOn: string; recipient: string | null; links: string[]; note: string | null; /** The version is not approved: the person saw the warning and delivers anyway. */ confirmUnapproved: boolean };

/**
 * The version delivered should be the approved one, better still the one the client approved
 * (frozen). Another version is refused until the person confirms — a rough cut sent on purpose is
 * their call, sent by mistake it is a dispute later.
 */
export async function recordDelivery(taskId: string, input: DeliveryInput, actor: { personId: string; fullName: string }): Promise<{ delivery: DeliveryRow; loaded: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await loadTask(taskId, tx);
    if (!loaded) throw new ActionError("task_not_found");
    if (input.links.length === 0 && !input.deliverableId) throw new ActionError("delivery_needs_content");
    let version: number | null = null;
    if (input.deliverableId) {
      const [deliverable] = await tx.select().from(schema.workDeliverable).where(and(eq(schema.workDeliverable.id, input.deliverableId), eq(schema.workDeliverable.taskId, taskId))).limit(1);
      if (!deliverable) throw new ActionError("deliverable_not_found");
      if (deliverable.decision !== "approved" && !deliverable.frozenAt && !input.confirmUnapproved) throw new ActionError("delivery_version_unapproved", { version: deliverable.version });
      version = deliverable.version;
    }
    const [delivery] = await tx.insert(schema.workDelivery).values({ taskId, deliverableId: input.deliverableId, deliveredOn: input.deliveredOn, deliveredByPersonId: actor.personId, recipient: input.recipient, links: input.links, note: input.note }).returning();
    await logActivity(tx, taskId, actor.personId, [{ type: "delivery_recorded", to: { name: input.recipient ?? (version ? `v${version}` : input.links[0]), version, deliveredOn: input.deliveredOn } }]);
    await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, taskId));
    await notifyFollowers(tx, loaded, actor.personId, "tasks.commented", { name: actor.fullName, excerpt: `📦 ${input.recipient ?? ""} ${input.deliveredOn.split("-").reverse().join("/")}`.trim() });
    return { delivery, loaded };
  });
}

export async function findDelivery(deliveryId: string): Promise<{ delivery: DeliveryRow; loaded: LoadedTask } | undefined> {
  const [delivery] = await db().select().from(schema.workDelivery).where(eq(schema.workDelivery.id, deliveryId)).limit(1);
  const loaded = delivery ? await loadTask(delivery.taskId) : undefined;
  return delivery && loaded ? { delivery, loaded } : undefined;
}

/** A record made by mistake. The task's history keeps that it was there. */
export async function removeDelivery(deliveryId: string, actorPersonId: string): Promise<DeliveryRow> {
  return db().transaction(async (tx) => {
    const [delivery] = await tx.delete(schema.workDelivery).where(eq(schema.workDelivery.id, deliveryId)).returning();
    if (!delivery) throw new ActionError("delivery_not_found");
    await logActivity(tx, delivery.taskId, actorPersonId, [{ type: "delivery_removed", from: { name: delivery.recipient ?? delivery.deliveredOn } }]);
    return delivery;
  });
}

export type DeliveryView = DeliveryRow & { version: number | null; deliveredByName: string | null };

/**
 * Deliveries of these tasks, newest first. No authorization inside: the caller holds task ids it
 * may already read (the task page, the projects register).
 */
export async function listDeliveriesByTask(taskIds: readonly string[]): Promise<DeliveryView[]> {
  const ids = [...new Set(taskIds)];
  if (ids.length === 0) return [];
  const rows = await db()
    .select({ delivery: schema.workDelivery, version: schema.workDeliverable.version, deliveredByName: schema.person.fullName })
    .from(schema.workDelivery)
    .leftJoin(schema.workDeliverable, eq(schema.workDeliverable.id, schema.workDelivery.deliverableId))
    .leftJoin(schema.person, eq(schema.person.id, schema.workDelivery.deliveredByPersonId))
    .where(inArray(schema.workDelivery.taskId, ids))
    .orderBy(desc(schema.workDelivery.deliveredOn), desc(schema.workDelivery.createdAt));
  return rows.map(({ delivery, version, deliveredByName }) => ({ ...delivery, version, deliveredByName }));
}
