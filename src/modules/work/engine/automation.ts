// Automations (FR-PJM-33): "when <trigger> [and <conditions>] then <actions>", per team or per
// project. Pure: which rules an event sets off, whether their conditions hold for the task, what
// each action would do — the service runs the plan inside the transaction of the change that set
// it off, one savepoint per rule and per action.
//
// A change made by a rule may set off rules itself, one level deep only: the person's change runs
// at depth 0, a rule's change at depth 1 still sets rules off, and what those rules change (depth 2)
// sets off nothing. Two rules feeding each other stop after one round instead of looping.
import { addDays, type IsoDate } from "@/lib/dates";
import type { StateCategory } from "../enums";
import type { AutomationAction, AutomationCondition, AutomationTrigger, CustomFieldValue } from "../schema";
import { CUSTOM_PREFIX } from "./custom-fields";

export const AUTOMATION_TRIGGERS = ["state_entered", "field_changed", "due_date_reached", "all_subtasks_done", "deliverable_approved", "changes_requested", "client_decision", "handoff_accepted", "handoff_returned", "quota_threshold"] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGERS)[number];

/** The fields a condition can test. A custom field is `cf.<fieldId>`. */
export const CONDITION_FIELDS = ["priority", "assignee", "label", "channel", "contentFormat"] as const;
/** The fields whose change is a trigger: the condition fields and the dates and people around them. */
export const WATCHED_FIELDS = [...CONDITION_FIELDS, "dueDate", "reviewer", "cycle"] as const;
export const CONDITION_OPS = ["eq", "neq", "set", "unset"] as const;
export type ConditionOp = (typeof CONDITION_OPS)[number];

export const AUTOMATION_ACTIONS = ["move_state", "assign", "add_label", "add_follower", "set_due", "create_task", "request_review", "notify", "comment"] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTIONS)[number];

/** Whom an action can name instead of a person: resolved on the task when the rule runs. */
export const PERSON_ROLES = ["role:assignee", "role:requester", "role:assignee_of_parent", "role:lead"] as const;
export type PersonRole = (typeof PERSON_ROLES)[number];
/** The people each action may name by role. */
export const ROLES_FOR: Record<"assign" | "add_follower" | "request_review" | "notify", readonly PersonRole[]> = {
  assign: ["role:assignee_of_parent", "role:requester"],
  add_follower: ["role:requester", "role:assignee_of_parent", "role:lead"],
  request_review: ["role:requester", "role:lead"],
  notify: ["role:assignee", "role:requester", "role:assignee_of_parent", "role:lead"],
};

/** Client decisions a rule can wait for (FR-PJM-51). */
export const CLIENT_DECISIONS = ["approved", "approved_with_changes", "changes_required"] as const;
/** Retainer quota marks the projects module raises alerts at (FR-PJM-17). */
export const QUOTA_PERCENTS = [80, 100] as const;

export const MAX_AUTOMATION_DEPTH = 1;
export const MAX_RULE_ACTIONS = 8;
export const MAX_RULE_CONDITIONS = 6;
/** How far back the morning job still catches a due date it missed (a day the job did not run). */
export const DUE_CATCH_UP_DAYS = 2;

/** May rules run for a change made at this depth? */
export const automationsMayRun = (depth: number): boolean => depth <= MAX_AUTOMATION_DEPTH;

// ── Events and matching ─────────────────────────────────────────────────────────────────────

export type AutomationEvent =
  /** `handedOff`: the move was a stage hand-off (FR-PJM-40) — the sender chose who takes the task. */
  | { type: "state_entered"; stateId: string; handedOff?: boolean }
  | { type: "field_changed"; fields: readonly string[] }
  | { type: "due_date_reached"; dueDate: IsoDate }
  | { type: "all_subtasks_done" }
  | { type: "deliverable_approved" }
  | { type: "changes_requested" }
  | { type: "client_decision"; decision: string }
  | { type: "handoff_accepted" }
  | { type: "handoff_returned" }
  | { type: "quota_threshold"; percent: number; key?: string | null };

