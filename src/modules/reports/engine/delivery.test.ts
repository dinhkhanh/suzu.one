// Golden figures of the delivery dashboards (FR-PJM-60): rates over many projects are the sum of
// the parts divided once, "no data" is null rather than 0 %, and compliance counts only what was due.
import { describe, expect, it } from "vitest";
import { addCompliance, blockedMinutesWithin, EMPTY_BLOCKED, EMPTY_HANDOFFS, EMPTY_MILESTONES, EMPTY_ON_TIME, EMPTY_REVISIONS, type ProjectDeliveryFacts, reportCompliance, summariseDelivery, summariseRetainers, timesheetCompliance } from "./delivery";

const project = (overrides: Partial<ProjectDeliveryFacts> & { projectId: string }): ProjectDeliveryFacts => ({
  teamId: "video",
  health: null,
  stale: false,
  milestones: EMPTY_MILESTONES,
  onTime: EMPTY_ON_TIME,
  register: { promised: 0, accepted: 0 },
  burn: { loggedMinutes: 0, budgetMinutes: null, level: "none" },
  revisions: EMPTY_REVISIONS,
  handoffs: EMPTY_HANDOFFS,
  blocked: EMPTY_BLOCKED,
  ...overrides,
});

const tvc = project({
  projectId: "tvc",
  health: "at_risk",
  stale: true,
  milestones: { total: 4, baselined: 4, slipped: 2, slipDays: 9, overdue: 1 },
  onTime: { completed: 10, dated: 8, onTime: 6 },
  register: { promised: 4, accepted: 1 },
  burn: { loggedMinutes: 5_400, budgetMinutes: 6_000, level: "warning" },
  revisions: { reviewedTasks: 5, internalRounds: 6, clientRounds: 2 },
  handoffs: { total: 6, returned: 2, pending: 1, answered: 5, waitMinutes: 600 },
  blocked: { blockers: 2, open: 1, blockedMinutes: 540 },
});
const social = project({
  projectId: "social",
  teamId: "social",
  health: "on_track",
  milestones: { total: 2, baselined: 1, slipped: 0, slipDays: 0, overdue: 0 },
  onTime: { completed: 30, dated: 30, onTime: 27 },
  register: { promised: 36, accepted: 30 },
  burn: { loggedMinutes: 9_000, budgetMinutes: 7_200, level: "over" },
  revisions: { reviewedTasks: 20, internalRounds: 4, clientRounds: 5 },
  handoffs: { total: 4, returned: 0, pending: 0, answered: 4, waitMinutes: 120 },
});
const internal = project({ projectId: "internal", health: "off_track", burn: { loggedMinutes: 1_200, budgetMinutes: null, level: "none" } });

describe("summariseDelivery", () => {
  it("adds the parts and divides once", () => {
    const summary = summariseDelivery([tvc, social, internal]);
    expect(summary.projects).toBe(3);
    expect(summary.health).toEqual({ on_track: 1, at_risk: 1, off_track: 1, none: 0, stale: 1 });
    // 2 of 5 baselined milestones slipped, 9 days between them.
    expect(summary.milestones).toEqual({ total: 6, baselined: 5, slipped: 2, slipDays: 9, overdue: 1, slipRate: 0.4, averageSlipDays: 4.5 });
    // 33 of 38 dated tasks — not the mean of 75 % and 90 %.
    expect(summary.onTime).toEqual({ completed: 40, dated: 38, onTime: 33, late: 5, rate: 33 / 38 });
    expect(summary.register).toEqual({ promised: 40, accepted: 31, rate: 31 / 40 });
    // The internal project has no budget: its hours count in the total logged, not in the rate.
    expect(summary.burn).toEqual({ budgeted: 2, loggedMinutes: 15_600, budgetMinutes: 13_200, loggedOnBudgeted: 14_400, rate: 14_400 / 13_200, warning: 1, over: 1 });
    expect(summary.revisions).toEqual({ reviewedTasks: 25, internalRounds: 10, clientRounds: 7, internalPerTask: 0.4, clientPerTask: 0.3 });
    // The mean wait is over the answered hand-offs only: 720 minutes over 9.
    expect(summary.handoffs).toEqual({ total: 10, returned: 2, pending: 1, answered: 9, waitMinutes: 720, returnRate: 0.2, averageWaitMinutes: 80 });
    expect(summary.blocked).toEqual({ blockers: 2, open: 1, blockedMinutes: 540, blockedHours: 9, averageHoursPerBlocker: 4.5 });
  });

  it("says nothing rather than 0 % where there is nothing to divide by", () => {
    const summary = summariseDelivery([internal]);
    expect([summary.onTime.rate, summary.register.rate, summary.burn.rate, summary.milestones.slipRate, summary.handoffs.returnRate, summary.handoffs.averageWaitMinutes, summary.revisions.internalPerTask, summary.blocked.averageHoursPerBlocker]).toEqual([null, null, null, null, null, null, null, null]);
    expect(summariseDelivery([]).projects).toBe(0);
  });
});

