import { describe, expect, it } from "vitest";
import { ASSIGNEE_RULES, parseAssigneeRule, pickTemplate, planChecklist, summarize, type TemplateItem } from "./checklist";

const template = (id: string, scope: Partial<{ entityId: string; departmentId: string; positionId: string; isActive: boolean }> = {}) => ({ id, entityId: null, departmentId: null, positionId: null, isActive: true, ...scope });

describe("pickTemplate", () => {
  const placement = { entityId: "SZM", departmentId: "VID", positionId: "editor" };
  it("prefers position over department over entity over the group-wide one", () => {
    const all = [template("global"), template("entity", { entityId: "SZM" }), template("department", { departmentId: "VID" }), template("position", { positionId: "editor" })];
    expect(pickTemplate(all, placement)?.id).toBe("position");
    expect(pickTemplate(all.slice(0, 3), placement)?.id).toBe("department");
    expect(pickTemplate(all.slice(0, 2), placement)?.id).toBe("entity");
    expect(pickTemplate(all.slice(0, 1), placement)?.id).toBe("global");
  });
  it("skips templates for somewhere else and inactive ones", () => {
    expect(pickTemplate([template("other", { entityId: "SZC" }), template("off", { positionId: "editor", isActive: false })], placement)).toBeNull();
    // Every scope a template names must match.
    expect(pickTemplate([template("mixed", { entityId: "SZC", positionId: "editor" }), template("global")], placement)?.id).toBe("global");
  });
  it("gives a tie to the first template", () => {
    expect(pickTemplate([template("first"), template("second")], placement)?.id).toBe("first");
  });
});

describe("planChecklist", () => {
  const item = (id: string, assigneeRule: string, dueOffsetDays: number, sortOrder: number, assigneePersonId: string | null = null): TemplateItem => ({ id, title: id, description: null, assigneeRule, assigneePersonId, dueOffsetDays, sortOrder });
  const people: Record<string, string> = { subject: "new-hire", line_manager: "manager", "person:manage": "hr" };
  const resolve = (rule: NonNullable<ReturnType<typeof parseAssigneeRule>>) => (rule.rule === "person" ? rule.personId : rule.rule === "permission" ? (people[rule.permission] ?? null) : people[rule.rule]);

  it("orders the steps, dates them from the anchor and names the people", () => {
    const tasks = planChecklist([item("plan", "line_manager", 0, 2), item("account", "permission:person:manage", -3, 0), item("policies", "subject", 5, 3), item("laptop", "person", -1, 1, "it-guy")], "2026-11-02", resolve);
    expect(tasks.map((task) => [task.title, task.assigneePersonId, task.dueDate, task.sortOrder])).toEqual([
      ["account", "hr", "2026-10-30", 0],
      ["laptop", "it-guy", "2026-11-01", 1],
      ["plan", "manager", "2026-11-02", 2],
      ["policies", "new-hire", "2026-11-07", 3],
    ]);
  });
  it("keeps a step nobody can be found for, unassigned", () => {
    const tasks = planChecklist([item("assets", "permission:asset:manage", 0, 0), item("odd", "nonsense", 0, 1)], "2026-01-31", resolve);
    expect(tasks.map((task) => task.assigneePersonId)).toEqual([null, null]);
  });
});

describe("summarize", () => {
  it("counts done, open and overdue, ignoring cancelled tasks", () => {
    const tasks = [
      { status: "done" as const, dueDate: "2026-01-01" },
      { status: "todo" as const, dueDate: "2026-01-01" },
      { status: "in_progress" as const, dueDate: "2026-03-01" },
      { status: "todo" as const, dueDate: null },
      { status: "cancelled" as const, dueDate: "2026-01-01" },
    ];
    expect(summarize(tasks, "2026-02-01")).toEqual({ total: 4, done: 1, open: 3, overdue: 1, complete: false });
    expect(summarize([{ status: "done", dueDate: null }, { status: "cancelled", dueDate: null }], "2026-02-01").complete).toBe(true);
    expect(summarize([], "2026-02-01").complete).toBe(false);
  });
});

describe("role rule (work templates)", () => {
  it("parses role:<key> and refuses a malformed key", () => {
    expect(parseAssigneeRule("role:designer", null)).toEqual({ rule: "role", roleKey: "designer" });
    expect(parseAssigneeRule("role:media_buyer", null)).toEqual({ rule: "role", roleKey: "media_buyer" });
    expect(parseAssigneeRule("role:", null)).toBeNull();
    expect(parseAssigneeRule("role:Designer!", null)).toBeNull();
  });
  it("is not offered by the checklist form", () => {
    expect(ASSIGNEE_RULES).toEqual(["subject", "line_manager", "person", "permission"]);
  });
});

describe("isSafeTaskLink", () => {
  it("takes in-app paths and https, nothing else", async () => {
    const { isSafeTaskLink } = await import("./checklist");
    for (const good of ["/kb/pages/0b0e0c52-1111-4222-8333-444455556666", "https://docs.google.com/document/d/abc"]) expect(isSafeTaskLink(good)).toBe(true);
    for (const bad of ["javascript:alert(1)", "//evil.example/x", "http://plain.example", "kb/pages/x", "/kb pages", "data:text/html,x", "/kb\\pages"]) expect(isSafeTaskLink(bad)).toBe(false);
  });
});