/** Does the rule's trigger answer this event? */
export function matchesTrigger(trigger: AutomationTrigger, event: AutomationEvent): boolean {
  if (trigger.type !== event.type) return false;
  switch (event.type) {
    case "state_entered":
      return !!trigger.stateId && trigger.stateId === event.stateId;
    case "field_changed":
      return !!trigger.field && event.fields.includes(trigger.field);
    case "client_decision":
      return !trigger.decision || trigger.decision === event.decision;
    case "quota_threshold":
      // A quota that jumped past the rule's mark (80 → 100 in one day) still sets it off.
      return event.percent >= (trigger.percent ?? 100);
    default:
      return true;
  }
}

/** The fields an update touched, as triggers name them, from its activity entries. */
export function changedFields(entries: readonly { type: string; field?: string | null }[]): string[] {
  const fields = new Set<string>();
  for (const entry of entries) {
    if (entry.type === "field_changed" && entry.field) fields.add(entry.field);
    else if (entry.type === "label_added" || entry.type === "label_removed") fields.add("label");
    else if (entry.type === "custom_field_changed" && entry.field) fields.add(`${CUSTOM_PREFIX}${entry.field}`);
  }
  return [...fields];
}

/** A rule applies to a task of its team — only to tasks of its project, when it names one. */
export const ruleCovers = (rule: { teamId: string; projectId: string | null }, scope: { teamId: string; projectId: string | null }): boolean => rule.teamId === scope.teamId && (rule.projectId === null || rule.projectId === scope.projectId);

// ── Conditions ──────────────────────────────────────────────────────────────────────────────

/** What conditions read of a task. */
export type TaskSnapshot = {
  priority: number | null;
  assigneePersonId: string | null;
  labelIds: readonly string[];
  channel: string | null;
  contentFormat: string | null;
  customValues: Readonly<Record<string, CustomFieldValue>>;
};

const isBlank = (value: unknown) => value === null || value === undefined || value === "" || value === false || (Array.isArray(value) && value.length === 0);

function valueOf(task: TaskSnapshot, field: string): CustomFieldValue | readonly string[] {
  switch (field) {
    case "priority":
      return task.priority;
    case "assignee":
      return task.assigneePersonId;
    case "label":
      return task.labelIds;
    case "channel":
      return task.channel;
    case "contentFormat":
      return task.contentFormat;
    default:
      return field.startsWith(CUSTOM_PREFIX) ? (task.customValues[field.slice(CUSTOM_PREFIX.length)] ?? null) : null;
  }
}

/** One condition. A list value (labels, a multi-select) "equals" a value it contains. */
export function conditionHolds(condition: AutomationCondition, task: TaskSnapshot): boolean {
  const value = valueOf(task, condition.field);
  if (condition.op === "set") return !isBlank(value);
  if (condition.op === "unset") return isBlank(value);
  const wanted = condition.value === null || condition.value === undefined ? null : String(condition.value);
  const equal = Array.isArray(value) ? wanted !== null && value.map(String).includes(wanted) : isBlank(value) ? wanted === null || wanted === "" : String(value) === wanted;
  return condition.op === "eq" ? equal : !equal;
}

/** Every condition must hold. An event without a task (a quota alert) passes only a rule with none. */
export function conditionsHold(conditions: readonly AutomationCondition[], task: TaskSnapshot | null): boolean {
  if (conditions.length === 0) return true;
  return !!task && conditions.every((condition) => conditionHolds(condition, task));
}

// ── Working days ────────────────────────────────────────────────────────────────────────────

const weekday = (date: IsoDate) => new Date(`${date}T00:00:00Z`).getUTCDay();
/** Saturdays, Sundays and the entity's days off: the office calendar. */
export const officeDayOff =
  (daysOff: ReadonlySet<IsoDate>) =>
  (date: IsoDate): boolean =>
    weekday(date) === 0 || weekday(date) === 6 || daysOff.has(date);

/**
 * `count` working days after `date` (0 = the date itself, moved to the next working day when it is
 * a day off). The bound keeps a broken calendar from spinning.
 */
export function addWorkingDays(date: IsoDate, count: number, isDayOff: (date: IsoDate) => boolean): IsoDate {
  let cursor = date;
  for (let guard = 0; isDayOff(cursor) && guard < 60; guard++) cursor = addDays(cursor, 1);
  for (let left = Math.max(0, Math.trunc(count)), guard = 0; left > 0 && guard < 3660; guard++) {
    cursor = addDays(cursor, 1);
    if (!isDayOff(cursor)) left -= 1;
  }
  return cursor;
}

