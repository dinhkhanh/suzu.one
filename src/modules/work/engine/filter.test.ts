import { describe, expect, it } from "vitest";
import { type FilterableTask, filterEntries, filterTasks, groupTasks, nestTasks, readFilters, readGrouping, readSort, sortTasks } from "./filter";

const task = (id: string, overrides: Partial<FilterableTask> = {}): FilterableTask => ({ id, key: `VID-${id}`, title: `Task ${id}`, status: "todo", stateId: "brief", priority: null, assigneePersonId: null, dueDate: null, clientId: null, labelIds: [], parentTaskId: null, ...overrides });
const context = { selfId: "huy", today: "2026-09-20" };
const tasks = [
  task("1", { title: "Kịch bản TVC Tết", assigneePersonId: "huy", priority: 1, dueDate: "2026-09-18", clientId: "vinamilk", labelIds: ["urgent"] }),
  task("2", { title: "Dựng bản nháp", assigneePersonId: "tam", stateId: "edit", status: "in_progress", dueDate: "2026-09-24" }),
  task("3", { title: "Xuất bản Facebook", stateId: "published", status: "done", assigneePersonId: "huy", dueDate: "2026-09-10" }),
  task("4", { title: "Ý tưởng dự phòng", parentTaskId: "1" }),
];
const ids = (rows: FilterableTask[]) => rows.map((row) => row.id);

