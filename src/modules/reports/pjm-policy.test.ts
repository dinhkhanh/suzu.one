// Who reads the PJM reports (FR-PJM-60, 63), role by role: profitability is for owner, C-level and
// finance — never a line manager, department head, entity director or HR — and only over the
// entities their grant covers; compliance covers the teams a reader leads or holds `pjm:portfolio` over.
import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import type { Role } from "../platform/rbac/roles";
import { canOpenDelivery, canReadProfitability, canSeeProfitabilityOf, complianceTeamIds } from "./pjm-policy";

const MEDIA = "00000000-0000-4000-8000-000000000001";
const CREATIVE = "00000000-0000-4000-8000-000000000002";
const DEPT = "00000000-0000-4000-8000-0000000000d1";

const grantee = (role: Role, scope: "group" | "media" | "dept" = "media"): Principal => ({
  personId: "00000000-0000-4000-8000-00000000aaaa",
  workforceType: "employee",
  grants: [{ role, scope: scope === "group" ? { type: "group" } : scope === "media" ? { type: "entity", id: MEDIA } : { type: "unit", id: DEPT } }],
});
const nobody: Principal = { personId: "00000000-0000-4000-8000-00000000bbbb", workforceType: "employee", grants: [] };

describe("profitability (pjm:cost)", () => {
  it("is for the owner, C-level and finance", () => {
    expect(canReadProfitability(grantee("owner", "group"))).toBe(true);
    expect(canReadProfitability(grantee("c_level"))).toBe(true);
    expect(canReadProfitability(grantee("finance"))).toBe(true);
  });

  it("is refused to everyone else — directors, heads, HR, payroll and plain employees", () => {
    for (const role of ["entity_director", "department_head", "hr_admin", "payroll", "auditor"] as Role[]) expect(canReadProfitability(grantee(role)), role).toBe(false);
    expect(canReadProfitability(nobody)).toBe(false);
  });

  it("covers only the projects of the entities the grant reaches, and a group project only group-wide", () => {
    expect(canSeeProfitabilityOf(grantee("finance"), { entityId: MEDIA })).toBe(true);
    expect(canSeeProfitabilityOf(grantee("finance"), { entityId: CREATIVE })).toBe(false);
    expect(canSeeProfitabilityOf(grantee("finance"), { entityId: null })).toBe(false);
    expect(canSeeProfitabilityOf(grantee("finance", "group"), { entityId: null })).toBe(true);
    expect(canSeeProfitabilityOf(grantee("owner", "group"), { entityId: CREATIVE })).toBe(true);
    // A director sees fees (`pjm:commercial`) but no cost: no margin.
    expect(canSeeProfitabilityOf(grantee("entity_director"), { entityId: MEDIA })).toBe(false);
  });
});

describe("delivery and compliance", () => {
  const teams = [
    { id: "video", entityId: MEDIA, departmentId: DEPT },
    { id: "social", entityId: MEDIA, departmentId: null },
    { id: "brand", entityId: CREATIVE, departmentId: null },
  ];

  it("opens the dashboard to anybody signed in — the figures are scoped, not the door", () => {
    expect(canOpenDelivery(nobody)).toBe(true);
    expect(canOpenDelivery({ ...nobody, personId: null })).toBe(false);
  });

  it("covers the teams a person leads, and under pjm:portfolio the teams of the scope", () => {
    expect(complianceTeamIds(nobody, new Set(), teams)).toEqual([]);
    expect(complianceTeamIds(nobody, new Set(["social"]), teams)).toEqual(["social"]);
    expect(complianceTeamIds(grantee("department_head", "dept"), new Set(), teams)).toEqual(["video"]);
    expect(complianceTeamIds(grantee("entity_director"), new Set(), teams)).toEqual(["video", "social"]);
    expect(complianceTeamIds(grantee("c_level", "group"), new Set(), teams)).toEqual(["video", "social", "brand"]);
    // Finance holds pjm:cost, not pjm:portfolio: no one's reports.
    expect(complianceTeamIds(grantee("finance"), new Set(), teams)).toEqual([]);
  });
});
