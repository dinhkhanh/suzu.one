import { describe, expect, it } from "vitest";
import type { AutomationAction } from "../schema";
import { addWorkingDays, automationsMayRun, changedFields, conditionHolds, conditionsHold, matchesTrigger, officeDayOff, type PlanFacts, planActions, presetRule, ruleCovers, type RuleContext, ruleProblem, runOutcome, type TaskSnapshot } from "./automation";

const task: TaskSnapshot = { priority: 2, assigneePersonId: "huy", labelIds: ["urgent"], channel: "tiktok", contentFormat: null, customValues: { f1: "gold", f2: ["a", "b"], f3: false } };
// 2026-09-02 (Wednesday) is National Day's second day off in this calendar.
const isDayOff = officeDayOff(new Set(["2026-09-02"]));
const facts = (overrides: Partial<NonNullable<PlanFacts["task"]>> = {}, extra: Partial<PlanFacts> = {}): PlanFacts => ({
  today: "2026-09-18",
  isDayOff,
  leadIds: ["long", "tam"],
  task: { ...task, stateId: "edit", dueDate: null, requesterPersonId: "lan", parentAssigneePersonId: "bao", reviewerPersonId: null, ...overrides },
  ...extra,
});

describe("triggers", () => {
  it("match on the state entered, the field changed, the client's decision and the quota mark", () => {
    expect(matchesTrigger({ type: "state_entered", stateId: "client" }, { type: "state_entered", stateId: "client" })).toBe(true);
    expect(matchesTrigger({ type: "state_entered", stateId: "client" }, { type: "state_entered", stateId: "edit" })).toBe(false);
    expect(matchesTrigger({ type: "state_entered" }, { type: "state_entered", stateId: "edit" })).toBe(false);
    expect(matchesTrigger({ type: "field_changed", field: "assignee" }, { type: "field_changed", fields: ["dueDate", "assignee"] })).toBe(true);
    expect(matchesTrigger({ type: "field_changed", field: "priority" }, { type: "field_changed", fields: ["dueDate"] })).toBe(false);
    expect(matchesTrigger({ type: "client_decision", decision: "changes_required" }, { type: "client_decision", decision: "changes_required" })).toBe(true);
    expect(matchesTrigger({ type: "client_decision", decision: "changes_required" }, { type: "client_decision", decision: "approved" })).toBe(false);
    expect(matchesTrigger({ type: "client_decision" }, { type: "client_decision", decision: "approved" })).toBe(true);
    // A quota that jumped straight past 80 still reaches the 80 rule; the 100 rule waits.
    expect(matchesTrigger({ type: "quota_threshold", percent: 80 }, { type: "quota_threshold", percent: 100 })).toBe(true);
    expect(matchesTrigger({ type: "quota_threshold", percent: 100 }, { type: "quota_threshold", percent: 80 })).toBe(false);
    expect(matchesTrigger({ type: "handoff_returned" }, { type: "handoff_accepted" })).toBe(false);
    expect(matchesTrigger({ type: "all_subtasks_done" }, { type: "all_subtasks_done" })).toBe(true);
  });

  it("read the fields a change touched from its activity", () => {
    expect(changedFields([{ type: "field_changed", field: "state" }, { type: "field_changed", field: "assignee" }, { type: "label_added" }, { type: "label_removed" }, { type: "custom_field_changed", field: "f1" }, { type: "person_added" }])).toEqual(["state", "assignee", "label", "cf.f1"]);
  });

  it("cover their team, and only their project when they name one", () => {
    expect(ruleCovers({ teamId: "vid", projectId: null }, { teamId: "vid", projectId: "tet" })).toBe(true);
    expect(ruleCovers({ teamId: "vid", projectId: "tet" }, { teamId: "vid", projectId: "tet" })).toBe(true);
    expect(ruleCovers({ teamId: "vid", projectId: "tet" }, { teamId: "vid", projectId: null })).toBe(false);
    expect(ruleCovers({ teamId: "vid", projectId: null }, { teamId: "soc", projectId: null })).toBe(false);
  });

  it("go one level deep only", () => {
    expect([0, 1, 2].map(automationsMayRun)).toEqual([true, true, false]);
  });
});

