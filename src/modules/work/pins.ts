// Visual feedback (FR-PJM-52): comments pinned to a point of an image, or a moment of a video, of one
// deliverable version. The picture itself comes through the files module's one-minute links, made
// when the viewer opens it; a pin stores only where it sits and what it says.
import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { mediaKindOf, pinProblem } from "./engine/delivery";
import { notifyFollowers } from "./followers";
import { findDeliverable } from "./reviews";
import { type LoadedTask, loadTask, logActivity } from "./tasks";

export type PinRow = typeof schema.workDeliverablePin.$inferSelect;
export type PinView = Pick<PinRow, "id" | "deliverableId" | "x" | "y" | "timecodeMs" | "body" | "authorPersonId" | "resolvedAt" | "createdAt"> & { authorName: string | null };

/** The version with its task and what kind of picture it is (null = a link, or a file that is not an image or a video). */
export async function deliverableMedia(deliverableId: string): Promise<{ deliverable: NonNullable<Awaited<ReturnType<typeof findDeliverable>>>; loaded: LoadedTask; media: ReturnType<typeof mediaKindOf> } | undefined> {
  const deliverable = await findDeliverable(deliverableId);
  if (!deliverable) return undefined;
  const loaded = await loadTask(deliverable.taskId);
  if (!loaded) return undefined;
  const [file] = deliverable.fileId ? await db().select({ contentType: schema.storedFile.contentType }).from(schema.storedFile).where(and(eq(schema.storedFile.id, deliverable.fileId), isNull(schema.storedFile.deletedAt))).limit(1) : [];
  return { deliverable, loaded, media: mediaKindOf(file?.contentType) };
}

export async function addPin(deliverableId: string, input: { x: number | null; y: number | null; timecodeMs: number | null; body: string }, actor: { personId: string; fullName: string }): Promise<{ pin: PinRow; loaded: LoadedTask }> {
  const found = await deliverableMedia(deliverableId);
  if (!found) throw new ActionError("deliverable_not_found");
  const problem = pinProblem(input, found.media);
  if (problem) throw new ActionError(problem);
  return db().transaction(async (tx) => {
    const [pin] = await tx.insert(schema.workDeliverablePin).values({ deliverableId, x: input.x, y: input.y, timecodeMs: input.timecodeMs, body: input.body, authorPersonId: actor.personId }).returning();
    await logActivity(tx, found.loaded.task.id, actor.personId, [{ type: "pin_added", to: { version: found.deliverable.version, name: input.body.slice(0, 80) } }]);
    await tx.update(schema.task).set({ updatedAt: new Date() }).where(eq(schema.task.id, found.loaded.task.id));
    // Feedback on the work reaches the people on it like a comment does.
    await notifyFollowers(tx, found.loaded, actor.personId, "tasks.commented", { name: actor.fullName, excerpt: `📍 v${found.deliverable.version}: ${input.body.slice(0, 120)}` });
    return { pin, loaded: found.loaded };
  });
}

export async function findPin(pinId: string): Promise<{ pin: PinRow; loaded: LoadedTask } | undefined> {
  const [pin] = await db().select().from(schema.workDeliverablePin).where(eq(schema.workDeliverablePin.id, pinId)).limit(1);
  if (!pin) return undefined;
  const deliverable = await findDeliverable(pin.deliverableId);
  const loaded = deliverable ? await loadTask(deliverable.taskId) : undefined;
  return loaded ? { pin, loaded } : undefined;
}

/** Resolved, or open again. */
export async function setPinResolved(pinId: string, resolved: boolean, actorPersonId: string): Promise<PinRow> {
  const [pin] = await db()
    .update(schema.workDeliverablePin)
    .set(resolved ? { resolvedAt: new Date(), resolvedByPersonId: actorPersonId } : { resolvedAt: null, resolvedByPersonId: null })
    .where(eq(schema.workDeliverablePin.id, pinId))
    .returning();
  if (!pin) throw new ActionError("pin_not_found");
  return pin;
}

/** Every pin on a task's versions, oldest first — the screen groups them by version. */
export async function listTaskPins(taskId: string): Promise<PinView[]> {
  const versions = await db().select({ id: schema.workDeliverable.id }).from(schema.workDeliverable).where(eq(schema.workDeliverable.taskId, taskId));
  if (versions.length === 0) return [];
  return db()
    .select({ id: schema.workDeliverablePin.id, deliverableId: schema.workDeliverablePin.deliverableId, x: schema.workDeliverablePin.x, y: schema.workDeliverablePin.y, timecodeMs: schema.workDeliverablePin.timecodeMs, body: schema.workDeliverablePin.body, authorPersonId: schema.workDeliverablePin.authorPersonId, resolvedAt: schema.workDeliverablePin.resolvedAt, createdAt: schema.workDeliverablePin.createdAt, authorName: schema.person.fullName })
    .from(schema.workDeliverablePin)
    .leftJoin(schema.person, eq(schema.person.id, schema.workDeliverablePin.authorPersonId))
    .where(
      inArray(
        schema.workDeliverablePin.deliverableId,
        versions.map((version) => version.id),
      ),
    )
    .orderBy(asc(schema.workDeliverablePin.createdAt));
}