describe("compliance", () => {
  it("counts reports only on the days one was required", () => {
    expect(
      reportCompliance([
        { required: true, submitted: true },
        { required: true, submitted: false },
        { required: false, submitted: false }, // a holiday
        { required: false, submitted: true }, // a Saturday report nobody asked for
        { required: true, submitted: true },
      ]),
    ).toEqual({ due: 3, met: 2, rate: 2 / 3 });
  });

  it("counts timesheet weeks that were due", () => {
    expect(timesheetCompliance([{ due: true, submitted: true }, { due: false, submitted: false }, { due: true, submitted: false }])).toEqual({ due: 2, met: 1, rate: 0.5 });
    expect(timesheetCompliance([{ due: false, submitted: false }])).toEqual({ due: 0, met: 0, rate: null });
  });

  it("adds teams by their counts", () => {
    expect(addCompliance([{ due: 10, met: 9, rate: 0.9 }, { due: 30, met: 15, rate: 0.5 }])).toEqual({ due: 40, met: 24, rate: 0.6 });
  });
});

describe("summariseRetainers", () => {
  it("measures consumption as delivered ÷ contracted and flags overservicing", () => {
    const summary = summariseRetainers([
      { projectId: "a", contracted: 12, delivered: 13, minutesAllowance: null, minutesLogged: 0 },
      { projectId: "b", contracted: 10, delivered: 9, minutesAllowance: 2_400, minutesLogged: 1_800 },
      { projectId: "c", contracted: 8, delivered: 2, minutesAllowance: 1_200, minutesLogged: 1_500 },
    ]);
    expect(summary).toEqual({ retainers: 3, contracted: 30, delivered: 24, consumption: 0.8, overserviced: 2, nearLimit: 1, hours: { allowanceMinutes: 3_600, loggedMinutes: 3_300, rate: 3_300 / 3_600 } });
  });
});

describe("blockedMinutesWithin", () => {
  const at = (time: string) => new Date(`2026-09-${time}:00+07:00`);
  const from = at("01T00:00");
  const to = at("30T00:00");
  const now = at("20T12:00");

  it("clips a blocker to the period and counts an open one up to now", () => {
    expect(blockedMinutesWithin({ raisedAt: at("10T09:00"), resolvedAt: at("10T11:30") }, from, to, now)).toBe(150);
    expect(blockedMinutesWithin({ raisedAt: new Date("2026-08-31T15:00:00+07:00"), resolvedAt: at("01T01:00") }, from, to, now)).toBe(60);
    expect(blockedMinutesWithin({ raisedAt: at("20T10:00"), resolvedAt: null }, from, to, now)).toBe(120);
    expect(blockedMinutesWithin({ raisedAt: new Date("2026-08-01T00:00:00+07:00"), resolvedAt: new Date("2026-08-02T00:00:00+07:00") }, from, to, now)).toBe(0);
  });
});