describe("conditions", () => {
  it("compare, and test for set and unset, on every kind of field", () => {
    expect(conditionHolds({ field: "priority", op: "eq", value: 2 }, task)).toBe(true);
    expect(conditionHolds({ field: "priority", op: "eq", value: "2" }, task)).toBe(true);
    expect(conditionHolds({ field: "priority", op: "neq", value: 1 }, task)).toBe(true);
    expect(conditionHolds({ field: "assignee", op: "eq", value: "huy" }, task)).toBe(true);
    expect(conditionHolds({ field: "assignee", op: "unset" }, task)).toBe(false);
    expect(conditionHolds({ field: "label", op: "eq", value: "urgent" }, task)).toBe(true);
    expect(conditionHolds({ field: "label", op: "neq", value: "urgent" }, task)).toBe(false);
    expect(conditionHolds({ field: "label", op: "unset" }, { ...task, labelIds: [] })).toBe(true);
    expect(conditionHolds({ field: "channel", op: "eq", value: "tiktok" }, task)).toBe(true);
    expect(conditionHolds({ field: "contentFormat", op: "set" }, task)).toBe(false);
    expect(conditionHolds({ field: "contentFormat", op: "neq", value: "tvc" }, task)).toBe(true);
    expect(conditionHolds({ field: "cf.f1", op: "eq", value: "gold" }, task)).toBe(true);
    expect(conditionHolds({ field: "cf.f2", op: "eq", value: "b" }, task)).toBe(true);
    // An unticked checkbox and a missing value are both "not set".
    expect(conditionHolds({ field: "cf.f3", op: "unset" }, task)).toBe(true);
    expect(conditionHolds({ field: "cf.missing", op: "unset" }, task)).toBe(true);
  });

  it("must all hold; a task-less event passes only a rule without conditions", () => {
    expect(conditionsHold([{ field: "priority", op: "eq", value: 2 }, { field: "channel", op: "eq", value: "tiktok" }], task)).toBe(true);
    expect(conditionsHold([{ field: "priority", op: "eq", value: 2 }, { field: "channel", op: "eq", value: "youtube" }], task)).toBe(false);
    expect(conditionsHold([], null)).toBe(true);
    expect(conditionsHold([{ field: "priority", op: "set" }], null)).toBe(false);
  });
});

describe("working days", () => {
  it("skip weekends and the entity's days off", () => {
    // Friday + 2 working days = Tuesday.
    expect(addWorkingDays("2026-09-18", 2, isDayOff)).toBe("2026-09-22");
    // Monday 31/8 + 2: Tuesday 1/9, (Wednesday 2/9 off), Thursday 3/9.
    expect(addWorkingDays("2026-08-31", 2, isDayOff)).toBe("2026-09-03");
    // Zero days from a Saturday is the Monday.
    expect(addWorkingDays("2026-09-19", 0, isDayOff)).toBe("2026-09-21");
    expect(addWorkingDays("2026-09-18", 0, isDayOff)).toBe("2026-09-18");
  });
});

describe("planning the actions", () => {
  it("resolves people by role and dates by working days, a later action seeing an earlier one", () => {
    const actions: AutomationAction[] = [
      { type: "assign", to: "role:assignee_of_parent" },
      { type: "add_label", labelId: "client" },
      { type: "add_label", labelId: "late" },
      { type: "set_due", days: 2 },
      { type: "move_state", stateId: "client" },
      { type: "add_follower", to: "role:lead" },
      { type: "notify", text: "  Khách đang xem  " },
      { type: "comment", text: "Đã gửi khách" },
      { type: "create_task", templateId: "tpl" },
      { type: "request_review", to: "role:requester" },
    ];
    expect(planActions(actions, facts())).toEqual([
      { type: "assign", personId: "bao" },
      { type: "add_label", labelIds: ["urgent", "client"], labelId: "client" },
      { type: "add_label", labelIds: ["urgent", "client", "late"], labelId: "late" },
      { type: "set_due", dueDate: "2026-09-22" },
      { type: "move_state", stateId: "client" },
      { type: "add_follower", personIds: ["long", "tam"] },
      // A notice goes to the assignee unless the rule says otherwise — the one just assigned.
      { type: "notify", recipients: ["bao"], text: "Khách đang xem" },
      { type: "comment", text: "Đã gửi khách" },
      { type: "create_task", templateId: "tpl" },
      { type: "request_review", reviewerPersonId: "lan", text: null },
    ]);
  });

  it("skips what has nothing to do, with the reason", () => {
    const plan = planActions(
      [
        { type: "move_state", stateId: "edit" },
        { type: "assign", personId: "huy" },
        { type: "add_label", labelId: "urgent" },
        { type: "assign", to: "role:requester" },
        { type: "notify", text: "   " },
        { type: "set_due", days: -1 },
      ],
      facts({ requesterPersonId: null }),
    );
    expect(plan).toEqual([
      { type: "skip", action: "move_state", reason: "unchanged" },
      { type: "skip", action: "assign", reason: "unchanged" },
      { type: "skip", action: "add_label", reason: "unchanged" },
      { type: "skip", action: "assign", reason: "no_person" },
      { type: "skip", action: "notify", reason: "invalid" },
      { type: "skip", action: "set_due", reason: "invalid" },
    ]);
  });

  it("does not reassign a task its sender just handed on to someone they chose", () => {
    const plan = planActions([{ type: "assign", personId: "tam" }, { type: "set_due", days: 1 }], facts({}, { handedOff: true }));
    expect(plan).toEqual([{ type: "skip", action: "assign", reason: "handed_off" }, { type: "set_due", dueDate: "2026-09-21" }]);
  });

  it("on a project event without a task, only notices and new tasks", () => {
    const plan = planActions([{ type: "move_state", stateId: "x" }, { type: "notify", to: "role:lead", text: "80% quota" }, { type: "create_task", templateId: "tpl" }], facts({}, { task: null }));
    expect(plan).toEqual([{ type: "skip", action: "move_state", reason: "no_task" }, { type: "notify", recipients: ["long", "tam"], text: "80% quota" }, { type: "create_task", templateId: "tpl" }]);
  });

  it("sums a run up: failed beats done, all skipped is skipped", () => {
    expect(runOutcome([{ status: "done" }, { status: "skipped" }])).toBe("ok");
    expect(runOutcome([{ status: "done" }, { status: "failed" }])).toBe("failed");
    expect(runOutcome([{ status: "skipped" }])).toBe("skipped");
  });
});

