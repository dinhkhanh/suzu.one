"use server";
// The checklist library: keeping a checklist (its unit's heads, HR, its team's leads), and hooking
// checklists to a workflow stage (whoever runs the team). Packages, intake forms and template steps
// name theirs through their own actions; a task adds one through the task update.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { isSafeTaskLink } from "../platform/tasks-engine/engine/checklist";
import { findChecklist } from "./checklist-library";
import { checklistOwner, deleteChecklist, saveChecklist, setStateChecklists } from "./checklists";
import { MAX_CHECKLIST_ITEMS, MAX_LINKED_CHECKLISTS } from "./engine/checklists";
import { canAdminTeam, canManageChecklist } from "./policy";
import { findState, findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

// "unit:<id>" | "team:<id>" | "" (company-wide), as the owner picker posts it.
const owner = z.preprocess(
  (value) => (typeof value === "string" ? value : ""),
  z.union([
    z.literal("").transform(() => ({ ownerUnitId: null, ownerTeamId: null })),
    z
      .string()
      .regex(/^(unit|team):[0-9a-f-]{36}$/)
      .transform((value) => (value.startsWith("unit:") ? { ownerUnitId: value.slice(5), ownerTeamId: null } : { ownerUnitId: null, ownerTeamId: value.slice(5) })),
  ]),
);

const item = z.object({ id: optional(z.string().regex(/^[a-z0-9_]{1,20}$/)), text: z.string().trim().max(200), linkUrl: optional(z.string().trim().max(500).refine(isSafeTaskLink)) });

const savePipeline = createAction({
  name: "work.checklist.save",
  input: z.object({
    checklistId: optional(z.uuid()),
    name: z.string().trim().min(1).max(120),
    description: optional(z.string().trim().max(1000)),
    owner,
    items: z.array(item).max(MAX_CHECKLIST_ITEMS * 2),
    isActive: checkbox.default(true),
  }),
  // Authority over who owns it now and over who will own it.
  authorize: async (user, input) => {
    const viewer = await loadViewer(user);
    const existing = input.checklistId ? await findChecklist(input.checklistId) : null;
    if (input.checklistId && !existing) return false;
    if (existing && !canManageChecklist(viewer, await checklistOwner(existing))) return false;
    return canManageChecklist(viewer, await checklistOwner(input.owner));
  },
  run: async ({ user, input }) => {
    const { checklistId, owner: placed, ...values } = input;
    const { before, after } = await saveChecklist(checklistId, { ...values, ...placed }, user.person.id);
    revalidatePath("/checklists");
    return { data: { id: after.id }, audit: { resource: { type: "work_checklist", id: after.id }, summary: `${after.name} (${after.items.length})`, before, after } };
  },
});
export async function saveChecklistAction(input: unknown) {
  return savePipeline(input);
}

const deletePipeline = createAction({
  name: "work.checklist.delete",
  input: z.object({ checklistId: z.uuid() }),
  authorize: async (user, input) => {
    const existing = await findChecklist(input.checklistId);
    return !!existing && canManageChecklist(await loadViewer(user), await checklistOwner(existing));
  },
  run: async ({ input }) => {
    const removed = await deleteChecklist(input.checklistId);
    revalidatePath("/checklists");
    return { data: { id: removed.id }, audit: { resource: { type: "work_checklist", id: removed.id }, summary: removed.name, before: removed } };
  },
});
export async function deleteChecklistAction(input: unknown) {
  return deletePipeline(input);
}

const stagePipeline = createAction({
  name: "work.state.checklists",
  input: z.object({ stateId: z.uuid(), hooks: z.array(z.object({ checklistId: z.uuid(), required: checkbox.default(false) })).max(MAX_LINKED_CHECKLISTS) }),
  authorize: async (user, input) => {
    const state = await findState(input.stateId);
    const team = state ? await findTeam(state.teamId) : undefined;
    return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
  },
  run: async ({ input }) => {
    const state = (await findState(input.stateId))!;
    const { before, after } = await setStateChecklists(state.id, input.hooks);
    revalidatePath(`/work/teams/${state.teamId}`);
    return { data: { id: state.id }, audit: { resource: { type: "work_state", id: state.id }, summary: `${state.name}: ${after.length} checklist(s)`, before: { hooks: before }, after: { hooks: after } } };
  },
});
export async function setStateChecklistsAction(input: unknown) {
  return stagePipeline(input);
}
