// Automations (FR-PJM-33): a team's (or one project's) "when … then …" rules, and running them.
//
// Rules run from the service functions, never from the screens, in the transaction of the change
// that set them off: the state change in `updateWorkTaskIn`, a review decision, a client decision,
// a hand-off answered — and the morning job for due dates, and the projects module's quota alerts
// through `fireProjectAutomations`. Each rule runs inside a savepoint, and each of its actions in a
// savepoint of its own: an action that fails is rolled back and written down, the person's change
// and the rule's other actions stand. Every run leaves a `work_automation_run` row and, on a task,
// a line in its activity with no actor and the rule's name.
import "server-only";
import { and, asc, eq, inArray, isNull, lte, gte, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { cached, invalidate } from "@/lib/cache";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getDaysOff } from "@/modules/attendance/service";
import { notify } from "../platform/notifications/service";
import { listCustomFields } from "./custom-fields";
import { type AutomationEvent, type AutomationPreset, automationsMayRun, conditionsHold, DUE_CATCH_UP_DAYS, matchesTrigger, officeDayOff, type PlannedAction, planActions, type PlanFacts, presetRule, ruleCovers, type RuleInput, ruleProblem, runOutcome } from "./engine/automation";
import { stateOnSubmit } from "./engine/review";
import { planTree } from "./engine/templates";
import type { StateCategory } from "./enums";
import { autoFollow } from "./followers";
import { canManageProject, canViewProject, canViewTask, type ProjectFacts, type WorkViewer } from "./policy";
import { createWorkTaskIn, type LoadedTask, loadTask, loadTasks, logActivity, taskKey, updateWorkTaskIn } from "./tasks";
import { listAssignable, projectFacts } from "./projects";
import { listLabels, listStates } from "./teams";
import { listWorkTemplates } from "./templates";
import { viewersOfPeople } from "./viewer";

type Executor = Tx | ReturnType<typeof db>;
export type AutomationRow = typeof schema.workAutomation.$inferSelect;
export type AutomationRunRow = typeof schema.workAutomationRun.$inferSelect;
export type AutomationScope = { teamId: string; projectId: string | null };

const taskLink = (taskId: string) => `/work/tasks/${taskId}`;
const TASK_TEMPLATE_PURPOSE = "work_task";
const OPEN = ["todo", "in_progress"] as const;

// ── Keeping rules ───────────────────────────────────────────────────────────────────────────

// The rules are small reference data read by the automation screens and the morning job, so the
// whole table sits in the shared cache and each scope is filtered out here; a rule that runs inside
// a change reads from that change's transaction instead (`activeRules`). The TTL bounds anything
// written behind the app's back (a seed).
const RULES_KEY = "work:automations";
const RULES_TTL = 30 * 60;

/** After a write to `work_automation` outside this file (an exit handover, a seed) has committed. */
export const invalidateAutomations = () => invalidate(RULES_KEY);

async function allAutomations(executor?: Executor): Promise<AutomationRow[]> {
  const load = (from: Executor) => from.select().from(schema.workAutomation).orderBy(asc(schema.workAutomation.createdAt), asc(schema.workAutomation.id));
  // Inside a transaction the rows come from there, not the cache.
  return executor ? load(executor) : cached(RULES_KEY, RULES_TTL, () => load(db()));
}

/**
 * A team's rules with, when a project is named, that project's own; `projectId` undefined = every
 * rule of the team, its projects' included (the team's automation page). Oldest first — the order
 * they run in. Inside a transaction pass the executor, and the rows come from there, not the cache.
 */
export async function listAutomations(scope: { teamId: string; projectId?: string | null }, executor?: Executor): Promise<AutomationRow[]> {
  const rows = await allAutomations(executor);
  return rows.filter((rule) => rule.teamId === scope.teamId && (scope.projectId === undefined || (scope.projectId ? rule.projectId === null || rule.projectId === scope.projectId : rule.projectId === null)));
}

export async function findAutomation(automationId: string, executor: Executor = db()): Promise<AutomationRow | undefined> {
  const [row] = await executor.select().from(schema.workAutomation).where(eq(schema.workAutomation.id, automationId)).limit(1);
  return row;
}

/**
 * The task templates a rule may make tasks from: the shared ones and the team's own. Off the
 * templates module's cached set (`listWorkTemplates`); inside a transaction pass the executor and
 * the rows come from there.
 */
