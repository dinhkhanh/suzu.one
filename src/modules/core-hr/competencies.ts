// What a person is good at (FR-CHR-14): their professional fields ("Social Media") and their
// skills ("Problem Solving"), two lists on the profile. Names come from one catalogue for the whole
// group, so a name typed once is offered to everybody after it and a search finds everyone who
// holds it. The catalogue is small reference data: the whole table sits in the shared cache under
// one key and is filtered here. Who holds what is personal data: one key per person.
import "server-only";
import { and, count, eq, inArray, ne, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { capitalizeWords, toSearchKey } from "@/lib/text";
import { COMPETENCY_KINDS, MAX_COMPETENCIES, MAX_COMPETENCY_NAME } from "./enums";

type Executor = Tx | ReturnType<typeof db>;
export type CompetencyKind = (typeof COMPETENCY_KINDS)[number];
export type Competency = { id: string; kind: CompetencyKind; name: string };
export type CompetencyLists = Record<CompetencyKind, { id: string; name: string }[]>;

const CATALOGUE_KEY = "core-hr:competencies";
const heldKey = (personId: string) => `core-hr:competencies-of:${personId}`;

/** For writers outside this file: the catalogue changed. */
export const invalidateCompetencies = () => invalidate(CATALOGUE_KEY);

const loadCatalogue = (from: Executor): Promise<Competency[]> =>
  from.select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name }).from(schema.competency).orderBy(schema.competency.kind, schema.competency.searchName, schema.competency.id);

/** The whole catalogue: by kind, then by name. Inside a transaction pass it, and the rows come from there. */
export function listCompetencies(executor?: Executor): Promise<Competency[]> {
  return executor ? loadCatalogue(executor) : cached(CATALOGUE_KEY, TTL.reference, () => loadCatalogue(db()));
}

const byKind = (rows: readonly Competency[]): CompetencyLists => ({
  profession: rows.filter((row) => row.kind === "profession").map(({ id, name }) => ({ id, name })),
  skill: rows.filter((row) => row.kind === "skill").map(({ id, name }) => ({ id, name })),
});

/** The catalogue as the two lists a picker offers. */
export async function competencyChoices(): Promise<CompetencyLists> {
  return byKind(await listCompetencies());
}

/**
 * What one person holds, each list in name order. Directory information, like their position —
 * and **no authorization inside**: the page has already decided this viewer may see the person
 * (`getPersonView`).
 */
export async function competenciesOf(personId: string): Promise<CompetencyLists> {
  const [catalogue, held] = await Promise.all([
    listCompetencies(),
    cached(heldKey(personId), TTL.personal, async () => (await db().select({ id: schema.personCompetency.competencyId }).from(schema.personCompetency).where(eq(schema.personCompetency.personId, personId)).orderBy(schema.personCompetency.competencyId)).map((row) => row.id)),
  ]);
  const mine = new Set(held);
  return byKind(catalogue.filter((row) => mine.has(row.id)));
}

type Wanted = { kind: CompetencyKind; name: string; searchName: string };

/** The names as they will be stored: every word capitalised, single-spaced, one of each (accents and case aside). Pure. */
export function cleanCompetencyNames(kind: CompetencyKind, names: readonly string[]): Wanted[] {
  const seen = new Set<string>();
  return names.flatMap((raw) => {
    const name = capitalizeWords(raw);
    const searchName = toSearchKey(name);
    if (!name || seen.has(searchName)) return [];
    seen.add(searchName);
    return [{ kind, name, searchName }];
  });
}

/**
 * Sets what a person holds to exactly these names. A name the catalogue does not know is added to
 * it; one it knows under another spelling ("social media") is that entry. Returns the names before
 * and after, for the audit log.
 */
