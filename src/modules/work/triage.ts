// Triage (FR-PJM-32): work arriving from outside a team — intake forms, cross-team hand-offs,
// requests — waits in the team's triage until a lead accepts it (assignee, project, due date,
// priority), declines it with a reason, merges it into a task the team already has, or snoozes it.
// Triage rules pre-fill what they can on arrival; the lead still decides. While it waits, the task
// is out of the team's normal lists (engine/filter.ts) and out of anyone's "My work".
import "server-only";
import { and, asc, desc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { notify } from "../platform/notifications/service";
import { matchTriageRules, type TriageSetDef, type TriageSource, triageRuleProblem } from "./engine/triage";
import { autoFollow } from "./followers";
import { settleCrossTeamHandoff } from "./handoff-settle";
import { type LoadedTask, listItems, loadTask, logActivity, type TaskListItem, taskKey, updateWorkTaskIn, type WorkTaskPatch } from "./tasks";
import { listStates } from "./teams";

type Executor = Tx | ReturnType<typeof db>;
export type TriageRuleRow = typeof schema.workTriageRule.$inferSelect;

const WAITING = ["pending", "snoozed"];
const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
export const triageLink = (teamId: string) => `/work/teams/${teamId}/triage`;
const keyOf = (loaded: LoadedTask) => taskKey(loaded.team.key, loaded.work.number);

async function teamLeads(tx: Executor, teamId: string): Promise<string[]> {
  const rows = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, teamId), eq(schema.workTeamMember.role, "lead")));
  return rows.map((row) => row.personId);
}

async function tellLeads(tx: Executor, loaded: LoadedTask, exceptPersonId: string | null): Promise<void> {
  const recipients = (await teamLeads(tx, loaded.team.id)).filter((id) => id !== exceptPersonId);
  await notify({ recipients, kind: "tasks.triage_new", params: { task: `${keyOf(loaded)} ${loaded.task.title}`, team: loaded.team.name }, link: triageLink(loaded.team.id) }, tx);
}

/**
 * Puts a task into its team's triage — for other modules too: a cross-team hand-off (FR-PJM-42)
 * calls this inside its own transaction once it has made the receiving task. The team's rules
 * pre-fill what the task does not have yet; a rule pointing at something gone (a retired project,
 * a person who left) is skipped, never an error. The leads hear of it, unless the caller sends its
 * own notice (`notify: false` — intake forms tell the leads who asked and through which form).
 */
export async function sendToTriage(tx: Executor, taskId: string, source: TriageSource, options: { notify?: boolean; actorPersonId?: string | null } = {}): Promise<{ applied: TriageSetDef; ruleIds: string[] }> {
  const loaded = await loadTask(taskId, tx);
  if (!loaded) throw new ActionError("task_not_found");
  const rules = await tx.select().from(schema.workTriageRule).where(eq(schema.workTriageRule.teamId, loaded.team.id));
  const { set, ruleIds } = matchTriageRules(rules, { source, intakeFormId: loaded.work.intakeFormId, title: loaded.task.title, description: loaded.task.description });

  const applied: TriageSetDef = {};
  const tryPatch = async (patch: WorkTaskPatch, record: () => void) => {
    try {
      await updateWorkTaskIn(tx, taskId, patch, null, { silent: true });
      record();
    } catch (error) {
      if (!(error instanceof ActionError)) throw error;
    }
  };
  if (set.assigneePersonId && !loaded.task.assigneePersonId) await tryPatch({ assigneePersonId: set.assigneePersonId }, () => (applied.assigneePersonId = set.assigneePersonId));
  if (set.projectId && !loaded.work.projectId) await tryPatch({ projectId: set.projectId }, () => (applied.projectId = set.projectId));
  if (set.priority && !loaded.task.priority) await tryPatch({ priority: set.priority }, () => (applied.priority = set.priority));
  if (set.labelIds?.length) {
    const current = (await tx.select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, taskId))).map((row) => row.labelId);
    const usable = await tx.select({ id: schema.workLabel.id, teamId: schema.workLabel.teamId }).from(schema.workLabel).where(inArray(schema.workLabel.id, set.labelIds));
    const fresh = usable.filter((label) => (label.teamId === null || label.teamId === loaded.team.id) && !current.includes(label.id)).map((label) => label.id);
    if (fresh.length) await tryPatch({ labelIds: [...current, ...fresh] }, () => (applied.labelIds = fresh));
  }

  await tx.update(schema.workTask).set({ triageStatus: "pending", triageSource: source, triageSnoozedUntil: null, triageDecidedByPersonId: null, triageDecidedAt: null, triageNote: null }).where(eq(schema.workTask.taskId, taskId));
  await logActivity(tx, taskId, options.actorPersonId ?? null, [{ type: "triage_arrived", field: source, to: ruleIds.length ? { rules: ruleIds.length } : null }]);
  if (options.notify !== false) await tellLeads(tx, loaded, options.actorPersonId ?? null);
  return { applied, ruleIds };
}