export async function listTaskTemplates(teamId: string, executor?: Executor): Promise<{ id: string; name: string }[]> {
  const templates = await listWorkTemplates([teamId], { activeOnly: true, executor });
  return templates
    .filter((template) => template.purpose === TASK_TEMPLATE_PURPOSE)
    .map((template) => ({ id: template.id, name: template.name }))
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

/** What a rule of this scope may name, read in the saving transaction. */
async function ruleContext(tx: Executor, scope: AutomationScope) {
  const [states, labels, fields, templates] = await Promise.all([listStates([scope.teamId], tx), listLabels([scope.teamId], tx), listCustomFields({ teamId: scope.teamId, projectId: scope.projectId }, { executor: tx }), listTaskTemplates(scope.teamId, tx)]);
  return {
    stateIds: new Set(states.filter((state) => state.isActive).map((state) => state.id)),
    labelIds: new Set(labels.map((label) => label.id)),
    customFieldIds: new Set(fields.filter((field) => field.isActive).map((field) => field.id)),
    templateIds: new Set(templates.map((template) => template.id)),
  };
}

/** Only what the rule's parts need is kept: a form's leftovers do not ride along in the JSON. */
const clean = (input: RuleInput): RuleInput => ({
  name: input.name.trim().slice(0, 120),
  trigger: Object.fromEntries(Object.entries(input.trigger).filter(([, value]) => value !== null && value !== undefined && value !== "")) as RuleInput["trigger"],
  conditions: input.conditions.map(({ field, op, value }) => (op === "set" || op === "unset" ? { field, op } : { field, op, value: value ?? null })),
  actions: input.actions.map((action) => Object.fromEntries(Object.entries(action).filter(([, value]) => value !== null && value !== undefined && value !== "")) as RuleInput["actions"][number]),
});

/** A new rule or a change to one. A rule stays where it was made: a team's rule does not turn into a project's. */
export async function saveAutomation(scope: AutomationScope, automationId: string | null, input: RuleInput & { isActive: boolean }, actorPersonId: string): Promise<{ before: AutomationRow | null; after: AutomationRow }> {
  const saved = await db().transaction(async (tx) => {
    const rule = clean(input);
    const problem = ruleProblem(rule, await ruleContext(tx, scope));
    if (problem) throw new ActionError(problem);
    const values = { name: rule.name, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions, isActive: input.isActive, updatedAt: new Date() };
    if (!automationId) {
      const [after] = await tx.insert(schema.workAutomation).values({ ...scope, ...values, createdByPersonId: actorPersonId }).returning();
      return { before: null, after };
    }
    const before = await findAutomation(automationId, tx);
    if (!before || before.teamId !== scope.teamId || before.projectId !== scope.projectId) throw new ActionError("automation_not_found");
    const [after] = await tx.update(schema.workAutomation).set(values).where(eq(schema.workAutomation.id, automationId)).returning();
    return { before, after };
  });
  await invalidateAutomations();
  return saved;
}

export async function setAutomationActive(automationId: string, isActive: boolean): Promise<{ before: AutomationRow; after: AutomationRow }> {
  const before = await findAutomation(automationId);
  if (!before) throw new ActionError("automation_not_found");
  const [after] = await db().update(schema.workAutomation).set({ isActive, updatedAt: new Date() }).where(eq(schema.workAutomation.id, automationId)).returning();
  await invalidateAutomations();
  return { before, after };
}

/** Its runs go with it (ON DELETE CASCADE); comments it posted stay, naming no rule. */
export async function removeAutomation(automationId: string): Promise<AutomationRow> {
  const [row] = await db().delete(schema.workAutomation).where(eq(schema.workAutomation.id, automationId)).returning();
  if (!row) throw new ActionError("automation_not_found");
  await invalidateAutomations();
  return row;
}

/** One of the starter rules, fitted to the team's workflow; the texts are in the lead's language. */
export async function addPresetAutomation(scope: AutomationScope, preset: AutomationPreset, texts: { name: string; text: string }, actorPersonId: string): Promise<AutomationRow> {
  const states = await listStates([scope.teamId], db());
  const rule = presetRule(preset, states.map((state) => ({ id: state.id, category: state.category as StateCategory, sortOrder: state.sortOrder, isActive: state.isActive })), texts);
  if (!rule) throw new ActionError("automation_preset_unavailable");
  return (await saveAutomation(scope, null, { ...rule, isActive: true }, actorPersonId)).after;
}

export type AutomationRunView = { id: string; automationId: string; taskId: string | null; taskKey: string | null; taskTitle: string | null; trigger: string; outcome: string; detail: Record<string, unknown>; createdAt: Date };

/** The latest runs of these rules, newest first — for the automation page. */
export async function listAutomationRuns(automationIds: readonly string[], limit = 50): Promise<AutomationRunView[]> {
  if (automationIds.length === 0) return [];
  const rows = await db()
    .select({ run: schema.workAutomationRun, title: schema.task.title, number: schema.workTask.number, teamKey: schema.workTeam.key })
    .from(schema.workAutomationRun)
    .leftJoin(schema.task, eq(schema.task.id, schema.workAutomationRun.taskId))
    .leftJoin(schema.workTask, eq(schema.workTask.taskId, schema.workAutomationRun.taskId))
    .leftJoin(schema.workTeam, eq(schema.workTeam.id, schema.workTask.teamId))
    .where(inArray(schema.workAutomationRun.automationId, [...automationIds]))
    .orderBy(sql`${schema.workAutomationRun.createdAt} desc`)
    .limit(limit);
  return rows.map(({ run, title, number, teamKey }) => ({ id: run.id, automationId: run.automationId, taskId: run.taskId, taskKey: teamKey && number ? taskKey(teamKey, number) : null, taskTitle: title, trigger: run.trigger, outcome: run.outcome, detail: run.detail, createdAt: run.createdAt }));
}

// ── Running rules ───────────────────────────────────────────────────────────────────────────

async function activeRules(tx: Executor, teamId: string): Promise<AutomationRow[]> {
  return tx.select().from(schema.workAutomation).where(and(eq(schema.workAutomation.teamId, teamId), eq(schema.workAutomation.isActive, true))).orderBy(asc(schema.workAutomation.createdAt), asc(schema.workAutomation.id));
}

async function leadsOf(tx: Executor, teamId: string, projectLeadId: string | null): Promise<string[]> {
  const rows = await tx.select({ personId: schema.workTeamMember.personId }).from(schema.workTeamMember).where(and(eq(schema.workTeamMember.teamId, teamId), eq(schema.workTeamMember.role, "lead"))).orderBy(asc(schema.workTeamMember.personId));
  return [...new Set([projectLeadId, ...rows.map((row) => row.personId)].filter((id): id is string => !!id))];
}

/** Saturdays, Sundays and the entity's days off for the next months: the calendar "working days" count on. */
async function dayOffCheck(tx: Executor, entityId: string | null, today: IsoDate): Promise<(date: IsoDate) => boolean> {
  const days = await getDaysOff(entityId, today, addDays(today, 200), tx);
  return officeDayOff(new Set(days.map((day) => day.date)));
}

type Target = { loaded: LoadedTask | null; teamId: string; projectId: string | null; entityId: string | null; projectLeadId: string | null; label: string; /** The project as the policy sees it, for a rule with no task (a quota alert). */ project: ProjectFacts | null };

const targetOfTask = (loaded: LoadedTask): Target => ({ loaded, teamId: loaded.team.id, projectId: loaded.work.projectId, entityId: loaded.task.entityId, projectLeadId: loaded.project?.leadPersonId ?? null, label: `${taskKey(loaded.team.key, loaded.work.number)} ${loaded.task.title}`, project: loaded.facts.project });

async function planFactsFor(tx: Executor, rule: AutomationRow, target: Target, event: AutomationEvent): Promise<PlanFacts> {
  const today = todayInVietnam();
  const needsCalendar = rule.actions.some((action) => action.type === "set_due" || action.type === "create_task");
  const loaded = target.loaded;
  const [leadIds, isDayOff, labels, parent] = await Promise.all([
    leadsOf(tx, target.teamId, target.projectLeadId),
    needsCalendar ? dayOffCheck(tx, target.entityId, today) : Promise.resolve(officeDayOff(new Set())),
    loaded ? tx.select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, loaded.task.id)) : Promise.resolve([]),
    loaded?.task.parentTaskId ? tx.select({ assignee: schema.task.assigneePersonId }).from(schema.task).where(eq(schema.task.id, loaded.task.parentTaskId)).limit(1) : Promise.resolve([]),
  ]);
  return {
    today,
    isDayOff,
    leadIds,
    handedOff: event.type === "state_entered" && !!event.handedOff,
    task: loaded
      ? {
          priority: loaded.task.priority,
          assigneePersonId: loaded.task.assigneePersonId,
          labelIds: labels.map((label) => label.labelId),
          channel: loaded.work.channel,
          contentFormat: loaded.work.contentFormat,
          customValues: loaded.work.customValues,
          stateId: loaded.work.stateId,
          dueDate: loaded.task.dueDate,
          requesterPersonId: loaded.task.requesterPersonId,
          parentAssigneePersonId: parent[0]?.assignee ?? null,
          reviewerPersonId: loaded.work.reviewerPersonId,
        }
      : null,
  };
}

