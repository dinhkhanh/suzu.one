// Intake forms (FR-WRK-16): a team's request form; a submission becomes a task in the team's
// backlog with the requester set and the answers as its description.
import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { checkAnswers, describeAnswers, dueDateFrom, fieldKey, formProblem, type IntakeField } from "./engine/intake";
import type { IntakeAudience } from "./enums";
import { canSubmitIntake, type WorkViewer } from "./policy";
import { createWorkTaskIn, taskKey } from "./tasks";
import { sendToTriage, triageLink } from "./triage";
import { entryState, findTeam, listStates, listTeams, teamFacts, type TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type IntakeFormRow = typeof schema.workIntakeForm.$inferSelect;
export type IntakeFormView = IntakeFormRow & { teamName: string; teamKey: string; projectName: string | null; submissions: number };

// The form definitions are small reference data read by the team page, the triage page and the
// request page alike, so the whole table sits in the shared cache and each list filters it here;
// the names and the submission counts beside them are joined per call. The TTL bounds anything
// written behind the app's back (a seed).
const FORMS_KEY = "work:intake-forms";
const FORMS_TTL = 30 * 60;

/** After a write to `work_intake_form` outside `saveIntakeForm` (an exit handover, a seed) has committed. */
export const invalidateIntakeForms = () => invalidate(FORMS_KEY);

async function allIntakeForms(executor?: Executor): Promise<IntakeFormRow[]> {
  const load = (from: Executor) => from.select().from(schema.workIntakeForm).orderBy(asc(schema.workIntakeForm.name), asc(schema.workIntakeForm.id));
  // Inside a transaction the rows come from there, not the cache.
  return executor ? load(executor) : cached(FORMS_KEY, FORMS_TTL, () => load(db()));
}

/** The names of the projects the forms file into — only a few forms name one. */
async function projectNames(forms: readonly IntakeFormRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(forms.map((form) => form.projectId).filter((id): id is string => !!id))];
  if (ids.length === 0) return new Map();
  const rows = await db().select({ id: schema.workProject.id, name: schema.workProject.name }).from(schema.workProject).where(inArray(schema.workProject.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** How much each form has been asked for: live counts, never cached. */
async function submissionCounts(formIds: readonly string[]): Promise<Map<string, number>> {
  if (formIds.length === 0) return new Map();
  const rows = await db()
    .select({ formId: schema.workTask.intakeFormId, submissions: sql<number>`count(*)::int` })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .where(and(inArray(schema.workTask.intakeFormId, [...formIds]), isNull(schema.task.deletedAt)))
    .groupBy(schema.workTask.intakeFormId);
  return new Map(rows.flatMap((row) => (row.formId ? [[row.formId, row.submissions] as const] : [])));
}

/** Every form of a team, retired ones too — for the people who manage them. */
export async function listTeamIntakeForms(teamId: string): Promise<IntakeFormView[]> {
  const forms = (await allIntakeForms()).filter((form) => form.teamId === teamId);
  if (forms.length === 0) return [];
  const [team, projects, counts] = await Promise.all([findTeam(teamId), projectNames(forms), submissionCounts(forms.map((form) => form.id))]);
  if (!team) return [];
  return forms
    .sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name))
    .map((form) => ({ ...form, teamName: team.name, teamKey: team.key, projectName: form.projectId ? (projects.get(form.projectId) ?? null) : null, submissions: counts.get(form.id) ?? 0 }));
}

/** The active forms this viewer may fill in. */
export async function listOpenIntakeForms(viewer: WorkViewer): Promise<IntakeFormView[]> {
  const open = (await allIntakeForms()).filter((form) => form.isActive);
  const [teams, projects] = await Promise.all([listTeams(), projectNames(open)]);
  const byId = new Map(teams.map((team) => [team.id, team]));
  return open
    .flatMap((form) => {
      const team = byId.get(form.teamId);
      if (!team?.isActive || !canSubmitIntake(viewer, teamFacts(team), form.audience as IntakeAudience)) return [];
      return [{ ...form, teamName: team.name, teamKey: team.key, projectName: form.projectId ? (projects.get(form.projectId) ?? null) : null, submissions: 0 }];
    })
    .sort((a, b) => a.teamName.localeCompare(b.teamName) || a.name.localeCompare(b.name));
}

export async function findIntakeForm(formId: string, executor: Executor = db()): Promise<{ form: IntakeFormRow; team: TeamRow } | undefined> {
  const [row] = await executor.select({ form: schema.workIntakeForm, team: schema.workTeam }).from(schema.workIntakeForm).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workIntakeForm.teamId)).where(eq(schema.workIntakeForm.id, formId)).limit(1);
  return row;
}

export type IntakeFormInput = { name: string; description: string | null; projectId: string | null; audience: IntakeAudience; fields: Omit<IntakeField, "key">[]; isActive: boolean };

