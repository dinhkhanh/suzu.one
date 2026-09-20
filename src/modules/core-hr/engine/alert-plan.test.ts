import { expect, it } from "vitest";
import { dueAlerts } from "./alert-plan";

const THRESHOLDS = { contract: [45, 30, 15], probation: [10, 3] };
const subject = (dueOn: string, kind: "contract" | "probation" = "contract") => ({ kind, subjectId: dueOn, dueOn });

it("picks the tightest threshold reached, and nothing before the first or after the date", () => {
  const today = "2026-09-01";
  const result = dueAlerts(today, [subject("2026-10-17"), subject("2026-10-16"), subject("2026-10-01"), subject("2026-09-21"), subject("2026-09-16"), subject("2026-09-01"), subject("2026-08-31")], THRESHOLDS);
  expect(result.map((alert) => [alert.dueOn, alert.thresholdDays, alert.daysLeft])).toEqual([
    ["2026-10-16", 45, 45],
    ["2026-10-01", 30, 30],
    ["2026-09-21", 30, 20],
    ["2026-09-16", 15, 15],
    ["2026-09-01", 15, 0],
  ]);
});

it("uses each kind's own countdown", () => {
  expect(dueAlerts("2026-09-01", [subject("2026-09-11", "probation"), subject("2026-09-04", "probation"), subject("2026-09-20", "probation")], THRESHOLDS).map((alert) => alert.thresholdDays)).toEqual([10, 3]);
});
