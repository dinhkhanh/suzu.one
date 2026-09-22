// Golden figures for project profitability (FR-PJM-63): the fee basis, the cost at each month's
// loaded rate with an estimated fallback, the margin — and a breakdown that never lets a group of
// one person stand alone.
import { describe, expect, it } from "vitest";
import { breakdown, costOf, monthsBetween, OTHER_GROUP, profitability, projectFee, type RateRow, resolveRate, type TimeLine } from "./profitability";

const rates: RateRow[] = [
  { personId: "huy", month: "2026-07", ratePerHourVnd: 120_000 },
  { personId: "huy", month: "2026-08", ratePerHourVnd: 125_000 },
  { personId: "lan", month: "2026-08", ratePerHourVnd: 90_000 },
  { personId: "tam", month: "2026-08", ratePerHourVnd: 200_000 },
];

describe("resolveRate", () => {
  it("takes the month's own rate, else the latest before, else the nearest after — and says which", () => {
    expect(resolveRate(rates, "huy", "2026-08")).toEqual({ ratePerHourVnd: 125_000, exact: true });
    expect(resolveRate(rates, "huy", "2026-09")).toEqual({ ratePerHourVnd: 125_000, exact: false });
    expect(resolveRate(rates, "lan", "2026-06")).toEqual({ ratePerHourVnd: 90_000, exact: false });
    expect(resolveRate(rates, "nobody", "2026-08")).toBeNull();
  });

  it("costs minutes at an hourly rate in whole VND", () => {
    expect(costOf(90, 125_000)).toBe(187_500);
    expect(costOf(7, 100_000)).toBe(11_667);
  });
});

describe("projectFee", () => {
  const months = monthsBetween("2026-07", "2026-09");
  it("prefers invoiced billing, then the retainer's months, then the project fee", () => {
    expect(months).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(projectFee({ feeVnd: 500_000_000, retainer: null, invoicedVnd: 120_000_000 }, months)).toEqual({ feeVnd: 120_000_000, basis: "invoiced" });
    // The retainer started in August: two of the three months.
    expect(projectFee({ feeVnd: null, retainer: { feePerMonthVnd: 40_000_000, startMonth: "2026-08", endMonth: null }, invoicedVnd: 0 }, months)).toEqual({ feeVnd: 80_000_000, basis: "retainer" });
    expect(projectFee({ feeVnd: 300_000_000, retainer: null, invoicedVnd: 0 }, months)).toEqual({ feeVnd: 300_000_000, basis: "project_fee" });
    expect(projectFee({ feeVnd: null, retainer: null, invoicedVnd: 0 }, months)).toEqual({ feeVnd: null, basis: "none" });
    expect(monthsBetween("2026-11", "2027-02")).toEqual(["2026-11", "2026-12", "2027-01", "2027-02"]);
  });
});

describe("breakdown", () => {
  it("folds groups of one person into 'other', and a lone 'other' into the smallest group", () => {
    expect(
      breakdown([
        { key: "video", personId: "huy", minutes: 600, costVnd: 1_250_000 },
        { key: "video", personId: "lan", minutes: 300, costVnd: 450_000 },
        { key: "design", personId: "tam", minutes: 60, costVnd: 200_000 },
      ]),
    ).toEqual([{ key: OTHER_GROUP, minutes: 960, costVnd: 1_900_000 }]);

    expect(
      breakdown([
        { key: "video", personId: "huy", minutes: 600, costVnd: 1_000_000 },
        { key: "video", personId: "lan", minutes: 300, costVnd: 500_000 },
        { key: "design", personId: "tam", minutes: 60, costVnd: 200_000 },
        { key: "design", personId: "an", minutes: 60, costVnd: 100_000 },
        { key: "social", personId: "binh", minutes: 30, costVnd: 50_000 },
        { key: "copy", personId: "chi", minutes: 30, costVnd: 40_000 },
      ]),
    ).toEqual([
      { key: "video", minutes: 900, costVnd: 1_500_000 },
      { key: "design", minutes: 120, costVnd: 300_000 },
      { key: OTHER_GROUP, minutes: 60, costVnd: 90_000 },
    ]);
  });
});