export async function setPersonCompetencies(personId: string, input: Record<CompetencyKind, readonly string[]>, actorPersonId: string): Promise<{ before: Record<CompetencyKind, string[]>; after: Record<CompetencyKind, string[]> }> {
  const wanted = COMPETENCY_KINDS.flatMap((kind) => cleanCompetencyNames(kind, input[kind]));
  for (const kind of COMPETENCY_KINDS) if (wanted.filter((row) => row.kind === kind).length > MAX_COMPETENCIES) throw new ActionError("competencies_too_many");
  if (wanted.some((row) => row.name.length > MAX_COMPETENCY_NAME)) throw new ActionError("competency_name_too_long");

  const result = await db().transaction(async (tx) => {
    const [person] = await tx.select({ id: schema.person.id }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
    if (!person) throw new ActionError("person_not_found");

    const created = wanted.length ? await tx.insert(schema.competency).values(wanted.map((row) => ({ ...row, createdByPersonId: actorPersonId }))).onConflictDoNothing().returning({ id: schema.competency.id }) : [];
    const named = wanted.length
      ? await tx
          .select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name })
          .from(schema.competency)
          .where(or(...COMPETENCY_KINDS.flatMap((kind) => {
            const keys = wanted.filter((row) => row.kind === kind).map((row) => row.searchName);
            return keys.length ? [and(eq(schema.competency.kind, kind), inArray(schema.competency.searchName, keys))] : [];
          })))
          .orderBy(schema.competency.kind, schema.competency.searchName, schema.competency.id)
      : [];
    const current = await tx
      .select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name })
      .from(schema.personCompetency)
      .innerJoin(schema.competency, eq(schema.competency.id, schema.personCompetency.competencyId))
      .where(eq(schema.personCompetency.personId, personId))
      .orderBy(schema.competency.kind, schema.competency.searchName, schema.competency.id);

    const keep = new Set(named.map((row) => row.id));
    const held = new Set(current.map((row) => row.id));
    const dropped = current.filter((row) => !keep.has(row.id)).map((row) => row.id);
    const gained = named.filter((row) => !held.has(row.id)).map((row) => row.id);
    if (dropped.length) await tx.delete(schema.personCompetency).where(and(eq(schema.personCompetency.personId, personId), inArray(schema.personCompetency.competencyId, dropped)));
    if (gained.length) await tx.insert(schema.personCompetency).values(gained.map((competencyId) => ({ personId, competencyId, addedByPersonId: actorPersonId }))).onConflictDoNothing();

    const names = (rows: readonly Competency[]) => ({ profession: rows.filter((row) => row.kind === "profession").map((row) => row.name), skill: rows.filter((row) => row.kind === "skill").map((row) => row.name) });
    return { catalogueGrew: created.length > 0, before: names(current), after: names(named) };
  });

  // After the commit: the catalogue if it grew, and this person's list.
  await Promise.all([result.catalogueGrew ? invalidateCompetencies() : null, invalidate(heldKey(personId))]);
  return { before: result.before, after: result.after };
}

// ── The catalogue, for HR ───────────────────────────────────────────────────────────────────

export type CatalogueEntry = Competency & { /** How many people hold it. */ holders: number };

/** Every entry of both kinds with the number of people who hold it: the one list HR keeps tidy. */
export async function listCompetencyCatalogue(): Promise<CatalogueEntry[]> {
  const [catalogue, counts] = await Promise.all([
    listCompetencies(),
    db().select({ id: schema.personCompetency.competencyId, holders: count() }).from(schema.personCompetency).groupBy(schema.personCompetency.competencyId),
  ]);
  const holders = new Map(counts.map((row) => [row.id, row.holders]));
  return catalogue.map((row) => ({ ...row, holders: holders.get(row.id) ?? 0 }));
}

