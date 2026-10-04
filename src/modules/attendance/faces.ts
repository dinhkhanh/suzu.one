// Faces for the kiosk (FR-ATT-06): who may be recognised, the consent behind it, and the matching.
//
// Biometric data — sensitive personal data under Law 91/2025 — so nothing here is cached, and
// nothing here is a picture: the browser that took the photo turned it into 128 numbers
// (`engine/face.ts`) and those are all that arrive. Matching is pgvector's cosine distance, best
// template per person, in SQL. Only people who are working today, in an entity the kiosk's clock
// serves, are ever compared; an offboarded person's face data is deleted (`purgeFacesOfLeavers`).
import "server-only";
import { and, count, desc, eq, inArray, max, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { purgeEndpointHits } from "./endpoint-limit";
import { cosine, decideMatch, FACE_MODEL, isEmbedding, MATCH, normalise } from "./engine/face";
import { ENDPOINT_HIT_RETENTION_DAYS } from "./engine/rate-limit";
import { closeLapsedKioskSessions } from "./kiosk";

type Executor = Tx | ReturnType<typeof db>;

/** Most templates kept per person: a few angles and lights. Older ones make room for newer. */
export const MAX_TEMPLATES = 10;

const vectorLiteral = (vector: readonly number[]) => sql`${`[${vector.join(",")}]`}::extensions.vector`;
const similarityTo = (vector: readonly number[]) => sql<number>`(1 - (${schema.faceTemplate.embedding} OPERATOR(extensions.<=>) ${vectorLiteral(vector)}))::float8`;

export type Recognised = { personId: string; name: string; entityId: string | null; score: number };

/**
 * Whose face this is among the people the kiosk may know: active, in one of `entityIds`. The two
 * best people come back from SQL (each by their best template), and `decideMatch` names one only
 * when the best clears the line and leads the runner-up.
 */
export async function recogniseFace(embedding: readonly number[], entityIds: readonly string[], executor: Executor = db()): Promise<Recognised | null> {
  if (!isEmbedding([...embedding]) || entityIds.length === 0) return null;
  const score = max(similarityTo(normalise(embedding)));
  const ranked = await executor
    .select({ personId: schema.faceTemplate.personId, name: schema.person.fullName, entityId: schema.person.primaryEntityId, score: sql<number>`${score}::float8` })
    .from(schema.faceTemplate)
    .innerJoin(schema.person, eq(schema.person.id, schema.faceTemplate.personId))
    .where(and(eq(schema.faceTemplate.model, FACE_MODEL), eq(schema.person.status, "active"), inArray(schema.person.primaryEntityId, [...entityIds])))
    .groupBy(schema.faceTemplate.personId, schema.person.fullName, schema.person.primaryEntityId)
    .orderBy(desc(score))
    .limit(2);
  const [best, runnerUp] = ranked.map((row) => ({ ...row, score: Number(row.score) }));
  const decided = decideMatch(best ?? null, runnerUp ?? null);
  return decided && best ? best : null;
}

export type EnrolmentInput = { personId: string; entityId: string | null; embeddings: readonly (readonly number[])[]; consent: boolean; actorPersonId: string };

/**
 * Adds face templates for a person. Their consent must be on record, or recorded now. Refused,
 * all of it, when the photos are not of one face, or when any of them is too like somebody else
 * already enrolled — that would let one punch for the other. Keeps the newest `MAX_TEMPLATES`.
 */
export async function enrolFaces(input: EnrolmentInput): Promise<{ added: number; total: number; consentRecorded: boolean }> {
  const embeddings = input.embeddings.map((vector) => normalise(vector));
  if (embeddings.length === 0 || !embeddings.every(isEmbedding)) throw new ActionError("invalid");
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(schema.faceEnrolment).where(eq(schema.faceEnrolment.personId, input.personId)).limit(1);
    if (!existing && !input.consent) throw new ActionError("face_consent_required");

    // One face, not a mix: each photo must look like the person's existing templates and the others in the batch.
    const own = (await tx.select({ embedding: schema.faceTemplate.embedding }).from(schema.faceTemplate).where(and(eq(schema.faceTemplate.personId, input.personId), eq(schema.faceTemplate.model, FACE_MODEL)))).map((row) => row.embedding);
    const all = [...own, ...embeddings];
    if (embeddings.some((vector) => all.some((other) => other !== vector && cosine(vector, other) < MATCH.keepThreshold))) throw new ActionError("face_photos_differ");

    // The closest anybody else comes to any of the new photos, in one pass over the templates.
    const closest = embeddings.length === 1 ? similarityTo(embeddings[0]) : sql<number>`greatest(${sql.join(embeddings.map(similarityTo), sql`, `)})`;
    const [nearest] = await tx
      .select({ score: max(closest) })
      .from(schema.faceTemplate)
      .where(and(eq(schema.faceTemplate.model, FACE_MODEL), sql`${schema.faceTemplate.personId} <> ${input.personId}`));
    if (nearest?.score !== null && nearest?.score !== undefined && Number(nearest.score) >= MATCH.enrolConflict) throw new ActionError("face_looks_like_someone_else");

    const now = new Date();
    if (existing) await tx.update(schema.faceEnrolment).set({ entityId: input.entityId, updatedAt: now, ...(input.consent ? { consentAt: now, consentRecordedByPersonId: input.actorPersonId } : {}) }).where(eq(schema.faceEnrolment.personId, input.personId));
    else await tx.insert(schema.faceEnrolment).values({ personId: input.personId, entityId: input.entityId, consentAt: now, consentRecordedByPersonId: input.actorPersonId });
    await tx.insert(schema.faceTemplate).values(embeddings.map((embedding) => ({ personId: input.personId, entityId: input.entityId, model: FACE_MODEL, embedding, createdByPersonId: input.actorPersonId })));
    // The newest few stay; older angles make room. Another model's templates go with them: they are never read again.
    await tx.execute(sql`
      delete from ${schema.faceTemplate}
      where ${schema.faceTemplate.personId} = ${input.personId}
        and (${schema.faceTemplate.model} <> ${FACE_MODEL}
          or ${schema.faceTemplate.id} not in (select id from ${schema.faceTemplate} where person_id = ${input.personId} and model = ${FACE_MODEL} order by created_at desc, id limit ${MAX_TEMPLATES}))`);
    const [{ total }] = await tx.select({ total: count() }).from(schema.faceTemplate).where(eq(schema.faceTemplate.personId, input.personId));
    return { added: embeddings.length, total, consentRecorded: !existing || input.consent };
  });
}