async function waiting(tx: Executor, taskId: string): Promise<LoadedTask> {
  const loaded = await loadTask(taskId, tx);
  if (!loaded) throw new ActionError("task_not_found");
  if (!WAITING.includes(loaded.work.triageStatus ?? "")) throw new ActionError("triage_not_pending");
  return loaded;
}

const decided = (status: string, actorPersonId: string, note: string | null = null) => ({ triageStatus: status, triageSnoozedUntil: null, triageDecidedByPersonId: actorPersonId, triageDecidedAt: new Date(), triageNote: note });

export type TriageAcceptance = { assigneePersonId: string | null; projectId: string | null; dueDate: string | null; priority: number | null };

/** Accepted work joins the team's lists; the person given it hears, as for any task handed to them. */
export async function acceptTriage(taskId: string, input: TriageAcceptance, actor: { personId: string; fullName: string }): Promise<LoadedTask> {
  return db().transaction(async (tx) => {
    const loaded = await waiting(tx, taskId);
    const { changes } = await updateWorkTaskIn(tx, taskId, { assigneePersonId: input.assigneePersonId, projectId: input.projectId, dueDate: input.dueDate, priority: input.priority }, actor.personId);
    // A rule may have named the assignee on arrival without telling them: they hear now.
    const assignee = input.assigneePersonId;
    if (assignee && assignee !== actor.personId && !changes.some((change) => change.field === "assignee")) {
      await notify({ recipients: [assignee], kind: "tasks.work_assigned", params: { key: keyOf(loaded), title: loaded.task.title }, link: taskLink(taskId) }, tx);
    }
    await tx.update(schema.workTask).set(decided("accepted", actor.personId)).where(eq(schema.workTask.taskId, taskId));
    await logActivity(tx, taskId, actor.personId, [{ type: "triage_accepted" }]);
    await settleCrossTeamHandoff(tx, taskId, { status: "accepted" }, actor);
    return loaded;
  });
}

async function cancelState(tx: Executor, teamId: string) {
  const state = (await listStates([teamId], tx)).find((row) => row.isActive && row.category === "cancelled");
  if (!state) throw new ActionError("triage_no_cancel_state");
  return state;
}

/** Tells whoever asked that their request went nowhere (or somewhere else), in the words of any other state change. */
async function tellRequester(tx: Executor, loaded: LoadedTask, stateName: string, actor: { personId: string; fullName: string }): Promise<void> {
  const requester = loaded.task.requesterPersonId;
  if (requester && requester !== actor.personId) await notify({ recipients: [requester], kind: "tasks.status_changed", params: { name: actor.fullName, key: keyOf(loaded), title: loaded.task.title, state: stateName }, link: taskLink(loaded.task.id) }, tx);
}

/** Declined: cancelled, the reason left on the task as a comment for the requester to read. */
export async function declineTriage(taskId: string, reason: string, actor: { personId: string; fullName: string }): Promise<LoadedTask> {
  return db().transaction(async (tx) => {
    const loaded = await waiting(tx, taskId);
    const state = await cancelState(tx, loaded.team.id);
    await updateWorkTaskIn(tx, taskId, { stateId: state.id }, actor.personId, { silent: true, handoff: "system" });
    await tx.update(schema.workTask).set(decided("declined", actor.personId, reason)).where(eq(schema.workTask.taskId, taskId));
    await settleCrossTeamHandoff(tx, taskId, { status: "returned", reason }, actor);
    await tx.insert(schema.workComment).values({ taskId, authorPersonId: actor.personId, body: reason });
    await logActivity(tx, taskId, actor.personId, [{ type: "triage_declined", to: { name: reason } }]);
    await tellRequester(tx, loaded, state.name, actor);
    return loaded;
  });
}