/**
 * A task template's steps as new tasks, where the rule's task (or project) lives: dated from today
 * on working days, every role played by the task's assignee, the top steps linked to the task.
 */
async function createFromTemplate(tx: Tx, templateId: string, target: Target, facts: PlanFacts): Promise<string[]> {
  const [template] = await tx.select().from(schema.taskTemplate).where(and(eq(schema.taskTemplate.id, templateId), eq(schema.taskTemplate.purpose, TASK_TEMPLATE_PURPOSE), eq(schema.taskTemplate.isActive, true))).limit(1);
  if (!template || (template.ownerId && template.ownerId !== target.teamId)) throw new ActionError("template_not_found");
  const items = await tx.select().from(schema.taskTemplateItem).where(eq(schema.taskTemplateItem.templateId, template.id));
  if (items.length === 0) throw new ActionError("template_empty");
  const assignee = facts.task?.assigneePersonId ?? null;
  const roles = new Proxy({} as Record<string, string | null>, { get: () => assignee });
  const plan = planTree(
    items.map((item) => ({ id: item.id, parentItemId: item.parentItemId, title: item.title, description: item.description, assigneeRule: item.assigneeRule, assigneePersonId: item.assigneePersonId, dueOffsetDays: item.dueOffsetDays, sortOrder: item.sortOrder, estimateMinutes: item.estimateMinutes })),
    { mode: "start", date: facts.today },
    roles,
    facts.isDayOff,
  );
  const made = new Map<string, string>();
  for (const node of plan) {
    const { task } = await createWorkTaskIn(tx, { teamId: target.teamId, projectId: target.projectId, title: node.title, description: node.description, assigneePersonId: node.assigneePersonId, dueDate: node.dueDate, estimateMinutes: node.estimateMinutes, parentTaskId: node.parentItemId ? (made.get(node.parentItemId) ?? null) : null, templateItemId: node.templateItemId }, null);
    made.set(node.templateItemId, task.id);
    if (!node.parentItemId && target.loaded) await tx.insert(schema.workTaskDependency).values({ blockerTaskId: target.loaded.task.id, blockedTaskId: task.id, type: "relates", createdByPersonId: null });
  }
  return [...made.values()];
}