describe("filterTasks", () => {
  it("hides closed tasks until asked, or until their state is picked", () => {
    expect(ids(filterTasks(tasks, {}, context))).toEqual(["1", "2", "4"]);
    expect(ids(filterTasks(tasks, { closed: "1" }, context))).toEqual(["1", "2", "3", "4"]);
    expect(ids(filterTasks(tasks, { state: "published" }, context))).toEqual(["3"]);
  });
  it("filters by cycle (FR-PJM-10): one cycle, or work planned in none", () => {
    const planned = [task("a", { cycleId: "cycle-1" }), task("b", { cycleId: "cycle-2" }), task("c", { cycleId: null }), task("d")];
    expect(ids(filterTasks(planned, { cycle: "cycle-1" }, context))).toEqual(["a"]);
    expect(ids(filterTasks(planned, { cycle: "none" }, context))).toEqual(["c", "d"]);
    expect(readFilters({ cycle: "cycle-2", bogus: "x" })).toEqual({ cycle: "cycle-2" });
  });
  it("matches text without accents and by key", () => {
    expect(ids(filterTasks(tasks, { q: "kich ban tet" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { q: "vid-2" }, context))).toEqual(["2"]);
  });
  it("filters by assignee (me, nobody, a person), priority, label, client and due date", () => {
    expect(ids(filterTasks(tasks, { assignee: "me" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { assignee: "none" }, context))).toEqual(["4"]);
    expect(ids(filterTasks(tasks, { assignee: "tam" }, context))).toEqual(["2"]);
    expect(ids(filterTasks(tasks, { priority: "1" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { priority: "none" }, context))).toEqual(["2", "4"]);
    expect(ids(filterTasks(tasks, { label: "urgent" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { client: "vinamilk" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { client: "none" }, context))).toEqual(["2", "4"]);
    expect(ids(filterTasks(tasks, { due: "overdue", closed: "1" }, context))).toEqual(["1"]);
    expect(ids(filterTasks(tasks, { due: "week" }, context))).toEqual(["2"]);
    expect(ids(filterTasks(tasks, { due: "none" }, context))).toEqual(["4"]);
  });
  it("combines filters", () => {
    expect(ids(filterTasks(tasks, { assignee: "me", closed: "1", q: "facebook" }, context))).toEqual(["3"]);
  });
});

describe("groupTasks and nestTasks", () => {
  it("orders groups as told and puts the unassigned last", () => {
    expect(groupTasks(tasks, "status", ["brief", "edit", "published"]).map((group) => [group.key, ids(group.tasks)])).toEqual([["brief", ["1", "4"]], ["edit", ["2"]], ["published", ["3"]]]);
    expect(groupTasks(tasks, "assignee", ["tam", "huy"]).map((group) => group.key)).toEqual(["tam", "huy", "none"]);
    expect(groupTasks(tasks, "none", [])).toHaveLength(1);
  });
  it("puts a sub-task under its parent only when the parent is in the list", () => {
    expect(nestTasks(tasks).map((row) => [row.task.id, row.depth])).toEqual([["1", 0], ["4", 1], ["2", 0], ["3", 0]]);
    expect(nestTasks(tasks.filter((row) => row.id !== "1")).map((row) => [row.task.id, row.depth])).toEqual([["2", 0], ["3", 0], ["4", 0]]);
  });
});

describe("PJM additions: triage, blockers, custom fields", () => {
  const FIELD = "8b1f6a3e-2c4d-4e5f-9a0b-1c2d3e4f5a6b";
  const format = { id: FIELD, type: "select" as const, options: [{ id: "reels", label: "Reels" }, { id: "tvc", label: "TVC" }] };
  const rows = [
    task("1", { customValues: { [FIELD]: "tvc" }, dueDate: "2026-09-30", priority: 2 }),
    task("2", { customValues: { [FIELD]: "reels" }, triageStatus: "pending" }),
    task("3", { customValues: {}, blocker: { reason: "Chờ khách duyệt" }, priority: 1 }),
    task("4", { customValues: { [FIELD]: "gone" }, triageStatus: "accepted", dueDate: "2026-09-25", blockedBy: 1 }),
  ];
  const withFields = { ...context, fields: [format] };

  it("keeps work in triage out of the list until asked", () => {
    expect(ids(filterTasks(rows, {}, context))).toEqual(["1", "3", "4"]);
    expect(ids(filterTasks(rows, { triage: "1" }, context))).toEqual(["1", "2", "3", "4"]);
    expect(ids(filterTasks(rows, { triage: "only" }, context))).toEqual(["2"]);
  });
  it("shows blocked work — a blocker raised or an open dependency", () => {
    expect(ids(filterTasks(rows, { blocked: "1" }, context))).toEqual(["3", "4"]);
  });
  it("filters by a custom field it knows; an unknown field's filter is ignored; a deleted option is empty", () => {
    expect(ids(filterTasks(rows, { [`cf.${FIELD}`]: "tvc" }, withFields))).toEqual(["1"]);
    expect(ids(filterTasks(rows, { [`cf.${FIELD}`]: "~empty" }, withFields))).toEqual(["3", "4"]);
    expect(ids(filterTasks(rows, { [`cf.${FIELD}`]: "tvc" }, context))).toEqual(["1", "3", "4"]);
  });
  it("sorts by a field, due date or priority, empty values last either way", () => {
    expect(ids(sortTasks(rows, `cf.${FIELD}`, [format]))).toEqual(["2", "1", "3", "4"]);
    expect(ids(sortTasks(rows, `-cf.${FIELD}`, [format]))).toEqual(["1", "2", "3", "4"]);
    expect(ids(sortTasks(rows, "due"))).toEqual(["4", "1", "2", "3"]);
    expect(ids(sortTasks(rows, "-priority"))).toEqual(["1", "3", "2", "4"]);
    expect(ids(sortTasks(rows, "rank"))).toEqual(["1", "2", "3", "4"]);
  });
  it("groups by a field in option order, the empty ones last", () => {
    expect(groupTasks(rows, `cf.${FIELD}`, ["reels", "tvc"], [format]).map((group) => [group.key, ids(group.tasks)])).toEqual([["reels", ["2"]], ["tvc", ["1"]], ["none", ["3", "4"]]]);
  });
  it("reads the URL: known keys and field keys only; saved views of old keys still read", () => {
    expect(readFilters({ assignee: "me", [`cf.${FIELD}`]: "tvc", "cf.x": "1", view: "table", q: "" })).toEqual({ assignee: "me", [`cf.${FIELD}`]: "tvc" });
    expect(filterEntries({ assignee: "me", closed: undefined, triage: "1" })).toEqual([["assignee", "me"], ["triage", "1"]]);
    expect([readGrouping("client"), readGrouping(`cf.${FIELD}`), readGrouping("cf.x"), readGrouping(undefined)]).toEqual(["client", `cf.${FIELD}`, "none", "none"]);
    expect([readSort("-due"), readSort(`cf.${FIELD}`), readSort("drop table")]).toEqual(["-due", `cf.${FIELD}`, "rank"]);
  });
});
