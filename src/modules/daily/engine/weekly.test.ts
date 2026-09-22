import { describe, expect, it } from "vitest";
import { summarisePersonWeek, summariseTeamWeek, type WeekDayReport } from "./weekly";

const task = (id: string) => ({ taskId: id, title: `Task ${id}`, ref: `VID-${id}` });
const report = (date: string, facts: Partial<WeekDayReport> = {}): WeekDayReport => ({ date, status: "submitted", late: false, done: [], notDone: [], blockers: null, ...facts });

describe("a person's week", () => {
  it("golden", () => {
    const week = summarisePersonWeek({
      reports: [
        report("2026-09-21", { done: [task("1")], notDone: [task("2"), task("3")], blockers: "Chờ khách duyệt" }),
        report("2026-09-22", { done: [task("2")], notDone: [task("3"), task("4")], late: true }),
        report("2026-09-23", { done: [task("1")], notDone: [task("4")], blockers: "  " }),
        // A draft nobody submitted says nothing.
        report("2026-09-24", { status: "draft", done: [task("9")], notDone: [task("8")], blockers: "draft" }),
      ],
      // Friday had no report, but the activity shows 4 was completed.
      completed: [task("4"), task("5")],
      time: [
        { projectId: "p-tvc", projectName: "TVC Tết", category: null, minutes: 300 },
        { projectId: "p-social", projectName: "Social T10", category: null, minutes: 120 },
        { projectId: "p-tvc", projectName: "TVC Tết", category: null, minutes: 60 },
        { projectId: null, projectName: null, category: "admin", minutes: 30 },
      ],
      requiredDays: 5,
    });
    expect(week.done.map((line) => line.taskId)).toEqual(["1", "2", "4", "5"]);
    expect(week.slipped.map((line) => line.taskId)).toEqual(["3"]);
    expect(week.blockers).toEqual([{ date: "2026-09-21", text: "Chờ khách duyệt" }]);
    expect(week.hoursByProject).toEqual([
      { projectId: "p-tvc", name: "TVC Tết", category: null, minutes: 360 },
      { projectId: "p-social", name: "Social T10", category: null, minutes: 120 },
      { projectId: null, name: null, category: "admin", minutes: 30 },
    ]);
    expect(week.totalMinutes).toBe(510);
    expect([week.submitted, week.required, week.late]).toEqual([3, 5, 1]);
  });

  it("a team's week: blockers first, sums and merged hours", () => {
    const a = summarisePersonWeek({ reports: [report("2026-09-21", { done: [task("1")], blockers: "Thiếu file gốc" })], completed: [], time: [{ projectId: "p", projectName: "P", category: null, minutes: 60 }], requiredDays: 5 });
    const b = summarisePersonWeek({ reports: [report("2026-09-21", { done: [task("2"), task("3")], notDone: [task("4")] })], completed: [], time: [{ projectId: "p", projectName: "P", category: null, minutes: 90 }], requiredDays: 4 });
    const team = summariseTeamWeek([
      { personId: "b", name: "An", week: b },
      { personId: "a", name: "Bảo", week: a },
    ]);
    expect(team.people.map((row) => row.personId)).toEqual(["a", "b"]);
    expect(team.people[1]).toEqual({ personId: "b", name: "An", done: 2, slipped: 1, blockers: 0, minutes: 90, submitted: 1, required: 4, late: 0 });
    expect([team.done, team.slipped, team.totalMinutes, team.submitted, team.required]).toEqual([3, 1, 150, 2, 9]);
    expect(team.blockers).toEqual([{ personId: "a", name: "Bảo", date: "2026-09-21", text: "Thiếu file gốc" }]);
    expect(team.hoursByProject).toEqual([{ projectId: "p", name: "P", category: null, minutes: 150 }]);
  });
});