// ── Planning the actions ────────────────────────────────────────────────────────────────────

export type PlanFacts = {
  today: IsoDate;
  isDayOff: (date: IsoDate) => boolean;
  /** Null for an event without a task (a quota alert on a project). */
  task: (TaskSnapshot & { stateId: string; dueDate: IsoDate | null; requesterPersonId: string | null; parentAssigneePersonId: string | null; reviewerPersonId: string | null }) | null;
  /** The team's leads and the project's lead: "the lead" of a notice or a review. */
  leadIds: readonly string[];
  /**
   * The change came with a hand-off: whoever handed the task on named its receiver (the stage's
   * rule was only the sheet's suggestion), so a rule does not assign it over their choice.
   */
  handedOff?: boolean;
};

export type SkipReason = "no_task" | "no_person" | "unchanged" | "invalid" | "handed_off";
export type PlannedAction =
  | { type: "move_state"; stateId: string }
  | { type: "assign"; personId: string }
  | { type: "add_label"; labelIds: string[]; labelId: string }
  | { type: "add_follower"; personIds: string[] }
  | { type: "set_due"; dueDate: IsoDate }
  | { type: "create_task"; templateId: string }
  | { type: "request_review"; reviewerPersonId: string; text: string | null }
  | { type: "notify"; recipients: string[]; text: string }
  | { type: "comment"; text: string }
  | { type: "skip"; action: string; reason: SkipReason };

const TASKLESS: readonly string[] = ["notify", "create_task"];

/** The people an action names, on the task as the rule has left it so far. */
function peopleFor(target: { personId?: string; to?: string }, facts: PlanFacts, task: PlanFacts["task"]): string[] {
  if (target.personId) return [target.personId];
  switch (target.to) {
    case "role:assignee":
      return task?.assigneePersonId ? [task.assigneePersonId] : [];
    case "role:requester":
      return task?.requesterPersonId ? [task.requesterPersonId] : [];
    case "role:assignee_of_parent":
      return task?.parentAssigneePersonId ? [task.parentAssigneePersonId] : [];
    case "role:lead":
      return [...new Set(facts.leadIds)];
    default:
      return [];
  }
}

/**
 * What each action of a rule would do to the task as it stands, in order: a later action sees
 * what an earlier one did (two "add label" actions keep both labels). An action with nothing to do
 * — the task is already in the state, the role names nobody — is a skip with its reason, not a
 * failure.
 */
