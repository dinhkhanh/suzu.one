import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../rbac/policy";
import { ROLES } from "../rbac/roles";
import { canRunJobs, canSeeJobs } from "./policy";

const principal = (grants: Grant[]): Principal => ({ personId: "me", workforceType: "employee", grants });
const group = { type: "group" } as const;

describe("Admin → Jobs", () => {
  it("lets only the owner start a job by hand", () => {
    expect(canRunJobs(principal([{ role: "owner", scope: group }]))).toBe(true);
    for (const role of ROLES.filter((role) => role !== "owner")) expect(canRunJobs(principal([{ role, scope: group }])), role).toBe(false);
  });

  it("shows the runs to the audit log's readers, group-wide only", () => {
    expect(canSeeJobs(principal([{ role: "auditor", scope: group }]))).toBe(true);
    expect(canSeeJobs(principal([{ role: "hr_admin", scope: group }]))).toBe(true);
    expect(canSeeJobs(principal([{ role: "hr_admin", scope: { type: "entity", id: "entity-a" } }]))).toBe(false);
    expect(canSeeJobs(principal([{ role: "department_head", scope: group }]))).toBe(false);
    expect(canSeeJobs(principal([]))).toBe(false);
  });
});
