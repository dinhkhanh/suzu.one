import { describe, expect, it } from "vitest";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { canAdjustBonusLine, canApproveBonusRun, canApprovePayroll, canDecideBonusScheme, canDecidePayRules, canDecideSalaryChange, canManageBonusRun, canManageCompensation, canPayPayroll, canProposeBonusRun, canProposeBonusScheme, canProposePayRules, canReadBonusRun, canReadPayroll, canSeeSimpleProfileReport, canViewBonusOf, canViewCompensationOf, compensationReach, hasPayrollDesk } from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const employee = { personId: "p-huy", entityId: SZM, departmentId: "d-video", managerId: "p-long" };

const principal = (personId: string, grants: Grant[] = [], workforceType: Principal["workforceType"] = "employee"): Principal => ({ personId, workforceType, grants });
const group = { type: "group" } as const;
const inSzm = { type: "entity", id: SZM } as const;
const inSzc = { type: "entity", id: SZC } as const;

const owner = principal("p-owner", [{ role: "owner", scope: group }]);
const ceo = principal("p-ceo", [{ role: "c_level", scope: group }]);
const hrLead = principal("p-hr-lead", [{ role: "hr_admin", scope: group }]);
const cnbSzm = principal("p-cnb", [{ role: "payroll", scope: inSzm }]);
const cnbSzc = principal("p-cnb-szc", [{ role: "payroll", scope: inSzc }]);
const accountant = principal("p-fin", [{ role: "finance", scope: inSzm }]);
const auditor = principal("p-audit", [{ role: "auditor", scope: group }]);
const lineManager = principal("p-long");
const departmentHead = principal("p-long", [{ role: "department_head", scope: { type: "unit", id: "d-video" } }]);
const entityDirector = principal("p-director", [{ role: "entity_director", scope: inSzm }]);
const hrStaff = principal("p-bao", [{ role: "hr_staff", scope: inSzm }]);
const colleague = principal("p-colleague");
const self = principal("p-huy");

describe("payroll policy: one person's salary and payslips", () => {
  it("opens for the person, C&B over their entity, the HR lead and the owner", () => {
    for (const viewer of [self, cnbSzm, hrLead, owner]) expect(canViewCompensationOf(viewer, employee)).toBe(true);
  });

  it("stays shut for the line manager, the department head, the entity director and HR staff", () => {
    for (const viewer of [lineManager, departmentHead, entityDirector, hrStaff, colleague]) {
      expect(canViewCompensationOf(viewer, employee)).toBe(false);
      expect(canManageCompensation(viewer, employee)).toBe(false);
      expect(canReadPayroll(viewer, employee)).toBe(false);
      expect(canDecideSalaryChange(viewer, employee)).toBe(false);
      expect(hasPayrollDesk(viewer)).toBe(false);
    }
  });

  it("a department head who is also the line manager still sees nothing", () => {
    const both = principal("p-long", [{ role: "department_head", scope: { type: "unit", id: "d-video" } }, { role: "department_head", scope: inSzm }]);
    expect(canViewCompensationOf(both, employee)).toBe(false);
  });

  it("refuses C&B of another entity", () => {
    expect(canViewCompensationOf(cnbSzc, employee)).toBe(false);
    expect(canManageCompensation(cnbSzc, { entityId: SZM })).toBe(false);
    expect(canManageCompensation(cnbSzc, { entityId: SZC })).toBe(true);
  });

  it("the CEO, the chief accountant and an auditor read the register but not an individual's pay", () => {
    for (const viewer of [ceo, accountant, auditor]) {
      expect(canReadPayroll(viewer, { entityId: SZM })).toBe(true);
      expect(canViewCompensationOf(viewer, employee)).toBe(false);
    }
  });

  it("a person without an entity is reached by group-wide grants only", () => {
    const floating = { personId: "p-x", entityId: null };
    expect(canViewCompensationOf(cnbSzm, floating)).toBe(false);
    expect(canViewCompensationOf(hrLead, floating)).toBe(true);
    expect(canViewCompensationOf(principal("p-x"), floating)).toBe(true);
  });

  it("a signed-in account with no person reads nobody's pay, not even a row with a null person", () => {
    const nobody: Principal = { personId: null, workforceType: null, grants: [] };
    expect(canViewCompensationOf(nobody, employee)).toBe(false);
  });
});

