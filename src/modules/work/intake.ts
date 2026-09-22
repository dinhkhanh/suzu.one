// Intake forms (FR-WRK-16): a team's request form; a submission becomes a task in the team's
// backlog with the requester set and the answers as its description.
import "server-only";
import { and, asc, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { checkAnswers, describeAnswers, dueDateFrom, fieldKey, formProblem, type IntakeField } from "./engine/intake";
import type { IntakeAudience } from "./enums";
import { canSubmitIntake, type WorkViewer } from "./policy";
import { createWorkTaskIn, taskKey } from "./tasks";
import { entryState, findTeam, listStates, teamFacts, type TeamRow } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type IntakeFormRow = typeof schema.workIntakeForm.$inferSelect;
export type IntakeFormView = IntakeFormRow & { teamName: string; teamKey: string; projectName: string | null; submissions: number };

const withNames = (executor: Executor) =>
  executor
    .select({ form: schema.workIntakeForm, team: schema.workTeam, projectName: schema.workProject.name })
    .from(schema.workIntakeForm)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workIntakeForm.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workIntakeForm.projectId))
    .$dynamic();

/** Every form of a team, retired ones too — for the people who manage them. */
export async function listTeamIntakeForms(teamId: string): Promise<IntakeFormView[]> {
  const rows = await db()
    .select({
      form: schema.workIntakeForm,
      team: schema.workTeam,
      projectName: schema.workProject.name,
      submissions: sql<number>`(select count(*)::int from ${schema.workTask} inner join ${schema.task} on ${schema.task.id} = ${schema.workTask.taskId} where ${schema.workTask.intakeFormId} = ${schema.workIntakeForm.id} and ${schema.task.deletedAt} is null)`,
    })
    .from(schema.workIntakeForm)
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workIntakeForm.teamId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workIntakeForm.projectId))
    .where(eq(schema.workIntakeForm.teamId, teamId))
    .orderBy(desc(schema.workIntakeForm.isActive), asc(schema.workIntakeForm.name));
  return rows.map(({ form, team, projectName, submissions }) => ({ ...form, teamName: team.name, teamKey: team.key, projectName, submissions }));
}

/** The active forms this viewer may fill in. */
export async function listOpenIntakeForms(viewer: WorkViewer): Promise<IntakeFormView[]> {
  const rows = await withNames(db()).where(and(eq(schema.workIntakeForm.isActive, true), eq(schema.workTeam.isActive, true))).orderBy(asc(schema.workTeam.name), asc(schema.workIntakeForm.name));
  return rows.filter(({ form, team }) => canSubmitIntake(viewer, teamFacts(team), form.audience as IntakeAudience)).map(({ form, team, projectName }) => ({ ...form, teamName: team.name, teamKey: team.key, projectName, submissions: 0 }));
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
    return { before: null, after };
  }
  const found = await findIntakeForm(formId);
  if (!found || found.form.teamId !== teamId) throw new ActionError("intake_form_not_found");
  const [after] = await db().update(schema.workIntakeForm).set({ ...values, updatedAt: new Date() }).where(eq(schema.workIntakeForm.id, formId)).returning();
  return { before: found.form, after };
}

export type IntakeSubmission = { taskId: string; key: string; title: string };

/**
 * A request becomes a task: first backlog state, requester = the person asking (so they see and
 * follow it, whatever the project's privacy), no assignee — triage is the team's. The leads are told.
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
    const leads = (await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, team.id), eq(schema.workTeamMember.role, "lead")))).map((row) => row.personId).filter((id) => id !== actor.personId);
    if (leads.length > 0) await notify({ recipients: leads, kind: "tasks.intake_submitted", params: { name: actor.fullName, form: form.name, key: taskKey(team.key, created.work.number), title: created.task.title }, link: `/work/tasks/${created.task.id}` }, tx);
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