/**
 * Merged into a task the team already has: the request's brief is copied there as a comment, the
 * two are linked, the requester follows the surviving task, and the request is cancelled.
 */
export async function mergeTriage(taskId: string, intoTaskId: string, actor: { personId: string; fullName: string }): Promise<{ loaded: LoadedTask; into: LoadedTask }> {
  return db().transaction(async (tx) => {
    const loaded = await waiting(tx, taskId);
    const into = await loadTask(intoTaskId, tx);
    if (!into || into.task.id === taskId) throw new ActionError("task_not_found");
    const [fromKey, intoKey] = [keyOf(loaded), keyOf(into)];
    const state = await cancelState(tx, loaded.team.id);
    await tx.insert(schema.workComment).values({ taskId: intoTaskId, authorPersonId: actor.personId, body: [`${fromKey} ${loaded.task.title}`, loaded.task.description].filter(Boolean).join("\n\n") });
    await tx.insert(schema.workTaskDependency).values({ blockerTaskId: intoTaskId, blockedTaskId: taskId, type: "relates", createdByPersonId: actor.personId }).onConflictDoNothing();
    const requester = loaded.task.requesterPersonId;
    if (requester && requester !== into.task.requesterPersonId && requester !== into.task.assigneePersonId) await autoFollow(tx, intoTaskId, [requester]);
    await updateWorkTaskIn(tx, taskId, { stateId: state.id }, actor.personId, { silent: true, handoff: "system" });
    await tx.update(schema.workTask).set(decided("merged", actor.personId, intoKey)).where(eq(schema.workTask.taskId, taskId));
    await settleCrossTeamHandoff(tx, taskId, { status: "accepted", targetTaskId: intoTaskId }, actor);
    await logActivity(tx, taskId, actor.personId, [{ type: "triage_merged", to: { id: intoTaskId, name: `${intoKey} ${into.task.title}` } }]);
    await logActivity(tx, intoTaskId, actor.personId, [{ type: "triage_merged_in", from: { id: taskId, name: `${fromKey} ${loaded.task.title}` } }]);
    await tellRequester(tx, loaded, state.name, actor);
    return { loaded, into };
  });
}

/** Out of the queue until a date; the midnight job puts it back (`wakeSnoozedTriage`). */
export async function snoozeTriage(taskId: string, until: IsoDate, actorPersonId: string, today: IsoDate): Promise<LoadedTask> {
  if (until <= today) throw new ActionError("triage_snooze_date");
  return db().transaction(async (tx) => {
    const loaded = await waiting(tx, taskId);
    await tx.update(schema.workTask).set({ triageStatus: "snoozed", triageSnoozedUntil: until }).where(eq(schema.workTask.taskId, taskId));
    await logActivity(tx, taskId, actorPersonId, [{ type: "triage_snoozed", to: { name: until.split("-").reverse().join("/") } }]);
    return loaded;
  });
}

/** Midnight: snoozed work whose day has come is pending again, and the leads hear of it. */
export async function wakeSnoozedTriage(today: IsoDate): Promise<{ woken: number }> {
  const due = await db()
    .select({ taskId: schema.workTask.taskId })
    .from(schema.workTask)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), isNull(schema.task.deletedAt)))
    .where(and(eq(schema.workTask.triageStatus, "snoozed"), lte(schema.workTask.triageSnoozedUntil, today)));
  let woken = 0;
  for (const { taskId } of due) {
    await db().transaction(async (tx) => {
      // Guarded by the status, so a second run (or a lead acting meanwhile) changes nothing.
      const [row] = await tx.update(schema.workTask).set({ triageStatus: "pending", triageSnoozedUntil: null }).where(and(eq(schema.workTask.taskId, taskId), eq(schema.workTask.triageStatus, "snoozed"))).returning({ taskId: schema.workTask.taskId });
      if (!row) return;
      const loaded = await loadTask(taskId, tx);
      if (!loaded) return;
      await logActivity(tx, taskId, null, [{ type: "triage_woken" }]);
      await tellLeads(tx, loaded, null);
      woken += 1;
    });
  }
  return { woken };
}