type StepResult = { action: string; status: "done" | "skipped" | "failed"; reason?: string; error?: string; created?: string[] };

/** One planned action, inside its own savepoint. Changes to the task are made at `depth + 1`. */
async function applyStep(sp: Tx, step: Exclude<PlannedAction, { type: "skip" }>, rule: AutomationRow, target: Target, facts: PlanFacts, depth: number): Promise<Partial<StepResult>> {
  const taskId = target.loaded?.task.id;
  const change = (patch: Parameters<typeof updateWorkTaskIn>[2]) => updateWorkTaskIn(sp, taskId!, patch, null, { handoff: "automation", automationDepth: depth + 1 });
  switch (step.type) {
    case "move_state":
      await change({ stateId: step.stateId });
      return {};
    case "assign":
      await change({ assigneePersonId: step.personId });
      return {};
    case "add_label":
      await change({ labelIds: step.labelIds });
      return {};
    case "set_due":
      await change({ dueDate: step.dueDate });
      return {};
    case "add_follower":
      await autoFollow(sp, taskId!, step.personIds);
      return {};
    case "create_task":
      return { created: await createFromTemplate(sp, step.templateId, target, facts) };
    case "request_review": {
      // The reviewer is named, and the task moves into the team's review state when it is not in one yet.
      const states = await listStates([target.teamId], sp);
      const into = stateOnSubmit(states.map((state) => ({ id: state.id, category: state.category as StateCategory, sortOrder: state.sortOrder, isActive: state.isActive })), target.loaded!.work.stateId);
      await change({ reviewerPersonId: step.reviewerPersonId, ...(into ? { stateId: into } : {}) });
      await autoFollow(sp, taskId!, [step.reviewerPersonId]);
      await notify({ recipients: [step.reviewerPersonId], kind: "tasks.automation", params: { rule: rule.name, task: target.label, text: step.text ?? rule.name }, link: taskLink(taskId!) }, sp);
      return {};
    }
    case "notify":
      await notify({ recipients: step.recipients, kind: "tasks.automation", params: { rule: rule.name, task: target.label, text: step.text }, link: taskId ? taskLink(taskId) : target.projectId ? `/work/projects/${target.projectId}` : `/work/teams/${target.teamId}` }, sp);
      return {};
    case "comment":
      await sp.insert(schema.workComment).values({ taskId: taskId!, authorPersonId: null, automationId: rule.id, body: step.text.slice(0, 5000) });
      return {};
  }
}

