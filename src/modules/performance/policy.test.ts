import { describe, expect, it } from "vitest";
import { canReadTier, type Grant, type Principal, readableTier } from "../platform/rbac/policy";
import { canReadBonusRun, canViewBonusOf, canViewCompensationOf } from "../payroll/policy";
import { canComputeResults, canDecideOutcome, canDecidePerformanceRules, canOverrideResult, canProposeWeighting, canRaiseOutcome, canReadOneOnOne, canReadOneOnOnePrivate, canReadResultOf, canSettleResultOf, canWriteOneOnOne } from "./policy";
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

// ── The final yearly result (Phase 8 week 2, FR-PRF-09) ─────────────────────────────────────
describe("the final yearly result", () => {
  const hrAdmin = principal("mai", [{ role: "hr_admin", scope: { type: "group" } }]);
  const ceo = principal("ceo", [{ role: "c_level", scope: { type: "group" } }]);

  it("is read by the same people as the rest of a person's performance data", () => {
    expect(canReadResultOf(principal("huy"), huy)).toBe(true); // one's own
    expect(canReadResultOf(principal("tam"), huy)).toBe(true); // line manager
    expect(canReadResultOf(headVid, huy)).toBe(true); // skip-level
    expect(canReadResultOf(hrSzm, huy)).toBe(true);
    expect(canReadResultOf(owner, huy)).toBe(true);
    expect(canReadResultOf(principal("linh"), huy)).toBe(false); // colleague
    expect(canReadResultOf(headDes, huy)).toBe(false); // another department's head
  });

  it("is computed and settled by HR, never by the person's manager", () => {
    expect(canComputeResults(hrSzm, SZM)).toBe(true);
    expect(canComputeResults(hrSzm, SZC)).toBe(false);
    expect(canComputeResults(headVid, SZM)).toBe(false);
    expect(canComputeResults(principal("huy"), SZM)).toBe(false);
    expect(canSettleResultOf(hrSzm, huy)).toBe(true);
    expect(canSettleResultOf(headVid, huy)).toBe(false);
    expect(canSettleResultOf(principal("tam"), huy)).toBe(false);
  });

  /**
   * The override and the weighting are the owner's alone (SRS D13). Nobody else — not the CEO who
   * signs payroll, not the HR administrator who computed the figure in the first place.
   */
  it("is overridden, and its weighting decided, by the owner alone", () => {
    expect(canOverrideResult(owner)).toBe(true);
    expect(canDecidePerformanceRules(owner)).toBe(true);
    for (const who of [ceo, hrAdmin, hrSzm, headVid, auditor, principal("huy")]) {
      expect(canOverrideResult(who)).toBe(false);
      expect(canDecidePerformanceRules(who)).toBe(false);
    }
    // Proposing a version is group-wide HR's; an entity's HR cannot change a group-wide rule.
    expect(canProposeWeighting(hrAdmin)).toBe(true);
    expect(canProposeWeighting(hrSzm)).toBe(false);
    expect(canProposeWeighting(owner)).toBe(true);
  });

  /**
   * The line that FR-ACL and SRS §2.2 draw, and the reason the bonus lives in payroll rather than
   * here: a line manager reads their report's **band and multiplier** — numbers about performance,
   * personal tier — and reads nothing at compensation tier, where the amount of money lives.
   */
  it("keeps a line manager on the personal side of the tier line", () => {
    const tam = principal("tam");
    expect(canReadResultOf(tam, huy)).toBe(true);
    expect(readableTier(tam, { ...huy, managerId: "tam" })).toBe("personal");
    expect(canReadTier(tam, { ...huy, managerId: "tam" }, "compensation")).toBe(false);
    expect(canReadTier(tam, { ...huy, managerId: "tam" }, "restricted")).toBe(false);
    // A department head is no different: their role's ceiling is personal too.
    expect(readableTier(headVid, huy)).toBe("personal");
    expect(canReadTier(headVid, huy, "compensation")).toBe(false);
    // Payroll's own rule says the same thing from the other side: no compensation without a
    // payroll grant over the entity, whatever the reporting line says.
    expect(canViewCompensationOf(tam, { personId: "huy", entityId: SZM })).toBe(false);
    expect(canViewCompensationOf(headVid, { personId: "huy", entityId: SZM })).toBe(false);
    expect(canViewCompensationOf(hrSzm, { personId: "huy", entityId: SZM })).toBe(false); // HR staff is not C&B
    expect(canViewCompensationOf(owner, { personId: "huy", entityId: SZM })).toBe(true);
  });
});

// ── 1:1 notes and review outcomes, and the bonus line (Phase 8 week 3) ──────────────────────

describe("1:1 meeting notes (FR-PRF-04)", () => {
  const meeting = { managerPersonId: "tam", person: huy };

  it("is written by the manager who holds it, or HR — never by the subject", () => {
    expect(canWriteOneOnOne(principal("tam"), meeting)).toBe(true);
    expect(canWriteOneOnOne(principal("huy"), meeting)).toBe(false);
    expect(canWriteOneOnOne(hrSzm, meeting)).toBe(true);
    expect(canWriteOneOnOne(principal("linh"), meeting)).toBe(false);
  });

  it("shares the agenda and the shared notes with both sides and the line above", () => {
    for (const viewer of [principal("tam"), principal("huy"), headVid, hrSzm, owner]) expect(canReadOneOnOne(viewer, meeting)).toBe(true);
    // A colleague in the same department is still a colleague.
    expect(canReadOneOnOne(principal("linh"), meeting)).toBe(false);
  });

  it("keeps the private notes to the one manager who wrote them — not the subject, not HR", () => {
    expect(canReadOneOnOnePrivate(principal("tam"), meeting)).toBe(true);
    for (const viewer of [principal("huy"), headVid, hrSzm, owner, auditor]) expect(canReadOneOnOnePrivate(viewer, meeting)).toBe(false);
  });
});

describe("review outcomes (FR-PRF-06)", () => {
  it("is raised by the chain above or HR, and decided by HR", () => {
    expect(canRaiseOutcome(principal("tam"), huy)).toBe(true);
    expect(canRaiseOutcome(headVid, huy)).toBe(true);
    expect(canRaiseOutcome(principal("huy"), huy)).toBe(false); // not about yourself
    expect(canDecideOutcome(principal("tam"), huy)).toBe(false);
    expect(canDecideOutcome(hrSzm, huy)).toBe(true);
  });
});

describe("the review→pay link stays on payroll's side of the line", () => {
  it("shows a line manager the band and refuses them the bonus amount", () => {
    const tam = principal("tam");
    // The band and the multiplier: personal tier, and theirs to read (asserted above).
    expect(canReadResultOf(tam, huy)).toBe(true);
    // The amount built on it: compensation tier, and not theirs, by payroll's own rule.
    expect(canViewBonusOf(tam, { personId: "huy", entityId: SZM })).toBe(false);
    expect(canViewBonusOf(headVid, { personId: "huy", entityId: SZM })).toBe(false);
    expect(canReadBonusRun(tam, [SZM])).toBe(false);
    expect(canReadBonusRun(headVid, [SZM])).toBe(false);
    // And the person themself does read their own.
    expect(canViewBonusOf(principal("huy"), { personId: "huy", entityId: SZM })).toBe(true);
  });
});