export function planActions(actions: readonly AutomationAction[], facts: PlanFacts): PlannedAction[] {
  const task = facts.task ? { ...facts.task, labelIds: [...facts.task.labelIds] } : null;
  const plan: PlannedAction[] = [];
  const skip = (action: AutomationAction, reason: SkipReason) => plan.push({ type: "skip", action: action.type, reason });
  for (const action of actions) {
    if (!task && !TASKLESS.includes(action.type)) {
      skip(action, "no_task");
      continue;
    }
    switch (action.type) {
      case "move_state":
        if (!action.stateId) skip(action, "invalid");
        else if (action.stateId === task!.stateId) skip(action, "unchanged");
        else {
          plan.push({ type: "move_state", stateId: action.stateId });
          task!.stateId = action.stateId;
        }
        break;
      case "assign": {
        const [personId] = peopleFor(action, facts, task);
        if (facts.handedOff) skip(action, "handed_off");
        else if (!personId) skip(action, "no_person");
        else if (personId === task!.assigneePersonId) skip(action, "unchanged");
        else {
          plan.push({ type: "assign", personId });
          task!.assigneePersonId = personId;
        }
        break;
      }
      case "add_label":
        if (!action.labelId) skip(action, "invalid");
        else if (task!.labelIds.includes(action.labelId)) skip(action, "unchanged");
        else {
          task!.labelIds.push(action.labelId);
          plan.push({ type: "add_label", labelIds: [...task!.labelIds], labelId: action.labelId });
        }
        break;
      case "add_follower": {
        const personIds = peopleFor(action, facts, task);
        if (personIds.length === 0) skip(action, "no_person");
        else plan.push({ type: "add_follower", personIds });
        break;
      }
      case "set_due": {
        const days = action.days ?? 0;
        if (!Number.isInteger(days) || days < 0) {
          skip(action, "invalid");
          break;
        }
        const dueDate = addWorkingDays(facts.today, days, facts.isDayOff);
        if (dueDate === task!.dueDate) skip(action, "unchanged");
        else {
          plan.push({ type: "set_due", dueDate });
          task!.dueDate = dueDate;
        }
        break;
      }
      case "create_task":
        if (action.templateId) plan.push({ type: "create_task", templateId: action.templateId });
        else skip(action, "invalid");
        break;
      case "request_review": {
        const [reviewerPersonId] = action.personId || action.to ? peopleFor(action, facts, task) : [task!.reviewerPersonId ?? facts.leadIds[0]].filter((id): id is string => !!id);
        if (!reviewerPersonId) skip(action, "no_person");
        else plan.push({ type: "request_review", reviewerPersonId, text: action.text?.trim() || null });
        break;
      }
      case "notify": {
        const text = action.text?.trim();
        const recipients = peopleFor(action.personId || action.to ? action : { to: "role:assignee" }, facts, task);
        if (!text) skip(action, "invalid");
        else if (recipients.length === 0) skip(action, "no_person");
        else plan.push({ type: "notify", recipients, text });
        break;
      }
      case "comment": {
        const text = action.text?.trim();
        if (text) plan.push({ type: "comment", text });
        else skip(action, "invalid");
        break;
      }
      default:
        skip(action, "invalid");
    }
  }
  return plan;
}

/** ok = every action did something or had nothing to do; failed = one of them broke; skipped = none had anything to do. */
export function runOutcome(results: readonly { status: "done" | "skipped" | "failed" }[]): "ok" | "skipped" | "failed" {
  if (results.some((result) => result.status === "failed")) return "failed";
  return results.length > 0 && results.every((result) => result.status === "skipped") ? "skipped" : "ok";
}

// ── Checking a rule a lead wrote ────────────────────────────────────────────────────────────

export type RuleInput = { name: string; trigger: AutomationTrigger; conditions: AutomationCondition[]; actions: AutomationAction[] };
/** What the rule may name: the team's (and project's) states, labels, custom fields and task templates. */
export type RuleContext = { stateIds: ReadonlySet<string>; labelIds: ReadonlySet<string>; customFieldIds: ReadonlySet<string>; templateIds: ReadonlySet<string> };

const knownField = (field: string, context: RuleContext, allowed: readonly string[]) => allowed.includes(field) || (field.startsWith(CUSTOM_PREFIX) && context.customFieldIds.has(field.slice(CUSTOM_PREFIX.length)));

