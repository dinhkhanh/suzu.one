import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "../platform/rbac/policy";
import { canCheckIn, canCloseGoal, canCloseKpiMonth, canEditGoal, canEnterActualsFor, canManageAssignmentsOf, canManageKpiLibrary, canManagePositionKpis, canOpenOverview, canReadPerformanceOf, canReopenGoal, canReopenKpiMonth, canSeeGoal, chainAbove, type GoalParties, overviewReach, type PersonContext, readablePeople, unitTarget } from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const VID = "dept-vid";
const DES = "dept-des";

const principal = (personId: string, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });

// owner → ceo → long (head of VID) → tam → huy; chi heads DES at SZC.
const managerOf = new Map<string, string | null>([["owner", null], ["ceo", "owner"], ["long", "ceo"], ["tam", "long"], ["huy", "tam"], ["linh", "long"], ["chi", "ceo"], ["khoi", "chi"]]);
const person = (personId: string, entityId: string, departmentId: string): PersonContext => ({ personId, entityId, departmentId, teamId: null, managerId: managerOf.get(personId) ?? null, chainAbove: chainAbove(managerOf, personId) });
const huy = person("huy", SZM, VID);
const khoi = person("khoi", SZC, DES);
const individual = (who: PersonContext): GoalParties => ({ level: "individual", entityId: who.entityId ?? null, departmentId: who.departmentId ?? null, teamId: null, ownerPersonId: who.personId, person: who });
const unit = (level: GoalParties["level"], over: Partial<GoalParties> = {}): GoalParties => ({ level, entityId: null, departmentId: null, teamId: null, ownerPersonId: "ceo", person: null, ...over });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrSzm = principal("bao", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const headVid = principal("long", [{ role: "department_head", scope: { type: "department", id: VID } }]);
const headDes = principal("chi", [{ role: "department_head", scope: { type: "department", id: DES } }]);
const auditor = principal("aud", [{ role: "auditor", scope: { type: "group" } }]);

describe("chainAbove", () => {
  it("lists every manager above, nearest first, and survives a loop", () => {
    expect(chainAbove(managerOf, "huy")).toEqual(["tam", "long", "ceo", "owner"]);
    expect(chainAbove(managerOf, "owner")).toEqual([]);
    expect(chainAbove(new Map([["a", "b"], ["b", "a"]]), "a")).toEqual(["b"]);
  });
});

describe("reading", () => {
  it("keeps an individual's goals to the person, the line above, HR and leaders in scope", () => {
    expect(canReadPerformanceOf(principal("huy"), huy)).toBe(true);
    expect(canReadPerformanceOf(principal("tam"), huy)).toBe(true); // line manager
    expect(canReadPerformanceOf(headVid, huy)).toBe(true); // skip-level, and head of the department
    expect(canReadPerformanceOf(principal("ceo"), huy)).toBe(true); // further up, no role needed
    expect(canReadPerformanceOf(hrSzm, huy)).toBe(true);
    expect(canReadPerformanceOf(auditor, huy)).toBe(true);
    expect(canReadPerformanceOf(owner, huy)).toBe(true);
    expect(canReadPerformanceOf(principal("linh"), huy)).toBe(false); // colleague
    expect(canReadPerformanceOf(headDes, huy)).toBe(false); // another department's head
    expect(canReadPerformanceOf(hrSzm, khoi)).toBe(false); // another entity's HR
    expect(canReadPerformanceOf(principal("huy"), person("tam", SZM, VID))).toBe(false); // never upwards
  });

  it("shows unit goals to the staff, not to collaborators", () => {
    expect(canSeeGoal(principal("huy"), unit("group"))).toBe(true);
    expect(canSeeGoal(principal("huy"), unit("department", { departmentId: DES }))).toBe(true);
    expect(canSeeGoal(principal("ngo", [], "collaborator"), unit("group"))).toBe(false);
    expect(canSeeGoal(principal("ngo", [], "collaborator"), unit("team", { ownerPersonId: "ngo" }))).toBe(true);
    const ngo = person("ngo", SZM, VID);
    expect(canSeeGoal(principal("ngo", [], "collaborator"), individual(ngo))).toBe(true);
    expect(canSeeGoal(principal("linh"), individual(huy))).toBe(false);
  });

  it("has a list form that agrees with the single check", () => {
    const people = ["owner", "ceo", "long", "tam", "huy", "linh"].map((id) => person(id, SZM, VID)).concat(["chi", "khoi"].map((id) => person(id, SZC, DES)));
    for (const viewer of [owner, hrSzm, headVid, headDes, auditor, principal("tam"), principal("huy"), principal("ceo")]) {
      const readable = readablePeople(viewer, people);
      for (const candidate of people) expect([viewer.personId, candidate.personId, readable.has(candidate.personId)]).toEqual([viewer.personId, candidate.personId, canReadPerformanceOf(viewer, candidate)]);
    }
  });
});

describe("changing", () => {
  it("lets the person, the line above and HR edit an individual goal", () => {
    expect(canEditGoal(principal("huy"), individual(huy))).toBe(true);
    expect(canEditGoal(principal("tam"), individual(huy))).toBe(true);
    expect(canEditGoal(hrSzm, individual(huy))).toBe(true);
    expect(canEditGoal(auditor, individual(huy))).toBe(false); // reads only
    expect(canEditGoal(headDes, individual(huy))).toBe(false);
    expect(canEditGoal(principal("linh"), individual(huy))).toBe(false);
  });

  it("ties unit goals to the grant's scope", () => {
    expect(unitTarget(unit("group"))).toEqual({});
    const ceo = principal("ceo", [{ role: "c_level", scope: { type: "group" } }]);
    expect(canEditGoal(ceo, unit("group"))).toBe(true);
    expect(canEditGoal(headVid, unit("group"))).toBe(false);
    expect(canEditGoal(headVid, unit("department", { departmentId: VID, entityId: SZM }))).toBe(true);
    expect(canEditGoal(headVid, unit("team", { teamId: "team-1", departmentId: VID }))).toBe(true);
    expect(canEditGoal(headVid, unit("department", { departmentId: DES }))).toBe(false);
    expect(canEditGoal(headVid, unit("entity", { entityId: SZM }))).toBe(false);
    expect(canEditGoal(hrSzm, unit("entity", { entityId: SZM }))).toBe(true);
    expect(canEditGoal(hrSzm, unit("entity", { entityId: SZC }))).toBe(false);
    expect(canEditGoal(hrSzm, unit("group"))).toBe(false);
    expect(canEditGoal(principal("director", [{ role: "entity_director", scope: { type: "entity", id: SZC } }]), unit("entity", { entityId: SZC }))).toBe(true);
    expect(canEditGoal(principal("huy"), unit("department", { departmentId: VID }))).toBe(false);
  });

  it("lets the accountable owner check in without any right to edit", () => {
    const goal = unit("department", { departmentId: DES, ownerPersonId: "khoi" });
    expect(canCheckIn(principal("khoi"), goal)).toBe(true);
    expect(canEditGoal(principal("khoi"), goal)).toBe(false);
    expect(canCheckIn(principal("huy"), goal)).toBe(false);
    expect(canCheckIn(headDes, goal)).toBe(true);
  });

  it("does not let people close their own goal; reopening is HR's", () => {
    expect(canCloseGoal(principal("huy"), individual(huy))).toBe(false);
    expect(canCloseGoal(principal("tam"), individual(huy))).toBe(true);
    expect(canCloseGoal(hrSzm, individual(huy))).toBe(true);
    expect(canCloseGoal(headVid, unit("department", { departmentId: VID }))).toBe(true);
    expect(canReopenGoal(principal("tam"), individual(huy))).toBe(false);
    expect(canReopenGoal(headVid, unit("department", { departmentId: VID }))).toBe(false);
    expect(canReopenGoal(hrSzm, individual(huy))).toBe(true);
    expect(canReopenGoal(owner, unit("group"))).toBe(true);
  });
});

describe("KPIs", () => {
  const hrAdmin = principal("mai", [{ role: "hr_admin", scope: { type: "group" } }]);
  const director = principal("dir", [{ role: "entity_director", scope: { type: "entity", id: SZC } }]);

  it("lets managers above and HR in scope enter actuals — never the person themself", () => {
    expect(canEnterActualsFor(principal("tam"), huy)).toBe(true);
    expect(canEnterActualsFor(headVid, huy)).toBe(true); // skip-level
    expect(canEnterActualsFor(hrSzm, huy)).toBe(true);
    expect(canEnterActualsFor(principal("huy"), huy)).toBe(false);
    expect(canEnterActualsFor(principal("linh"), huy)).toBe(false); // a colleague
    expect(canEnterActualsFor(headDes, huy)).toBe(false);
    expect(canEnterActualsFor(hrSzm, khoi)).toBe(false); // another entity's HR
    expect(canEnterActualsFor(auditor, huy)).toBe(false); // reads, never writes
    // Holding HR, or everything, changes nothing about one's own row.
    expect(canEnterActualsFor(hrSzm, person("bao", SZM, "dept-hr"))).toBe(false);
    expect(canEnterActualsFor(owner, person("owner", SZM, "dept-bod"))).toBe(false);
    expect(canEnterActualsFor(owner, huy)).toBe(true);
  });

  it("keeps assignments, the library and the close with HR", () => {
    expect(canManageAssignmentsOf(hrSzm, huy)).toBe(true);
    expect(canManageAssignmentsOf(hrSzm, khoi)).toBe(false);
    expect(canManageAssignmentsOf(headVid, huy)).toBe(false);
    expect(canManageAssignmentsOf(hrSzm, person("bao", SZM, "dept-hr"))).toBe(false); // not one's own weights and targets
    expect(canManageAssignmentsOf(owner, person("bao", SZM, "dept-hr"))).toBe(true);
    expect(canManageKpiLibrary(hrAdmin)).toBe(true);
    expect(canManageKpiLibrary(hrSzm)).toBe(false); // the library is the group's
    expect(canManagePositionKpis(hrSzm, SZM)).toBe(true);
    expect(canManagePositionKpis(hrSzm, null)).toBe(false);
    expect(canManagePositionKpis(hrSzm, SZC)).toBe(false);
    expect(canCloseKpiMonth(hrSzm, SZM)).toBe(true);
    expect(canCloseKpiMonth(hrSzm, SZC)).toBe(false);
    expect(canCloseKpiMonth(headVid, SZM)).toBe(false);
    expect(canReopenKpiMonth(hrAdmin)).toBe(true);
    expect(canReopenKpiMonth(hrSzm)).toBe(false);
    expect(canReopenKpiMonth(owner)).toBe(true);
  });

  it("opens the overview to whole entities only", () => {
    expect(overviewReach(owner)).toEqual({ all: true });
    expect(overviewReach(auditor)).toEqual({ all: true });
    expect(overviewReach(hrSzm)).toEqual({ all: false, entityIds: [SZM] });
    expect(overviewReach(director)).toEqual({ all: false, entityIds: [SZC] });
    expect(canOpenOverview(headVid)).toBe(false); // a department is not an entity: the team view is theirs
    expect(canOpenOverview(principal("huy"))).toBe(false);
  });
});