// ── Reading the queue ───────────────────────────────────────────────────────────────────────

export type TriageItem = TaskListItem & { source: string | null; snoozedUntil: string | null; requesterName: string | null; createdAt: string; description: string | null; formName: string | null; projectName: string | null };

/** A team's queue: pending first (oldest first — first come, first served), then snoozed by wake-up date. */
export async function listTriage(teamId: string): Promise<TriageItem[]> {
  const items = await listItems(and(eq(schema.workTask.teamId, teamId), inArray(schema.workTask.triageStatus, WAITING)), db(), 500);
  if (items.length === 0) return [];
  const requester = alias(schema.person, "requester");
  const extras = await db()
    .select({ id: schema.task.id, source: schema.workTask.triageSource, snoozedUntil: schema.workTask.triageSnoozedUntil, requesterName: requester.fullName, createdAt: schema.task.createdAt, description: schema.task.description, formName: schema.workIntakeForm.name, projectName: schema.workProject.name })
    .from(schema.task)
    .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
    .leftJoin(requester, eq(requester.id, schema.task.requesterPersonId))
    .leftJoin(schema.workIntakeForm, eq(schema.workIntakeForm.id, schema.workTask.intakeFormId))
    .leftJoin(schema.workProject, eq(schema.workProject.id, schema.workTask.projectId))
    .where(inArray(schema.task.id, items.map((item) => item.id)));
  const extraOf = new Map(extras.map((row) => [row.id, row]));
  return items
    .map((item) => {
      const extra = extraOf.get(item.id)!;
      return { ...item, source: extra.source, snoozedUntil: extra.snoozedUntil, requesterName: extra.requesterName, createdAt: extra.createdAt.toISOString(), description: extra.description, formName: extra.formName, projectName: extra.projectName };
    })
    .sort((a, b) => Number(a.triageStatus === "snoozed") - Number(b.triageStatus === "snoozed") || (a.snoozedUntil ?? "").localeCompare(b.snoozedUntil ?? "") || a.createdAt.localeCompare(b.createdAt));
}

export type TriageWaiting = { id: string; key: string; title: string; teamId: string; teamName: string; source: string | null; createdAt: Date };

/** For "My work": pending work in every team this person leads. */
export async function listTriageForLead(personId: string): Promise<TriageWaiting[]> {
  const rows = await db()
    .select({ id: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title, teamId: schema.workTeam.id, teamName: schema.workTeam.name, source: schema.workTask.triageSource, createdAt: schema.task.createdAt })
    .from(schema.workTask)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), isNull(schema.task.deletedAt)))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .innerJoin(schema.workTeamMember, and(eq(schema.workTeamMember.teamId, schema.workTask.teamId), eq(schema.workTeamMember.personId, personId), eq(schema.workTeamMember.role, "lead")))
    .where(eq(schema.workTask.triageStatus, "pending"))
    .orderBy(asc(schema.task.createdAt))
    .limit(200);
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}

/** How many wait in each team's triage (pending only) — the team page's badge. */
export async function countTriage(teamIds: readonly string[]): Promise<Map<string, number>> {
  if (teamIds.length === 0) return new Map();
  const rows = await db()
    .select({ teamId: schema.workTask.teamId, count: sql<number>`count(*)::int` })
    .from(schema.workTask)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), isNull(schema.task.deletedAt)))
    .where(and(inArray(schema.workTask.teamId, [...teamIds]), eq(schema.workTask.triageStatus, "pending")))
    .groupBy(schema.workTask.teamId);
  return new Map(rows.map((row) => [row.teamId, Number(row.count)]));
}

// ── Rules ───────────────────────────────────────────────────────────────────────────────────

export async function listTriageRules(teamId: string): Promise<TriageRuleRow[]> {
  return db().select().from(schema.workTriageRule).where(eq(schema.workTriageRule.teamId, teamId)).orderBy(asc(schema.workTriageRule.sortOrder), desc(schema.workTriageRule.createdAt));
}