export async function saveIntakeForm(teamId: string, formId: string | null, input: IntakeFormInput, actorPersonId: string): Promise<{ before: IntakeFormRow | null; after: IntakeFormRow }> {
  const team = await findTeam(teamId);
  if (!team) throw new ActionError("team_not_found");
  // Keys follow the position; an edit that reorders fields only affects future submissions (answers are stored as text in the task).
  const fields: IntakeField[] = input.fields.map((field, index) => ({ key: fieldKey(index), label: field.label.trim(), type: field.type, required: field.required, ...(field.type === "select" ? { options: (field.options ?? []).map((option) => option.trim()).filter(Boolean) } : {}) }));
  const problem = formProblem(fields);
  if (problem) throw new ActionError(problem);
  if (input.projectId) {
    const [project] = await db().select({ teamId: schema.workProject.teamId, status: schema.workProject.status }).from(schema.workProject).where(eq(schema.workProject.id, input.projectId)).limit(1);
    if (!project || project.teamId !== teamId || project.status === "archived") throw new ActionError("project_not_found");
  }
  const values = { name: input.name, description: input.description, projectId: input.projectId, audience: input.audience, fields, isActive: input.isActive };
  if (!formId) {
    const [after] = await db().insert(schema.workIntakeForm).values({ teamId, ...values, createdByPersonId: actorPersonId }).returning();
    await invalidateIntakeForms();
    return { before: null, after };
  }
  const found = await findIntakeForm(formId);
  if (!found || found.form.teamId !== teamId) throw new ActionError("intake_form_not_found");
  const [after] = await db().update(schema.workIntakeForm).set({ ...values, updatedAt: new Date() }).where(eq(schema.workIntakeForm.id, formId)).returning();
  await invalidateIntakeForms();
  return { before: found.form, after };
}

export type IntakeSubmission = { taskId: string; key: string; title: string };

/**
 * A request becomes a task: first backlog state, requester = the person asking (so they see and
 * follow it, whatever the project's privacy), waiting in the team's triage for a lead to accept it.
 * The leads are told.
 */
export async function submitIntake(formId: string, input: { title: string; answers: Record<string, unknown> }, actor: { personId: string; fullName: string }): Promise<IntakeSubmission> {
  return db().transaction(async (tx) => {
    const found = await findIntakeForm(formId, tx);
    if (!found || !found.form.isActive || !found.team.isActive) throw new ActionError("intake_form_not_found");
    const { form, team } = found;
    const { answers, problems } = checkAnswers(form.fields, input.answers);
    if (problems.length > 0) throw new ActionError("intake_answers_invalid", { problems });
    const state = entryState(await listStates([team.id], tx), true);
    const created = await createWorkTaskIn(tx, { teamId: team.id, projectId: form.projectId, title: input.title, description: describeAnswers(form.name, form.fields, answers), stateId: state?.id ?? null, requesterPersonId: actor.personId, dueDate: dueDateFrom(form.fields, answers) }, actor.personId, { notify: false });
    await tx.update(schema.workTask).set({ intakeFormId: form.id }).where(eq(schema.workTask.taskId, created.task.id));
    // Into the team's triage (FR-PJM-32): its rules pre-fill, a lead decides. The leads hear of it
    // below, in words that say who asked and through which form.
    await sendToTriage(tx, created.task.id, "intake", { notify: false, actorPersonId: actor.personId });
    const leads = (await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, team.id), eq(schema.workTeamMember.role, "lead")))).map((row) => row.personId).filter((id) => id !== actor.personId);
    if (leads.length > 0) await notify({ recipients: leads, kind: "tasks.intake_submitted", params: { name: actor.fullName, form: form.name, key: taskKey(team.key, created.work.number), title: created.task.title }, link: triageLink(team.id) }, tx);
    return { taskId: created.task.id, key: taskKey(team.key, created.work.number), title: created.task.title };
  });
}

/** What the viewer has asked for through forms, newest first — so a request is not a black hole. */
export async function listMyIntakeRequests(personId: string, limit = 20): Promise<{ taskId: string; key: string; title: string; stateName: string; status: string; formName: string | null; createdAt: Date }[]> {
  const rows = await db()
    .select({ taskId: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, stateName: schema.workState.name, status: schema.task.status, formName: schema.workIntakeForm.name, createdAt: schema.task.createdAt })
    .from(schema.workTask)
    .innerJoin(schema.task, eq(schema.task.id, schema.workTask.taskId))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .innerJoin(schema.workState, eq(schema.workState.id, schema.workTask.stateId))
    .leftJoin(schema.workIntakeForm, eq(schema.workIntakeForm.id, schema.workTask.intakeFormId))
    .where(and(eq(schema.task.requesterPersonId, personId), isNull(schema.task.deletedAt), isNotNull(schema.workTask.intakeFormId)))
    .orderBy(desc(schema.task.createdAt))
    .limit(limit);
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}
