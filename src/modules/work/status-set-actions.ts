"use server";
// The status library: task workflows and project status sets. A team's own set is kept by whoever
// runs the team; a shared one (no owner) by `work:manage` over the whole group — as templates are.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { MAX_SET_PROJECT_STATUSES, MAX_SET_STATES, PROJECT_STATUSES, STATE_CATEGORIES } from "./enums";
import { canAdminTeam, canManageTemplate, type WorkViewer } from "./policy";
import { deleteProjectStatusSet, deleteStateSet, findProjectStatusSet, findStateSet, saveProjectStatusSet, saveStateSet, stateSetFromTeam } from "./status-sets";
import { findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

const setFields = {
  name: z.string().trim().min(1).max(80),
  description: optional(z.string().trim().max(500)),
  // The owning team; blank = shared.
  ownerTeamId: optional(z.uuid()),
  isActive: checkbox.default(true),
};

/** May the viewer keep a set owned by this team (`null` = shared)? */
async function mayKeep(viewer: WorkViewer, ownerTeamId: string | null): Promise<boolean> {
  if (!ownerTeamId) return canManageTemplate(viewer, null);
  const team = await findTeam(ownerTeamId);
  return !!team && canManageTemplate(viewer, teamFacts(team));
}

/** Authority over who owns the set now and over who will own it. */
async function mayKeepBoth(viewer: WorkViewer, existing: { ownerTeamId: string | null } | undefined, ownerTeamId: string | null): Promise<boolean> {
  if (existing && !(await mayKeep(viewer, existing.ownerTeamId))) return false;
  return mayKeep(viewer, ownerTeamId);
}

const revalidate = () => {
  revalidatePath("/work/statuses");
  revalidatePath("/work");
};

// ── Task workflows ──────────────────────────────────────────────────────────────────────────

const saveStateSetPipeline = createAction({
  name: "work.state_set.save",
  input: z.object({ setId: optional(z.uuid()), ...setFields, states: z.array(z.object({ name: z.string().trim().max(40), category: z.enum(STATE_CATEGORIES) })).max(MAX_SET_STATES * 2) }),
  authorize: async (user, input) => {
    const existing = input.setId ? await findStateSet(input.setId) : undefined;
    if (input.setId && !existing) return false;
    return mayKeepBoth(await loadViewer(user), existing, input.ownerTeamId);
  },
  run: async ({ user, input }) => {
    const { setId, ...values } = input;
    const { before, after } = await saveStateSet(setId, values, user.person.id);
    revalidate();
    return { data: { id: after.id }, audit: { resource: { type: "work_state_set", id: after.id }, summary: `${after.name} (${after.states.length})`, before, after } };
  },
});
export async function saveStateSetAction(input: unknown) {
  return saveStateSetPipeline(input);
}

const deleteStateSetPipeline = createAction({
  name: "work.state_set.delete",
  input: z.object({ setId: z.uuid() }),
  authorize: async (user, input) => {
    const existing = await findStateSet(input.setId);
    return !!existing && mayKeep(await loadViewer(user), existing.ownerTeamId);
  },
  run: async ({ input }) => {
    const removed = await deleteStateSet(input.setId);
    revalidate();
    return { data: { id: removed.id }, audit: { resource: { type: "work_state_set", id: removed.id }, summary: removed.name, before: removed } };
  },
});
export async function deleteStateSetAction(input: unknown) {
  return deleteStateSetPipeline(input);
}

const fromTeamPipeline = createAction({
  name: "work.state_set.from_team",
  input: z.object({ teamId: z.uuid(), name: z.string().trim().min(1).max(80) }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
  },
  run: async ({ user, input }) => {
    const set = await stateSetFromTeam(input.teamId, input.name, user.person.id);
    revalidate();
    return { data: { id: set.id }, audit: { resource: { type: "work_state_set", id: set.id }, summary: `${set.name} (${set.states.length}) from team ${input.teamId}`, after: set } };
  },
});
export async function saveTeamWorkflowAsSetAction(input: unknown) {
  return fromTeamPipeline(input);
}

// ── Project status sets ─────────────────────────────────────────────────────────────────────

const saveProjectStatusSetPipeline = createAction({
  name: "work.project_status_set.save",
  input: z.object({
    setId: optional(z.uuid()),
    ...setFields,
    statuses: z.array(z.object({ id: optional(z.uuid()), name: z.string().trim().max(40), category: z.enum(PROJECT_STATUSES), isActive: checkbox.default(true) })).max(MAX_SET_PROJECT_STATUSES * 2),
  }),
  authorize: async (user, input) => {
    const existing = input.setId ? await findProjectStatusSet(input.setId) : undefined;
    if (input.setId && !existing) return false;
    return mayKeepBoth(await loadViewer(user), existing, input.ownerTeamId);
  },
  run: async ({ user, input }) => {
    const { setId, ...values } = input;
    const { before, after } = await saveProjectStatusSet(setId, values, user.person.id);
    revalidate();
    return { data: { id: after.id }, audit: { resource: { type: "work_project_status_set", id: after.id }, summary: `${after.name} (${after.statuses.length})`, before, after } };
  },
});
export async function saveProjectStatusSetAction(input: unknown) {
  return saveProjectStatusSetPipeline(input);
}

const deleteProjectStatusSetPipeline = createAction({
  name: "work.project_status_set.delete",
  input: z.object({ setId: z.uuid() }),
  authorize: async (user, input) => {
    const existing = await findProjectStatusSet(input.setId);
    return !!existing && mayKeep(await loadViewer(user), existing.ownerTeamId);
  },
  run: async ({ input }) => {
    const removed = await deleteProjectStatusSet(input.setId);
    revalidate();
    return { data: { id: removed.id }, audit: { resource: { type: "work_project_status_set", id: removed.id }, summary: removed.name, before: removed } };
  },
});
export async function deleteProjectStatusSetAction(input: unknown) {
  return deleteProjectStatusSetPipeline(input);
}