export async function findTriageRule(ruleId: string): Promise<TriageRuleRow | undefined> {
  const [row] = await db().select().from(schema.workTriageRule).where(eq(schema.workTriageRule.id, ruleId)).limit(1);
  return row;
}

export type TriageRuleInput = { name: string; match: { source?: string; intakeFormId?: string; keyword?: string }; set: TriageSetDef; sortOrder: number; isActive: boolean };

/** What a rule names must belong to the team: its members, its projects, its (or shared) labels, its forms. */
export async function saveTriageRule(teamId: string, ruleId: string | null, input: TriageRuleInput, actorPersonId: string): Promise<{ before: TriageRuleRow | null; after: TriageRuleRow }> {
  const problem = triageRuleProblem(input);
  if (problem) throw new ActionError(problem);
  const { assigneePersonId, projectId, labelIds, intakeFormId } = { ...input.set, intakeFormId: input.match.intakeFormId };
  const [member, project, labels, form] = await Promise.all([
    assigneePersonId ? db().select({ id: schema.workTeamMember.id }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, teamId), eq(schema.workTeamMember.personId, assigneePersonId))) : [],
    projectId ? db().select({ id: schema.workProject.id }).from(schema.workProject).where(and(eq(schema.workProject.id, projectId), eq(schema.workProject.teamId, teamId))) : [],
    labelIds?.length ? db().select({ id: schema.workLabel.id, teamId: schema.workLabel.teamId }).from(schema.workLabel).where(inArray(schema.workLabel.id, labelIds)) : [],
    intakeFormId ? db().select({ id: schema.workIntakeForm.id }).from(schema.workIntakeForm).where(and(eq(schema.workIntakeForm.id, intakeFormId), eq(schema.workIntakeForm.teamId, teamId))) : [],
  ]);
  if (assigneePersonId && member.length === 0) throw new ActionError("person_not_found");
  if (projectId && project.length === 0) throw new ActionError("project_not_found");
  if (labelIds?.length && (labels.length !== new Set(labelIds).size || labels.some((label) => label.teamId !== null && label.teamId !== teamId))) throw new ActionError("label_not_found");
  if (intakeFormId && form.length === 0) throw new ActionError("intake_form_not_found");
  const values = { name: input.name, match: input.match, set: input.set, sortOrder: input.sortOrder, isActive: input.isActive };
  if (!ruleId) {
    const [after] = await db().insert(schema.workTriageRule).values({ teamId, ...values, createdByPersonId: actorPersonId }).returning();
    return { before: null, after };
  }
  const before = await findTriageRule(ruleId);
  if (!before || before.teamId !== teamId) throw new ActionError("triage_rule_not_found");
  const [after] = await db().update(schema.workTriageRule).set({ ...values, updatedAt: new Date() }).where(eq(schema.workTriageRule.id, ruleId)).returning();
  return { before, after };
}

export async function deleteTriageRule(ruleId: string): Promise<TriageRuleRow> {
  const [row] = await db().delete(schema.workTriageRule).where(eq(schema.workTriageRule.id, ruleId)).returning();
  if (!row) throw new ActionError("triage_rule_not_found");
  return row;
}

/** What a request may be merged into: the team's open tasks that are not waiting in triage themselves. */
export async function listMergeTargets(teamId: string): Promise<{ id: string; key: string; title: string }[]> {
  const rows = await db()
    .select({ id: schema.task.id, number: schema.workTask.number, teamKey: schema.workTeam.key, title: schema.task.title })
    .from(schema.workTask)
    .innerJoin(schema.task, and(eq(schema.task.id, schema.workTask.taskId), isNull(schema.task.deletedAt), inArray(schema.task.status, ["todo", "in_progress"])))
    .innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(and(eq(schema.workTask.teamId, teamId), sql`coalesce(${schema.workTask.triageStatus}, '') not in ('pending', 'snoozed')`))
    .orderBy(desc(schema.workTask.number))
    .limit(500);
  return rows.map(({ number, teamKey, ...row }) => ({ ...row, key: taskKey(teamKey, number) }));
}