/** A new entry, put in by HR before anybody holds it. A name the catalogue already has is refused, not doubled. */
export async function addCompetency(input: { name: string; kind: CompetencyKind }, actorPersonId: string): Promise<Competency> {
  const name = capitalizeWords(input.name);
  if (!name) throw new ActionError("competency_name_empty");
  if (name.length > MAX_COMPETENCY_NAME) throw new ActionError("competency_name_too_long");
  const [row] = await db().insert(schema.competency).values({ kind: input.kind, name, searchName: toSearchKey(name), createdByPersonId: actorPersonId }).onConflictDoNothing().returning({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name });
  if (!row) throw new ActionError("competency_exists");
  await invalidateCompetencies();
  return row;
}

const dropHeld = (personIds: readonly string[]) => (personIds.length ? invalidate(...new Set(personIds.map(heldKey))) : null);

/**
 * Corrects an entry: its name (a typo, a misspelling) or its kind. When the corrected entry is one
 * the catalogue already has — "Problm Solving" fixed to "Problem Solving" — the two become one:
 * everybody who held the misspelt entry holds the existing one, and the misspelt one is gone.
 */
export async function updateCompetency(competencyId: string, input: { name: string; kind: CompetencyKind }): Promise<{ before: Competency; after: Competency; merged: boolean }> {
  const name = capitalizeWords(input.name);
  if (!name) throw new ActionError("competency_name_empty");
  if (name.length > MAX_COMPETENCY_NAME) throw new ActionError("competency_name_too_long");
  const searchName = toSearchKey(name);

  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name }).from(schema.competency).where(eq(schema.competency.id, competencyId)).for("update").limit(1);
    if (!before) throw new ActionError("competency_not_found");
    const [twin] = await tx
      .select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name })
      .from(schema.competency)
      .where(and(eq(schema.competency.kind, input.kind), eq(schema.competency.searchName, searchName), ne(schema.competency.id, competencyId)))
      .limit(1);
    if (!twin) {
      await tx.update(schema.competency).set({ name, kind: input.kind, searchName }).where(eq(schema.competency.id, competencyId));
      return { before, after: { id: competencyId, kind: input.kind, name }, merged: false, moved: [] as string[] };
    }
    // The same entry twice: its holders go over to the one that stays, in one statement.
    const holders = await tx.select({ personId: schema.personCompetency.personId }).from(schema.personCompetency).where(eq(schema.personCompetency.competencyId, competencyId));
    if (holders.length) await tx.insert(schema.personCompetency).select(tx.select({ personId: schema.personCompetency.personId, competencyId: sql<string>`${twin.id}::uuid`.as("competency_id"), addedByPersonId: schema.personCompetency.addedByPersonId, createdAt: schema.personCompetency.createdAt }).from(schema.personCompetency).where(eq(schema.personCompetency.competencyId, competencyId))).onConflictDoNothing();
    await tx.delete(schema.competency).where(eq(schema.competency.id, competencyId));
    return { before, after: twin, merged: true, moved: holders.map((row) => row.personId) };
  });

  await Promise.all([invalidateCompetencies(), dropHeld(result.moved)]);
  return { before: result.before, after: result.after, merged: result.merged };
}

/** Takes an entry out of the catalogue, and with it off the profile of everybody who held it. */
export async function deleteCompetency(competencyId: string): Promise<{ before: Competency; holders: number }> {
  const result = await db().transaction(async (tx) => {
    const [before] = await tx.select({ id: schema.competency.id, kind: schema.competency.kind, name: schema.competency.name }).from(schema.competency).where(eq(schema.competency.id, competencyId)).for("update").limit(1);
    if (!before) throw new ActionError("competency_not_found");
    const holders = await tx.select({ personId: schema.personCompetency.personId }).from(schema.personCompetency).where(eq(schema.personCompetency.competencyId, competencyId));
    // `person_competency` rows go with it (ON DELETE CASCADE).
    await tx.delete(schema.competency).where(eq(schema.competency.id, competencyId));
    return { before, holders: holders.map((row) => row.personId) };
  });
  await Promise.all([invalidateCompetencies(), dropHeld(result.holders)]);
  return { before: result.before, holders: result.holders.length };
}