async function recordRun(tx: Executor, rule: AutomationRow, target: Target, event: AutomationEvent, outcome: "ok" | "skipped" | "failed", detail: Record<string, unknown>): Promise<void> {
  const taskId = target.loaded?.task.id ?? null;
  await tx.insert(schema.workAutomationRun).values({ automationId: rule.id, taskId, trigger: event.type, outcome, detail });
  await tx.update(schema.workAutomation).set({ runCount: sql`${schema.workAutomation.runCount} + 1`, lastRunAt: new Date() }).where(eq(schema.workAutomation.id, rule.id));
  if (taskId) await logActivity(tx, taskId, null, [{ type: outcome === "failed" ? "automation_failed" : "automation_ran", to: { id: rule.id, name: rule.name, outcome } }]);
}

/** What a run remembers of its event: the due date or the alert's key are what make a job's rerun a no-op. */
const eventDetail = (event: AutomationEvent, target: Target, depth: number): Record<string, unknown> => ({
  depth,
  ...(target.projectId ? { projectId: target.projectId } : {}),
  ...(event.type === "due_date_reached" ? { dueDate: event.dueDate } : {}),
  ...(event.type === "quota_threshold" ? { percent: event.percent, key: event.key ?? null } : {}),
  ...(event.type === "client_decision" ? { decision: event.decision } : {}),
  ...(event.type === "state_entered" ? { stateId: event.stateId } : {}),
  ...(event.type === "field_changed" ? { fields: event.fields } : {}),
});

/**
 * A rule acts with its author's reach, not beyond it. On a private project's work it runs only while
 * whoever wrote it may run that project: a team-wide rule kept by a leader outside the project —
 * `work:manage` does not open a private project — does not reach into it, nor does a rule whose
 * author has since left the project.
 */
async function ruleMayAct(tx: Executor, rule: AutomationRow, target: Target): Promise<boolean> {
  if (target.project?.visibility !== "private") return true;
  if (!rule.createdByPersonId) return false;
  const author = (await viewersOfPeople([rule.createdByPersonId], tx)).get(rule.createdByPersonId);
  return !!author && canManageProject(author, target.project);
}

export type DroppedPerson = { action: string; personId: string };

/**
 * The people a rule names — whoever it assigns, adds as a follower, asks for a review or tells — are
 * checked against the task as it stands: someone who may not open it (a teammate outside a private
 * project, a person the rule was written for before the project closed its doors) is left out, and
 * the run records whom it left out. An action left with nobody is skipped.
 */
async function withinReach(tx: Executor, steps: PlannedAction[], target: Target): Promise<{ steps: PlannedAction[]; dropped: DroppedPerson[] }> {
  const named = steps.flatMap((step) => (step.type === "assign" ? [step.personId] : step.type === "add_follower" ? step.personIds : step.type === "request_review" ? [step.reviewerPersonId] : step.type === "notify" ? step.recipients : []));
  if (named.length === 0) return { steps, dropped: [] };
  const viewers = await viewersOfPeople(named, tx);
  const reaches = (personId: string) => {
    const viewer = viewers.get(personId);
    if (!viewer) return false;
    if (target.loaded) return canViewTask(viewer, target.loaded.facts);
    return !!target.project && canViewProject(viewer, target.project);
  };
  const dropped: DroppedPerson[] = [];
  const keep = (action: string, ids: readonly string[]) => {
    const kept: string[] = [];
    for (const personId of ids) {
      if (reaches(personId)) kept.push(personId);
      else dropped.push({ action, personId });
    }
    return kept;
  };
  const skipped = (action: string): PlannedAction => ({ type: "skip", action, reason: "no_access" });
  const checked = steps.map((step): PlannedAction => {
    switch (step.type) {
      case "assign":
        return keep(step.type, [step.personId]).length ? step : skipped(step.type);
      case "request_review":
        return keep(step.type, [step.reviewerPersonId]).length ? step : skipped(step.type);
      case "add_follower": {
        const personIds = keep(step.type, step.personIds);
        return personIds.length ? { ...step, personIds } : skipped(step.type);
      }
      case "notify": {
        const recipients = keep(step.type, step.recipients);
        return recipients.length ? { ...step, recipients } : skipped(step.type);
      }
      default:
        return step;
    }
  });
  return { steps: checked, dropped };
}

