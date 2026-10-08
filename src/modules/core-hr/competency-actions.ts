"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { addCompetency, deleteCompetency, setPersonCompetencies, updateCompetency } from "./competencies";
import { COMPETENCY_KINDS, MAX_COMPETENCIES, MAX_COMPETENCY_NAME } from "./enums";
import { canEditCompetencies, canManageCompetencies } from "./policy";
import { getPersonTarget } from "./service";

// Professional fields and skills (FR-CHR-14). The form posts every chosen name; a list with nothing
// chosen posts nothing at all, which reads as "none".
const names = z.preprocess((value) => (Array.isArray(value) ? value : typeof value === "string" && value.trim() !== "" ? [value] : []), z.array(z.string().trim().min(1).max(MAX_COMPETENCY_NAME)).max(MAX_COMPETENCIES));

const setPipeline = createAction({
  name: "person.competencies.set",
  input: z.object({ personId: z.uuid(), professions: names, skills: names }),
  authorize: async (user, input) => canEditCompetencies(user.principal, await getPersonTarget(input.personId)),
  run: async ({ user, input }) => {
    const [target, { before, after }] = await Promise.all([getPersonTarget(input.personId), setPersonCompetencies(input.personId, { profession: input.professions, skill: input.skills }, user.person.id)]);
    revalidatePath(`/people/${input.personId}`);
    revalidatePath("/me");
    revalidatePath("/people");
    return { data: after, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: "professional fields and skills", before, after } };
  },
});

export async function setPersonCompetenciesAction(input: unknown) {
  return setPipeline(input);
}

// ── The catalogue (HR) ──────────────────────────────────────────────────────────────────────

const revalidateCatalogue = () => {
  revalidatePath("/people/competencies");
  revalidatePath("/people");
  // Every profile reads the names from the catalogue.
  revalidatePath("/people/[id]", "page");
  revalidatePath("/me");
};

const entryFields = { name: z.string().trim().min(1).max(MAX_COMPETENCY_NAME), kind: z.enum(COMPETENCY_KINDS) };

const addPipeline = createAction({
  name: "competency.create",
  input: z.object(entryFields),
  authorize: (user) => canManageCompetencies(user.principal),
  run: async ({ user, input }) => {
    const entry = await addCompetency(input, user.person.id);
    revalidateCatalogue();
    return { data: { id: entry.id, name: entry.name }, audit: { resource: { type: "competency", id: entry.id, entityId: null }, summary: entry.name, after: entry } };
  },
});

export async function addCompetencyAction(input: unknown) {
  return addPipeline(input);
}

const updatePipeline = createAction({
  name: "competency.update",
  // The name is capitalised and spaced by the service, not refused here.
  input: z.object({ competencyId: z.uuid(), ...entryFields }),
  authorize: (user) => canManageCompetencies(user.principal),
  run: async ({ input }) => {
    const { before, after, merged } = await updateCompetency(input.competencyId, { name: input.name, kind: input.kind });
    revalidateCatalogue();
    return {
      data: { merged, name: after.name },
      audit: { resource: { type: "competency", id: input.competencyId, entityId: null }, summary: merged ? `${before.name} merged into ${after.name}` : `${before.name} → ${after.name}`, before, after: { ...after, merged } },
    };
  },
});

export async function updateCompetencyAction(input: unknown) {
  return updatePipeline(input);
}

const deletePipeline = createAction({
  name: "competency.delete",
  input: z.object({ competencyId: z.uuid() }),
  authorize: (user) => canManageCompetencies(user.principal),
  run: async ({ input }) => {
    const { before, holders } = await deleteCompetency(input.competencyId);
    revalidateCatalogue();
    return { data: { holders }, audit: { resource: { type: "competency", id: input.competencyId, entityId: null }, summary: `${before.name} removed (${holders} people)`, before: { ...before, holders } } };
  },
});

export async function deleteCompetencyAction(input: unknown) {
  return deletePipeline(input);
}
