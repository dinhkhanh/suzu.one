import { describe, expect, it } from "vitest";
import { planApproval, versionOn } from "./versions";

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