/**
 * One rule, in a savepoint; each action in one of its own. Never throws: a failure is the run's
 * outcome. null = the rule may not act here (`ruleMayAct`): no run, nothing recorded on the task.
 */
async function executeRule(tx: Tx, rule: AutomationRow, target: Target, event: AutomationEvent, depth: number): Promise<StepResult[] | null> {
  if (!(await ruleMayAct(tx, rule, target))) return null;
  const base = eventDetail(event, target, depth);
  try {
    return await tx.transaction(async (sp) => {
      const facts = await planFactsFor(sp, rule, target, event);
      const results: StepResult[] = [];
      const { steps, dropped } = await withinReach(sp, planActions(rule.actions, facts), target);
      for (const step of steps) {
        if (step.type === "skip") {
          results.push({ action: step.action, status: "skipped", reason: step.reason });
          continue;
        }
        try {
          const extra = await sp.transaction((inner) => applyStep(inner, step, rule, target, facts, depth));
          results.push({ action: step.type, status: "done", ...extra });
        } catch (error) {
          results.push({ action: step.type, status: "failed", error: error instanceof Error ? error.message : String(error) });
        }
      }
      await recordRun(sp, rule, target, event, runOutcome(results), { ...base, results, ...(dropped.length ? { dropped } : {}) });
      return results;
    });
  } catch (error) {
    const results: StepResult[] = [{ action: "rule", status: "failed", error: error instanceof Error ? error.message : String(error) }];
    await recordRun(tx, rule, target, event, "failed", { ...base, results });
    return results;
  }
}

/**
 * The rules a task event sets off, run in the caller's transaction. `depth` is how many rules deep
 * the change that caused the event already is: 0 for a person's change.
 */
export async function runTaskAutomations(tx: Executor, taskId: string, event: AutomationEvent, depth = 0): Promise<number> {
  if (!automationsMayRun(depth)) return 0;
  const first = await loadTask(taskId, tx);
  if (!first) return 0;
  const scope = { teamId: first.team.id, projectId: first.work.projectId };
  const rules = (await activeRules(tx, first.team.id)).filter((rule) => ruleCovers(rule, scope) && matchesTrigger(rule.trigger, event));
  let ran = 0;
  for (const [index, rule] of rules.entries()) {
    // An earlier rule may have changed the task: each rule reads it as it now stands.
    const loaded = index === 0 ? first : await loadTask(taskId, tx);
    if (!loaded) break;
    const labels = await tx.select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, taskId));
    const snapshot = { priority: loaded.task.priority, assigneePersonId: loaded.task.assigneePersonId, labelIds: labels.map((label) => label.labelId), channel: loaded.work.channel, contentFormat: loaded.work.contentFormat, customValues: loaded.work.customValues };
    if (!conditionsHold(rule.conditions, snapshot)) continue;
    if (await executeRule(tx as Tx, rule, targetOfTask(loaded), event, depth)) ran += 1;
  }
  return ran;
}

/**
 * A project event with no task — a retainer's quota passing a mark (FR-PJM-17) — for the projects
 * module to call inside its own transaction. The rules of the project's team (and the project's
 * own) whose mark was reached run once per `key`: the alert's own key (line and threshold), so an
 * alert raised twice sets nothing off twice.
 */
export async function fireProjectAutomations(tx: Tx, projectId: string, trigger: { type: "quota_threshold"; percent: number; key?: string | null }): Promise<number> {
  const [found] = await tx.select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(eq(schema.workProject.id, projectId)).limit(1);
  if (!found) return 0;
  const event: AutomationEvent = { type: "quota_threshold", percent: trigger.percent, key: trigger.key ?? null };
  const rules = (await activeRules(tx, found.team.id)).filter((rule) => ruleCovers(rule, { teamId: found.team.id, projectId }) && matchesTrigger(rule.trigger, event) && conditionsHold(rule.conditions, null));
  const target: Target = { loaded: null, teamId: found.team.id, projectId, entityId: found.project.entityId, projectLeadId: found.project.leadPersonId, label: found.project.name, project: projectFacts(found.project, found.team) };
  let ran = 0;
  for (const rule of rules) {
    if (trigger.key) {
      // Two alerts raised at once for the same mark wait for each other here, so the second finds
      // the first's run: the lock is the transaction's, as the due-date job's is.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${rule.id}:${projectId}:${trigger.key}`}))`);
      const [seen] = await tx
        .select({ id: schema.workAutomationRun.id })
        .from(schema.workAutomationRun)
        .where(and(eq(schema.workAutomationRun.automationId, rule.id), eq(schema.workAutomationRun.trigger, "quota_threshold"), sql`${schema.workAutomationRun.detail} ->> 'key' = ${trigger.key}`, sql`${schema.workAutomationRun.detail} ->> 'projectId' = ${projectId}`))
        .limit(1);
      if (seen) continue;
    }
    if (await executeRule(tx, rule, target, event, 0)) ran += 1;
  }
  return ran;
}