describe("checking a rule", () => {
  const context: RuleContext = { stateIds: new Set(["edit", "client"]), labelIds: new Set(["urgent"]), customFieldIds: new Set(["f1"]), templateIds: new Set(["tpl"]) };
  const rule = { name: "Client review", trigger: { type: "state_entered", stateId: "client" }, conditions: [], actions: [{ type: "set_due", days: 2 }] };

  it("accepts a sound rule and names the first problem otherwise", () => {
    expect(ruleProblem(rule, context)).toBeNull();
    expect(ruleProblem({ ...rule, name: " " }, context)).toBe("automation_name_required");
    expect(ruleProblem({ ...rule, trigger: { type: "state_entered", stateId: "other-team" } }, context)).toBe("automation_state_invalid");
    expect(ruleProblem({ ...rule, trigger: { type: "field_changed", field: "cf.f1" } }, context)).toBeNull();
    expect(ruleProblem({ ...rule, trigger: { type: "field_changed", field: "cf.unknown" } }, context)).toBe("automation_field_invalid");
    expect(ruleProblem({ ...rule, trigger: { type: "quota_threshold", percent: 50 } }, context)).toBe("automation_trigger_invalid");
    expect(ruleProblem({ ...rule, conditions: [{ field: "label", op: "eq", value: "nope" }] }, context)).toBe("automation_condition_invalid");
    expect(ruleProblem({ ...rule, conditions: [{ field: "priority", op: "eq" }] }, context)).toBe("automation_condition_invalid");
    expect(ruleProblem({ ...rule, actions: [] }, context)).toBe("automation_action_required");
    expect(ruleProblem({ ...rule, actions: [{ type: "assign", to: "role:lead" }] }, context)).toBe("automation_person_required");
    expect(ruleProblem({ ...rule, actions: [{ type: "create_task", templateId: "other" }] }, context)).toBe("automation_template_invalid");
    expect(ruleProblem({ ...rule, actions: [{ type: "notify", text: "" }] }, context)).toBe("automation_text_required");
    // A quota alert has no task to move.
    expect(ruleProblem({ name: "Quota", trigger: { type: "quota_threshold", percent: 80 }, conditions: [], actions: [{ type: "set_due", days: 1 }] }, context)).toBe("automation_action_needs_task");
    expect(ruleProblem({ name: "Quota", trigger: { type: "quota_threshold", percent: 80 }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: "80%" }] }, context)).toBeNull();
  });
});

describe("starter rules", () => {
  const states = [
    { id: "backlog", category: "backlog" as const, sortOrder: 0, isActive: true },
    { id: "brief", category: "todo" as const, sortOrder: 1, isActive: true },
    { id: "edit", category: "in_progress" as const, sortOrder: 5, isActive: true },
    { id: "internal", category: "in_review" as const, sortOrder: 6, isActive: true },
    { id: "client", category: "in_review" as const, sortOrder: 7, isActive: true },
    { id: "published", category: "done" as const, sortOrder: 9, isActive: true },
  ];
  const texts = { name: "Rule", text: "Text" };

  it("fit the team's workflow", () => {
    expect(presetRule("client_review_due", states, texts)).toEqual({ name: "Rule", trigger: { type: "state_entered", stateId: "client" }, conditions: [], actions: [{ type: "set_due", days: 2 }] });
    expect(presetRule("client_changes_reopen", states, texts)).toEqual({ name: "Rule", trigger: { type: "client_decision", decision: "changes_required" }, conditions: [], actions: [{ type: "move_state", stateId: "edit" }, { type: "notify", to: "role:assignee", text: "Text" }] });
    expect(presetRule("overdue_notify_lead", states, texts)).toEqual({ name: "Rule", trigger: { type: "due_date_reached", days: 1 }, conditions: [], actions: [{ type: "notify", to: "role:lead", text: "Text" }] });
  });

  it("are unavailable where the workflow has no review", () => {
    const plain = states.filter((state) => state.category !== "in_review");
    expect(presetRule("client_review_due", plain, texts)).toBeNull();
    expect(presetRule("client_changes_reopen", plain, texts)).toBeNull();
    expect(presetRule("overdue_notify_lead", plain, texts)).not.toBeNull();
  });

  it("pass the rule check", () => {
    const context: RuleContext = { stateIds: new Set(states.map((state) => state.id)), labelIds: new Set(), customFieldIds: new Set(), templateIds: new Set() };
    for (const preset of ["client_review_due", "client_changes_reopen", "overdue_notify_lead"] as const) expect(ruleProblem(presetRule(preset, states, texts)!, context)).toBeNull();
  });
});
