import { describe, expect, it } from "vitest";
import { analyse, type AnalyticsTask, summarise } from "./analytics";

const PERIOD = { from: "2027-01-01", to: "2027-01-31" };
const TODAY = "2027-02-01";

const task = (overrides: Partial<AnalyticsTask> = {}): AnalyticsTask => ({
  teamId: "team-a",
  clientId: null,
  status: "done",
  dueDate: "2027-01-20",
  completedOn: "2027-01-19",
  updatedOn: "2027-01-19",
  revisionRounds: 0,
  assigneePersonId: "p1",
  estimateMinutes: null,
  ...overrides,
});

describe("summarise", () => {
  it("counts a task finished before its due date as on time", () => {
    const cell = summarise([task()], PERIOD, TODAY);
    expect(cell).toMatchObject({ completed: 1, dated: 1, onTime: 1, late: 0, undated: 0, onTimeRate: 1 });
  });

  it("counts a task finished after its due date as late", () => {
    const cell = summarise([task({ completedOn: "2027-01-25" })], PERIOD, TODAY);
    expect(cell).toMatchObject({ completed: 1, onTime: 0, late: 1, onTimeRate: 0 });
  });

  it("counts finishing on the due date itself as on time", () => {
    expect(summarise([task({ completedOn: "2027-01-20" })], PERIOD, TODAY).onTime).toBe(1);
  });

  it("keeps undated completions out of the on-time rate", () => {
    const cell = summarise([task({ dueDate: null }), task({ completedOn: "2027-01-25" })], PERIOD, TODAY);
    expect(cell).toMatchObject({ completed: 2, undated: 1, dated: 1, onTime: 0, late: 1, onTimeRate: 0 });
  });

  it("has no on-time rate when nothing dated was completed", () => {
    expect(summarise([task({ dueDate: null })], PERIOD, TODAY).onTimeRate).toBeNull();
    expect(summarise([], PERIOD, TODAY).onTimeRate).toBeNull();
  });

  it("ignores work completed outside the period", () => {
    const before = task({ completedOn: "2026-12-30", updatedOn: "2026-12-30" });
    const after = task({ completedOn: "2027-02-02", updatedOn: "2027-02-02" });
    expect(summarise([before, after], PERIOD, TODAY).completed).toBe(0);
  });

  it("counts open work and the part of it that is overdue", () => {
    const rows = [
      task({ status: "todo", completedOn: null, dueDate: "2027-01-10" }),
      task({ status: "in_progress", completedOn: null, dueDate: "2027-03-10" }),
      task({ status: "todo", completedOn: null, dueDate: null }),
    ];
    expect(summarise(rows, PERIOD, TODAY)).toMatchObject({ open: 3, overdue: 1, completed: 0 });
  });

  it("reports cancellations apart from throughput", () => {
    const cell = summarise([task({ status: "cancelled", completedOn: null, updatedOn: "2027-01-15" })], PERIOD, TODAY);
    expect(cell).toMatchObject({ cancelled: 1, completed: 0, open: 0 });
  });

  it("averages revision rounds over completed work only", () => {
    const rows = [task({ revisionRounds: 3 }), task({ revisionRounds: 1 }), task({ status: "todo", completedOn: null, revisionRounds: 9 })];
    const cell = summarise(rows, PERIOD, TODAY);
    expect(cell).toMatchObject({ revisionRounds: 4, completed: 2, revisionsPerTask: 2 });
  });

  it("counts a person once however many tasks they hold", () => {
    const rows = [task(), task(), task({ assigneePersonId: "p2", status: "todo", completedOn: null })];
    expect(summarise(rows, PERIOD, TODAY).contributors).toBe(2);
  });

  it("does not count an unassigned task towards contributors", () => {
    expect(summarise([task({ assigneePersonId: null })], PERIOD, TODAY).contributors).toBe(0);
  });

  it("sums the estimate of open work only", () => {
    const rows = [task({ status: "todo", completedOn: null, estimateMinutes: 120 }), task({ estimateMinutes: 480 })];
    expect(summarise(rows, PERIOD, TODAY).openMinutes).toBe(120);
  });
});

describe("analyse", () => {
  it("groups by team and by client, and leaves clientless work out of the client table", () => {
    const rows = [
      task({ teamId: "video", clientId: "acme" }),
      task({ teamId: "video", clientId: null }),
      task({ teamId: "design", clientId: "acme", completedOn: "2027-01-28", dueDate: "2027-01-20" }),
    ];
    const result = analyse(rows, PERIOD, TODAY);
    expect(result.total.completed).toBe(3);
    expect(result.byTeam.map((group) => [group.key, group.cell.completed])).toEqual(
      expect.arrayContaining([
        ["video", 2],
        ["design", 1],
      ]),
    );
    expect(result.byClient).toHaveLength(1);
    expect(result.byClient[0]).toMatchObject({ key: "acme", cell: { completed: 2, onTime: 1, late: 1 } });
  });

  it("is empty but well-formed with no rows at all", () => {
    const result = analyse([], PERIOD, TODAY);
    expect(result.byTeam).toEqual([]);
    expect(result.byClient).toEqual([]);
    expect(result.total.completed).toBe(0);
    expect(result.total.onTimeRate).toBeNull();
  });
});
