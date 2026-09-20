import { describe, expect, it } from "vitest";
import { type FilterableTask, filterTasks, groupTasks, nestTasks } from "./filter";

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