describe("payroll policy: the run and the rules (SRS D17)", () => {
  it("HR lead and C&B propose, the CEO approves, the chief accountant pays — nobody holds two hats by default", () => {
    expect(canManageCompensation(hrLead, { entityId: SZM })).toBe(true);
    expect(canApprovePayroll(hrLead, { entityId: SZM })).toBe(false);
    expect(canPayPayroll(hrLead, { entityId: SZM })).toBe(false);
    expect(canApprovePayroll(ceo, { entityId: SZM })).toBe(true);
    expect(canManageCompensation(ceo, { entityId: SZM })).toBe(false);
    expect(canPayPayroll(ceo, { entityId: SZM })).toBe(false);
    expect(canPayPayroll(accountant, { entityId: SZM })).toBe(true);
    expect(canPayPayroll(accountant, { entityId: SZC })).toBe(false);
    expect(canApprovePayroll(accountant, { entityId: SZM })).toBe(false);
    for (const check of [canManageCompensation, canApprovePayroll, canPayPayroll, canReadPayroll]) expect(check(owner, { entityId: SZC })).toBe(true);
  });

  it("only the owner decides rules and sees the Simple-profile exposure report", () => {
    expect(canDecidePayRules(owner)).toBe(true);
    expect(canSeeSimpleProfileReport(owner)).toBe(true);
    for (const viewer of [ceo, hrLead, cnbSzm, accountant, auditor, entityDirector, departmentHead, hrStaff, self]) {
      expect(canDecidePayRules(viewer)).toBe(false);
      expect(canSeeSimpleProfileReport(viewer)).toBe(false);
    }
  });

  it("rule proposals take a group-wide rules:propose", () => {
    expect(canProposePayRules(hrLead)).toBe(true);
    expect(canProposePayRules(cnbSzm)).toBe(false);
    expect(canProposePayRules(principal("p-cnb-group", [{ role: "payroll", scope: group }]))).toBe(true);
    expect(canProposePayRules(departmentHead)).toBe(false);
  });

  it("who may answer a salary change", () => {
    expect(canDecideSalaryChange(owner, employee)).toBe(true);
    expect(canDecideSalaryChange(ceo, employee)).toBe(true);
    expect(canDecideSalaryChange(cnbSzc, employee)).toBe(false);
    expect(canDecideSalaryChange(accountant, employee)).toBe(false);
  });

  it("list queries reach the entities of the grants and nothing for the org chart", () => {
    expect(compensationReach(owner)).toEqual({ all: true });
    expect(compensationReach(cnbSzm)).toEqual({ all: false, entityIds: [SZM] });
    expect(compensationReach(departmentHead)).toEqual({ all: false, entityIds: [] });
    expect(compensationReach(lineManager)).toEqual({ all: false, entityIds: [] });
    expect(compensationReach(ceo)).toEqual({ all: false, entityIds: [] });
  });
});

// ── The year-end bonus (FR-PAY-21, Phase 8) ─────────────────────────────────────────────────
// The line the phase has to hold: a line manager and a department head read the person's review
// and see their performance band, and see **no bonus amount at all**. The band is performance;
// the đồng are pay, and pay never follows the org chart.

describe("the year-end bonus is compensation like everything else here", () => {
  const runEntities = [SZM, SZC];

  it("gives the line manager, the department head and the entity director nothing", () => {
    for (const viewer of [lineManager, departmentHead, entityDirector, hrStaff, colleague]) {
      expect(canViewBonusOf(viewer, employee)).toBe(false);
      expect(canReadBonusRun(viewer, [SZM])).toBe(false);
      expect(canManageBonusRun(viewer, [SZM])).toBe(false);
      expect(canProposeBonusRun(viewer, [SZM])).toBe(false);
      expect(canApproveBonusRun(viewer, [SZM])).toBe(false);
      expect(canAdjustBonusLine(viewer)).toBe(false);
    }
  });

  it("lets the person see their own amount", () => {
    expect(canViewBonusOf(self, employee)).toBe(true);
    expect(canViewBonusOf(cnbSzm, employee)).toBe(true);
    expect(canViewBonusOf(owner, employee)).toBe(true);
    // Not even the CEO reads one person's pay — they approve the run, they do not browse it.
    expect(canViewBonusOf(ceo, employee)).toBe(false);
  });

  it("needs the permission over *every* entity a group-wide run covers", () => {
    expect(canManageBonusRun(cnbSzm, [SZM])).toBe(true);
    expect(canManageBonusRun(cnbSzm, runEntities)).toBe(false);
    expect(canManageBonusRun(hrLead, runEntities)).toBe(true);
    expect(canManageBonusRun(owner, runEntities)).toBe(true);
    // An empty run reaches nobody: "every entity" of nothing is not "yes".
    expect(canManageBonusRun(owner, [])).toBe(false);
    expect(canApproveBonusRun(owner, [])).toBe(false);
  });

  it("splits the three desks the way SRS D13 asks", () => {
    // HR proposes…
    expect(canProposeBonusRun(hrLead, runEntities)).toBe(true);
    expect(canProposeBonusRun(ceo, runEntities)).toBe(false);
    // …the owner adjusts an individual amount, and nobody else — not the CEO, not C&B…
    expect(canAdjustBonusLine(owner)).toBe(true);
    for (const viewer of [ceo, hrLead, cnbSzm, accountant, auditor]) expect(canAdjustBonusLine(viewer)).toBe(false);
    // …and the CEO signs.
    expect(canApproveBonusRun(ceo, runEntities)).toBe(true);
    expect(canApproveBonusRun(hrLead, runEntities)).toBe(false);
    expect(canApproveBonusRun(owner, runEntities)).toBe(true);
  });

  it("keeps the scheme a pay rule: C&B proposes, the owner decides", () => {
    expect(canProposeBonusScheme(hrLead)).toBe(true);
    expect(canDecideBonusScheme(hrLead)).toBe(false);
    expect(canDecideBonusScheme(owner)).toBe(true);
    expect(canDecideBonusScheme(ceo)).toBe(false);
  });

  it("lets the auditor and the CEO read the register without reading a person's amount", () => {
    expect(canReadBonusRun(auditor, runEntities)).toBe(true);
    expect(canReadBonusRun(ceo, runEntities)).toBe(true);
    expect(canViewBonusOf(auditor, employee)).toBe(false);
  });
});