/** Deletes a person's face data and the consent record with it. Returns the templates deleted. */
export async function deleteFaces(personId: string, executor: Executor = db()): Promise<number> {
  const [{ templates }] = await executor.select({ templates: count() }).from(schema.faceTemplate).where(eq(schema.faceTemplate.personId, personId));
  const removed = await executor.delete(schema.faceEnrolment).where(eq(schema.faceEnrolment.personId, personId)).returning({ personId: schema.faceEnrolment.personId });
  return removed.length ? templates : 0;
}

export type FaceStatus = { personId: string; templates: number; consentAt: Date; updatedAt: Date };

/** Who of these people is enrolled, with how many templates of the current model. */
export async function faceStatusOf(personIds: readonly string[]): Promise<Map<string, FaceStatus>> {
  if (personIds.length === 0) return new Map();
  const rows = await db()
    .select({ personId: schema.faceEnrolment.personId, consentAt: schema.faceEnrolment.consentAt, updatedAt: schema.faceEnrolment.updatedAt, templates: sql<number>`count(${schema.faceTemplate.id}) filter (where ${schema.faceTemplate.model} = ${FACE_MODEL})::int` })
    .from(schema.faceEnrolment)
    .leftJoin(schema.faceTemplate, eq(schema.faceTemplate.personId, schema.faceEnrolment.personId))
    .where(inArray(schema.faceEnrolment.personId, [...personIds]))
    .groupBy(schema.faceEnrolment.personId, schema.faceEnrolment.consentAt, schema.faceEnrolment.updatedAt);
  return new Map(rows.map((row) => [row.personId, row]));
}

/** The midnight job: face data of people who have left is deleted. Returns how many people's. */
export async function purgeFacesOfLeavers(): Promise<number> {
  const removed = await db()
    .delete(schema.faceEnrolment)
    .where(inArray(schema.faceEnrolment.personId, db().select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.status, "offboarded"))))
    .returning({ personId: schema.faceEnrolment.personId });
  return removed.length;
}

// Nightly, with the other housekeeping: face data has no purpose once its person has left (Law
// 91/2025). The kiosk's own housekeeping rides with it: tablets past their lifetime are closed
// (`engine/kiosk-lifetime.ts`), and the limiter's counted windows of more than a day ago go.
export const faceLeaversJob: JobDefinition = {
  name: "face-leavers",
  run: async () => ({
    people: await purgeFacesOfLeavers(),
    kiosksLapsed: await closeLapsedKioskSessions(),
    endpointHits: await purgeEndpointHits(new Date(Date.now() - ENDPOINT_HIT_RETENTION_DAYS * 86_400_000)),
  }),
};