/** The first thing wrong with a rule, as an error key; null = it may be saved. */
export function ruleProblem(input: RuleInput, context: RuleContext): string | null {
  if (!input.name.trim()) return "automation_name_required";
  const trigger = input.trigger;
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(trigger.type)) return "automation_trigger_invalid";
  if (trigger.type === "state_entered" && (!trigger.stateId || !context.stateIds.has(trigger.stateId))) return "automation_state_invalid";
  if (trigger.type === "field_changed" && (!trigger.field || !knownField(trigger.field, context, WATCHED_FIELDS))) return "automation_field_invalid";
  if (trigger.type === "client_decision" && trigger.decision && !(CLIENT_DECISIONS as readonly string[]).includes(trigger.decision)) return "automation_trigger_invalid";
  if (trigger.type === "quota_threshold" && !(QUOTA_PERCENTS as readonly number[]).includes(trigger.percent ?? -1)) return "automation_trigger_invalid";
  if (trigger.type === "due_date_reached" && trigger.days !== undefined && (!Number.isInteger(trigger.days) || trigger.days < 0 || trigger.days > 30)) return "automation_trigger_invalid";

  if (input.conditions.length > MAX_RULE_CONDITIONS) return "automation_too_many";
  // A quota alert is about a project, not a task: there is nothing for a condition to test.
  if (trigger.type === "quota_threshold" && input.conditions.length > 0) return "automation_condition_invalid";
  for (const condition of input.conditions) {
    if (!knownField(condition.field, context, CONDITION_FIELDS) || !(CONDITION_OPS as readonly string[]).includes(condition.op)) return "automation_condition_invalid";
    if ((condition.op === "eq" || condition.op === "neq") && (condition.value === null || condition.value === undefined || condition.value === "")) return "automation_condition_invalid";
    if (condition.field === "label" && (condition.op === "eq" || condition.op === "neq") && !context.labelIds.has(String(condition.value))) return "automation_condition_invalid";
  }

  if (input.actions.length === 0) return "automation_action_required";
  if (input.actions.length > MAX_RULE_ACTIONS) return "automation_too_many";
  for (const action of input.actions) {
    if (!(AUTOMATION_ACTIONS as readonly string[]).includes(action.type)) return "automation_action_invalid";
    if (trigger.type === "quota_threshold" && !TASKLESS.includes(action.type)) return "automation_action_needs_task";
    const role = (roles: readonly string[]) => (action.to ? roles.includes(action.to) : true);
    switch (action.type) {
      case "move_state":
        if (!action.stateId || !context.stateIds.has(action.stateId)) return "automation_state_invalid";
        break;
      case "assign":
        if (!(action.personId || action.to) || !role(ROLES_FOR.assign)) return "automation_person_required";
        break;
      case "add_follower":
        if (!(action.personId || action.to) || !role(ROLES_FOR.add_follower)) return "automation_person_required";
        break;
      case "request_review":
        if (!role(ROLES_FOR.request_review)) return "automation_person_required";
        break;
      case "add_label":
        if (!action.labelId || !context.labelIds.has(action.labelId)) return "automation_label_invalid";
        break;
      case "set_due":
        if (!Number.isInteger(action.days) || action.days! < 0 || action.days! > 90) return "automation_days_invalid";
        break;
      case "create_task":
        if (!action.templateId || !context.templateIds.has(action.templateId)) return "automation_template_invalid";
        break;
      case "notify":
        if (!action.text?.trim()) return "automation_text_required";
        if (!role(trigger.type === "quota_threshold" ? ["role:lead"] : ROLES_FOR.notify)) return "automation_person_required";
        if (trigger.type === "quota_threshold" && !action.personId && action.to !== "role:lead") return "automation_person_required";
        break;
      case "comment":
        if (!action.text?.trim()) return "automation_text_required";
        break;
    }
  }
  return null;
}

// ── Starter rules (one click) ───────────────────────────────────────────────────────────────

export const AUTOMATION_PRESETS = ["client_review_due", "client_changes_reopen", "overdue_notify_lead"] as const;
export type AutomationPreset = (typeof AUTOMATION_PRESETS)[number];

type PresetState = { id: string; category: StateCategory; sortOrder: number; isActive: boolean };

/**
 * The common agency rules, fitted to the team's workflow: "Client review" is the last review state
 * (Internal review → Client review), and "back to work" the last working state before the first
 * review (Edit). A preset the workflow cannot carry — no review state — is null. The texts are the
 * caller's, in the lead's language.
 */
export function presetRule(preset: AutomationPreset, states: readonly PresetState[], texts: { name: string; text: string }): RuleInput | null {
  const list = states.filter((state) => state.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const reviews = list.filter((state) => state.category === "in_review");
  const firstReview = list.findIndex((state) => state.category === "in_review");
  const working = firstReview > 0 ? list.slice(0, firstReview).reverse().find((state) => state.category === "in_progress") : undefined;
  switch (preset) {
    case "client_review_due": {
      const clientReview = reviews.at(-1);
      return clientReview ? { name: texts.name, trigger: { type: "state_entered", stateId: clientReview.id }, conditions: [], actions: [{ type: "set_due", days: 2 }] } : null;
    }
    case "client_changes_reopen":
      return working ? { name: texts.name, trigger: { type: "client_decision", decision: "changes_required" }, conditions: [], actions: [{ type: "move_state", stateId: working.id }, { type: "notify", to: "role:assignee", text: texts.text }] } : null;
    case "overdue_notify_lead":
      return { name: texts.name, trigger: { type: "due_date_reached", days: 1 }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: texts.text }] };
  }
}
