"use server";
// Automations (FR-PJM-33): a team's rules — and a project's own — kept by whoever runs the team.
import { getTranslations } from "next-intl/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { addPresetAutomation, findAutomation, removeAutomation, saveAutomation, setAutomationActive } from "./automations";
import { AUTOMATION_ACTIONS, AUTOMATION_PRESETS, AUTOMATION_TRIGGERS, CLIENT_DECISIONS, CONDITION_OPS, MAX_RULE_ACTIONS, MAX_RULE_CONDITIONS, PERSON_ROLES } from "./engine/automation";
import { canManageAutomations } from "./policy";
import { findProject, listAssignable } from "./projects";
import { findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

type User = Parameters<typeof loadViewer>[0];

/** Whoever runs the team keeps its rules, and a project's own (the project must be the team's). */
async function managesRulesOf(user: User, teamId: string, projectId: string | null): Promise<boolean> {
  const team = await findTeam(teamId);
  if (!team) return false;
  if (projectId) {
    const found = await findProject(projectId);
    if (!found || found.team.id !== teamId) return false;
  }
  return canManageAutomations(await loadViewer(user), teamFacts(team));
}

function refresh(teamId: string, projectId: string | null) {
  revalidatePath(`/work/teams/${teamId}/automations`);
  if (projectId) revalidatePath(`/work/projects/${projectId}`);
}

const trigger = z.object({
  type: z.enum(AUTOMATION_TRIGGERS),
  stateId: z.uuid().optional(),
  field: z.string().max(60).optional(),
  decision: z.enum(CLIENT_DECISIONS).optional(),
  percent: z.number().int().min(1).max(200).optional(),
  days: z.number().int().min(0).max(30).optional(),
});
const condition = z.object({ field: z.string().min(1).max(60), op: z.enum(CONDITION_OPS), value: z.union([z.string().trim().max(200), z.number()]).nullable().optional() });
const action = z.object({
  type: z.enum(AUTOMATION_ACTIONS),
  stateId: z.uuid().optional(),
  personId: z.uuid().optional(),
  to: z.enum(PERSON_ROLES).optional(),
  labelId: z.uuid().optional(),
  days: z.number().int().min(0).max(90).optional(),
  templateId: z.uuid().optional(),
  text: z.string().trim().max(500).optional(),
});
const scope = { teamId: z.uuid(), projectId: z.uuid().nullable().default(null) };

const savePipeline = createAction({
  name: "work.automation.save",
  input: z.object({ automationId: z.uuid().nullable().default(null), ...scope, name: z.string().trim().min(1).max(120), trigger, conditions: z.array(condition).max(MAX_RULE_CONDITIONS), actions: z.array(action).min(1).max(MAX_RULE_ACTIONS), isActive: z.boolean().default(true) }),
  authorize: async (user, input) => {
    const existing = input.automationId ? await findAutomation(input.automationId) : null;
    if (input.automationId && (existing?.teamId !== input.teamId || (existing?.projectId ?? null) !== input.projectId)) return false;
    return managesRulesOf(user, input.teamId, input.projectId);
  },
  run: async ({ user, input }) => {
    const { automationId, teamId, projectId, ...rule } = input;
    // A rule names people who could be given the work: the team's and the project's.
    const named = [...rule.actions.map((item) => item.personId), ...rule.conditions.filter((item) => item.field === "assignee").map((item) => item.value)].filter((id): id is string => typeof id === "string" && id.length > 0);
    if (named.length) {
      const assignable = new Set((await listAssignable(teamId, projectId)).map((person) => person.id));
      if (named.some((id) => !assignable.has(id))) throw new ActionError("person_not_found");
    }
    const { before, after } = await saveAutomation({ teamId, projectId }, automationId, rule, user.person.id);
    refresh(teamId, projectId);
    return { data: { id: after.id }, audit: { resource: { type: "work_automation", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveAutomationAction(input: unknown) {
  return savePipeline(input);
}

const togglePipeline = createAction({
  name: "work.automation.toggle",
  input: z.object({ automationId: z.uuid(), isActive: z.boolean() }),
  authorize: async (user, input) => {
    const rule = await findAutomation(input.automationId);
    return !!rule && managesRulesOf(user, rule.teamId, rule.projectId);
  },
  run: async ({ input }) => {
    const { before, after } = await setAutomationActive(input.automationId, input.isActive);
    refresh(after.teamId, after.projectId);
    return { data: { id: after.id }, audit: { resource: { type: "work_automation", id: after.id }, summary: `${after.name}: ${after.isActive ? "on" : "off"}`, before: { isActive: before.isActive }, after: { isActive: after.isActive } } };
  },
});
export async function toggleAutomationAction(input: unknown) {
  return togglePipeline(input);
}

const removePipeline = createAction({
  name: "work.automation.remove",
  input: z.object({ automationId: z.uuid() }),
  authorize: async (user, input) => {
    const rule = await findAutomation(input.automationId);
    return !!rule && managesRulesOf(user, rule.teamId, rule.projectId);
  },
  run: async ({ input }) => {
    const before = await removeAutomation(input.automationId);
    refresh(before.teamId, before.projectId);
    return { data: { id: before.id }, audit: { resource: { type: "work_automation", id: before.id }, summary: before.name, before } };
  },
});
export async function removeAutomationAction(input: unknown) {
  return removePipeline(input);
}

const presetPipeline = createAction({
  name: "work.automation.preset",
  input: z.object({ ...scope, preset: z.enum(AUTOMATION_PRESETS) }),
  authorize: (user, input) => managesRulesOf(user, input.teamId, input.projectId),
  run: async ({ user, input }) => {
    // The rule's name and message are written once, in the language of the lead who adds it.
    const t = await getTranslations("work.automations.presets");
    const after = await addPresetAutomation({ teamId: input.teamId, projectId: input.projectId }, input.preset, { name: t(`${input.preset}.name`), text: t(`${input.preset}.text`) }, user.person.id);
    refresh(input.teamId, input.projectId);
    return { data: { id: after.id }, audit: { resource: { type: "work_automation", id: after.id }, summary: `${input.preset}: ${after.name}`, after } };
  },
});
export async function addAutomationPresetAction(input: unknown) {
  return presetPipeline(input);
}