/**
 * The morning's "due date reached" rules: open tasks whose due date is `days` behind today (0 = due
 * today, 1 = a day overdue), catching up on a missed morning or two. Each rule runs once per task
 * and due date — a run is looked for under a lock first, so the job repeating does nothing, and a
 * task moved to a new due date is due again.
 */
export async function runDueDateAutomations(today: IsoDate): Promise<{ dueRuns: number }> {
  // The job may read the rules from the cache: each run re-reads its own rule's `isActive` under
  // the lock below before it acts.
  const rules = (await allAutomations()).filter((rule) => rule.isActive && rule.trigger.type === "due_date_reached");
  let dueRuns = 0;
  for (const rule of rules) {
    const latest = addDays(today, -(rule.trigger.days ?? 0));
    const tasks = await db()
      .select({ id: schema.task.id, dueDate: schema.task.dueDate })
      .from(schema.task)
      .innerJoin(schema.workTask, eq(schema.workTask.taskId, schema.task.id))
      .where(
        and(
          eq(schema.workTask.teamId, rule.teamId),
          rule.projectId ? eq(schema.workTask.projectId, rule.projectId) : undefined,
          isNull(schema.task.deletedAt),
          inArray(schema.task.status, [...OPEN]),
          // Work still waiting in triage is nobody's yet.
          or(isNull(schema.workTask.triageStatus), sql`${schema.workTask.triageStatus} not in ('pending', 'snoozed')`),
          gte(schema.task.dueDate, addDays(latest, -DUE_CATCH_UP_DAYS)),
          lte(schema.task.dueDate, latest),
        ),
      );
    for (const task of tasks) {
      const ran = await db().transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`${rule.id}:${task.id}`}))`);
        const [seen] = await tx
          .select({ id: schema.workAutomationRun.id })
          .from(schema.workAutomationRun)
          .where(and(eq(schema.workAutomationRun.automationId, rule.id), eq(schema.workAutomationRun.taskId, task.id), eq(schema.workAutomationRun.trigger, "due_date_reached"), sql`${schema.workAutomationRun.detail} ->> 'dueDate' = ${task.dueDate}`))
          .limit(1);
        if (seen) return false;
        const [current] = await tx.select({ isActive: schema.workAutomation.isActive }).from(schema.workAutomation).where(eq(schema.workAutomation.id, rule.id)).limit(1);
        const loaded = await loadTask(task.id, tx);
        if (!current?.isActive || !loaded) return false;
        const labels = await tx.select({ labelId: schema.workTaskLabel.labelId }).from(schema.workTaskLabel).where(eq(schema.workTaskLabel.taskId, task.id));
        if (!conditionsHold(rule.conditions, { priority: loaded.task.priority, assigneePersonId: loaded.task.assigneePersonId, labelIds: labels.map((label) => label.labelId), channel: loaded.work.channel, contentFormat: loaded.work.contentFormat, customValues: loaded.work.customValues })) return false;
        return !!(await executeRule(tx, rule, targetOfTask(loaded), { type: "due_date_reached", dueDate: task.dueDate! }, 0));
      });
      if (ran) dueRuns += 1;
    }
  }
  // Each run bumped its rule's counter: drop the entry once the last one is committed.
  if (dueRuns > 0) await invalidateAutomations();
  return { dueRuns };
}

// ── What the automation screens show ────────────────────────────────────────────────────────

export type AutomationPanel = {
  rules: (Pick<AutomationRow, "id" | "name" | "projectId" | "trigger" | "conditions" | "actions" | "isActive" | "runCount"> & { projectName: string | null; lastRunAt: string | null })[];
  options: { states: { id: string; name: string }[]; labels: { id: string; name: string }[]; people: { id: string; fullName: string }[]; fields: { id: string; name: string; options: { id: string; label: string }[] }[]; templates: { id: string; name: string }[] };
  runs: { id: string; ruleName: string; taskId: string | null; taskKey: string | null; taskTitle: string | null; outcome: string; createdAt: string; failure: string | null }[];
};

/**
 * The rules of a team (every project's own included) or of one project (with the team's it
 * inherits), everything the builder may name, and the latest runs — on a project's page, the runs
 * on that project only. The page has checked `canViewAutomations`; a run on a task the viewer may
 * not open (a private project) shows no task, and the rules of a project the viewer may not open
 * are not listed at all — their names and texts are that project's.
 */
export async function automationPanel(scope: { teamId: string; projectId: string | null }, viewer: WorkViewer): Promise<AutomationPanel> {
  const [allRules, states, labels, fields, templates, people, projects] = await Promise.all([
    listAutomations({ teamId: scope.teamId, projectId: scope.projectId ?? undefined }),
    listStates([scope.teamId]),
    listLabels([scope.teamId]),
    listCustomFields({ teamId: scope.teamId, projectId: scope.projectId, withProjects: !scope.projectId }),
    listTaskTemplates(scope.teamId),
    listAssignable(scope.teamId, scope.projectId),
    db().select({ project: schema.workProject, team: schema.workTeam }).from(schema.workProject).innerJoin(schema.workTeam, eq(schema.workTeam.id, schema.workProject.teamId)).where(eq(schema.workProject.teamId, scope.teamId)),
  ]);
  const opens = new Set(projects.filter(({ project, team }) => canViewProject(viewer, projectFacts(project, team))).map(({ project }) => project.id));
  const rules = allRules.filter((rule) => !rule.projectId || opens.has(rule.projectId));
  // A rule's definition is reference data and comes from the cache; how often it has run is not —
  // `recordRun` bumps it inside the transaction of whatever set the rule off, which this file
  // cannot invalidate after. So the two tallies the panel shows are read as they stand.
  const [runs, tallies] = await Promise.all([
    listAutomationRuns(rules.map((rule) => rule.id), scope.projectId ? 100 : 30).then((rows) => rows.filter((run) => !scope.projectId || run.detail.projectId === scope.projectId).slice(0, 30)),
    rules.length ? db().select({ id: schema.workAutomation.id, runCount: schema.workAutomation.runCount, lastRunAt: schema.workAutomation.lastRunAt }).from(schema.workAutomation).where(inArray(schema.workAutomation.id, rules.map((rule) => rule.id))) : [],
  ]);
  const tallyOf = new Map(tallies.map((row) => [row.id, row]));
  const tasks = await loadTasks(runs.flatMap((run) => (run.taskId ? [run.taskId] : [])));
  const visible = (taskId: string | null) => !!taskId && !!tasks.get(taskId) && canViewTask(viewer, tasks.get(taskId)!.facts);
  const ruleName = new Map(rules.map((rule) => [rule.id, rule.name]));
  const failureOf = (detail: Record<string, unknown>) => {
    const results = (detail.results ?? []) as { status?: string; error?: string }[];
    return results.find((result) => result.status === "failed")?.error ?? null;
  };
  return {
    rules: rules.map((rule) => ({ id: rule.id, name: rule.name, projectId: rule.projectId, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions, isActive: rule.isActive, runCount: tallyOf.get(rule.id)?.runCount ?? rule.runCount, projectName: rule.projectId && !scope.projectId ? (projects.find(({ project }) => project.id === rule.projectId)?.project.name ?? null) : null, lastRunAt: (tallyOf.get(rule.id)?.lastRunAt ?? rule.lastRunAt)?.toISOString() ?? null })),
    options: {
      states: states.filter((state) => state.isActive).map((state) => ({ id: state.id, name: state.name })),
      labels: labels.map((label) => ({ id: label.id, name: label.name })),
      people,
      fields: fields.filter((field) => field.isActive).map((field) => ({ id: field.id, name: field.name, options: (field.options ?? []).map((option) => ({ id: option.id, label: option.label })) })),
      templates,
    },
    runs: runs.map((run) => {
      const shown = visible(run.taskId);
      return { id: run.id, ruleName: ruleName.get(run.automationId) ?? "", taskId: shown ? run.taskId : null, taskKey: shown ? run.taskKey : null, taskTitle: shown ? run.taskTitle : null, outcome: run.outcome, createdAt: run.createdAt.toISOString(), failure: failureOf(run.detail) };
    }),
  };
}
