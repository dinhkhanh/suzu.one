import { describe, expect, it } from "vitest";
import { type PlannedTask, prefillReport, type PrefillEvent } from "./prefill";

const at = (time: string) => `2026-09-21T${time}:00.000Z`;
const event = (kind: PrefillEvent["kind"], taskId: string, time: string, detail: string | null = null): PrefillEvent => ({ kind, taskId, key: `VID-${taskId}`, title: `Task ${taskId}`, at: at(time), detail });
const planned = (taskId: string, status: PlannedTask["status"] = "in_progress", completedOn: string | null = null): PlannedTask => ({ taskId, key: `VID-${taskId}`, title: `Task ${taskId}`, status, completedOn });

describe("the prefilled end-of-day report", () => {
  it("golden: a day of planned and unplanned work", () => {
    const draft = prefillReport({
      date: "2026-09-21",
      planned: [planned("1", "done", "2026-09-21"), planned("2"), planned("3"), planned("4", "cancelled"), planned("7", "done", "2026-09-21")],
      events: [
        event("moved", "1", "02:00", "Edit"),
        event("completed", "1", "03:00", "Published"),
        event("commented", "2", "03:10"),
        event("commented", "2", "03:20"),
        event("commented", "2", "04:00"),
        event("submitted", "3", "05:00", "v2"),
        // Completed, then reopened: not done.
        event("completed", "5", "06:00", "Done"),
        event("moved", "5", "07:00", "Edit"),
        // Not planned, done today.
        event("created", "6", "01:00"),
        event("completed", "6", "08:00", "Done"),
        event("reviewed", "8", "08:30", "approved"),
        event("handoff_sent", "3", "09:00", "Mai"),
        event("blocker_raised", "2", "09:30", "Chờ khách duyệt kịch bản"),
      ],
      time: [
        { taskId: "1", key: "VID-1", title: "Task 1", minutes: 90, at: at("03:00") },
        { taskId: "1", key: "VID-1", title: "Task 1", minutes: 30, at: at("04:30") },
        { taskId: null, key: null, title: "internal", minutes: 45, at: at("10:00") },
      ],
    });

    expect(draft.done.map((task) => task.taskId)).toEqual(["1", "6", "7"]);
    expect(draft.notDone).toEqual([
      { taskId: "2", title: "Task 2", ref: "VID-2" },
      { taskId: "3", title: "Task 3", ref: "VID-3" },
    ]);
    expect(draft.minutesLogged).toBe(165);
    expect(draft.activity.map((item) => [item.kind, item.taskId, item.detail])).toEqual([
      ["created", "6", null],
      ["completed", "1", "Published"],
      ["commented", "2", "3"],
      ["time_logged", "1", "120"],
      ["submitted", "3", "v2"],
      ["moved", "5", "Edit"],
      ["completed", "6", "Done"],
      ["reviewed", "8", "approved"],
      ["handoff_sent", "3", "Mai"],
      ["blocker_raised", "2", "Chờ khách duyệt kịch bản"],
      ["time_logged", null, "45"],
    ]);
  });

  it("an empty day: the plan is all not done", () => {
    const draft = prefillReport({ date: "2026-09-21", planned: [planned("1"), planned("2", "todo")], events: [], time: [] });
    expect(draft).toEqual({ done: [], notDone: [{ taskId: "1", title: "Task 1", ref: "VID-1" }, { taskId: "2", title: "Task 2", ref: "VID-2" }], activity: [], minutesLogged: 0 });
  });

  it("a planned task done on an earlier day is neither done today nor not done", () => {
    const draft = prefillReport({ date: "2026-09-21", planned: [planned("1", "done", "2026-09-18")], events: [], time: [] });
    expect(draft.done).toEqual([]);
    expect(draft.notDone).toEqual([]);
  });
});