describe("profitability", () => {
  const time: TimeLine[] = [
    { projectId: "tvc", personId: "huy", month: "2026-08", minutes: 600, teamKey: "video", roleKey: "editor" },
    { projectId: "tvc", personId: "lan", month: "2026-08", minutes: 1_200, teamKey: "video", roleKey: "editor" },
    { projectId: "tvc", personId: "huy", month: "2026-09", minutes: 120, teamKey: "video", roleKey: "editor" },
    { projectId: "tvc", personId: "ghost", month: "2026-08", minutes: 60, teamKey: "video", roleKey: "intern" },
    { projectId: "social", personId: "tam", month: "2026-08", minutes: 300, teamKey: "social", roleKey: "lead" },
  ];

  it("costs each person-month at its rate, flags estimates, and adds up by project, client and in total", () => {
    const result = profitability({
      projects: [
        { projectId: "tvc", clientId: "acme", fee: { feeVnd: 60_000_000, retainer: null, invoicedVnd: 0 } },
        { projectId: "social", clientId: "acme", fee: { feeVnd: null, retainer: { feePerMonthVnd: 1_000_000, startMonth: "2026-08", endMonth: null }, invoicedVnd: 0 } },
        { projectId: "pitch", clientId: null, fee: { feeVnd: null, retainer: null, invoicedVnd: 0 } },
      ],
      time,
      rates,
      periodMonths: ["2026-08", "2026-09"],
    });
    const tvc = result.projects.find((row) => row.projectId === "tvc")!;
    // 600 min × 125k + 1200 × 90k + 120 × 125k (September, estimated from August); the ghost has no rate.
    expect(tvc).toMatchObject({ basis: "project_fee", feeVnd: 60_000_000, costVnd: 1_250_000 + 1_800_000 + 250_000, marginVnd: 60_000_000 - 3_300_000, minutes: 1_980, unratedMinutes: 60, estimated: true });
    expect(tvc.marginRate).toBeCloseTo(0.945, 3);
    expect(tvc.byTeam).toEqual([{ key: "video", minutes: 1_920, costVnd: 3_300_000 }]);

    const social = result.projects.find((row) => row.projectId === "social")!;
    // A 2 000 000 retainer against 1 000 000 of cost; one person on it, so the breakdown is "other".
    expect(social).toMatchObject({ basis: "retainer", feeVnd: 2_000_000, costVnd: 1_000_000, marginVnd: 1_000_000, marginRate: 0.5, estimated: false });
    expect(social.byTeam).toEqual([{ key: OTHER_GROUP, minutes: 300, costVnd: 1_000_000 }]);

    expect(result.clients).toEqual([
      { clientId: "acme", projects: 2, minutes: 2_280, estimated: true, feeVnd: 62_000_000, costVnd: 4_300_000, marginVnd: 57_700_000, marginRate: 57_700_000 / 62_000_000 },
      { clientId: null, projects: 1, minutes: 0, estimated: false, feeVnd: null, costVnd: 0, marginVnd: null, marginRate: null },
    ]);
    expect(result.total).toEqual({ minutes: 2_280, estimated: true, feeVnd: 62_000_000, costVnd: 4_300_000, marginVnd: 57_700_000, marginRate: 57_700_000 / 62_000_000 });
  });

  it("returns no per-person figure anywhere", () => {
    const text = JSON.stringify(profitability({ projects: [{ projectId: "tvc", clientId: null, fee: { feeVnd: 1, retainer: null, invoicedVnd: 0 } }], time, rates, periodMonths: ["2026-08"] }));
    for (const personId of ["huy", "lan", "tam", "ghost"]) expect(text).not.toContain(personId);
    for (const rate of ["120000", "125000", "90000", "200000"]) expect(text).not.toContain(rate);
  });
});
