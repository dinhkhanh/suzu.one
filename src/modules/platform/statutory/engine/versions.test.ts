import { describe, expect, it } from "vitest";
import { planApproval, planVoid, versionOn } from "./versions";

const v2025 = { id: "a", validFrom: "2025-07-01", validTo: "2026-06-30" };
const v2026 = { id: "b", validFrom: "2026-07-01", validTo: null };

describe("versionOn", () => {
  it("picks the version in force, with inclusive end dates", () => {
    expect(versionOn([v2025, v2026], "2026-06-30")?.id).toBe("a");
    expect(versionOn([v2025, v2026], "2026-07-01")?.id).toBe("b");
    expect(versionOn([v2025, v2026], "2030-01-01")?.id).toBe("b");
    expect(versionOn([v2025, v2026], "2025-06-30")).toBeUndefined();
  });
});

describe("planApproval", () => {
  it("lets the first version in, and later ones take over the day after the previous ends", () => {
    expect(planApproval([], "2026-01-01")).toEqual({ kind: "first" });
    expect(planApproval([v2025, v2026], "2027-01-01")).toEqual({ kind: "succeed", closeId: "b", closeOn: "2026-12-31" });
  });

  it("never rewrites history", () => {
    expect(planApproval([v2025, v2026], "2026-07-01")).toEqual({ kind: "rejected", reason: "version_exists" });
    expect(planApproval([v2025, v2026], "2026-03-01")).toEqual({ kind: "rejected", reason: "before_current_version" });
    expect(planApproval([v2025], "2026-06-30")).toEqual({ kind: "rejected", reason: "before_current_version" });
    // After a version that was given an end date, the next simply starts later.
    expect(planApproval([v2025], "2026-07-01")).toEqual({ kind: "first" });
  });
});

describe("planVoid", () => {
  const v2027 = { id: "c", validFrom: "2027-01-01", validTo: null };
  const closed2026 = { ...v2026, validTo: "2026-12-31" };

  it("gives the latest version's dates back to the one it took over from", () => {
    expect(planVoid([v2025, v2026], v2026)).toEqual({ kind: "reopen", reopenId: "a", reopenTo: null });
  });

  it("lets the previous version run up to the next one when a version in the middle is voided", () => {
    expect(planVoid([v2025, closed2026, v2027], closed2026)).toEqual({ kind: "reopen", reopenId: "a", reopenTo: "2026-12-31" });
  });

  it("leaves a gap when nothing came right before", () => {
    expect(planVoid([v2025, v2026], v2025)).toEqual({ kind: "gap" });
    expect(planVoid([{ id: "x", validFrom: "2024-01-01", validTo: "2024-06-30" }, v2026], v2026)).toEqual({ kind: "gap" });
  });

  it("once the voided version is gone, a correction may start on its day", () => {
    expect(planApproval([{ ...v2025, validTo: null }], "2026-07-01")).toEqual({ kind: "succeed", closeId: "a", closeOn: "2026-06-30" });
  });
});
