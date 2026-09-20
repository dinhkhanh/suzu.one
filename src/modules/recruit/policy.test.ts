import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import {
  canActOnApplication,
  canBrowseCandidates,
  canConvertToEmployee,
  canEditOpening,
  canFileHiringRequest,
  canManageCandidates,
  canMakeOffer,
  canManagePipelines,
  canOpenCandidateFile,
  canOpenFromHiringRequest,
  canReadRecruitMoney,
  canRecordOfferResponse,
  canRunRecruitment,
  canViewHiringRequest,
  canViewOffer,
  canViewOpening,
} from "./policy";

const SZM = "00000000-0000-4000-8000-000000000001";
const SZC = "00000000-0000-4000-8000-000000000002";
const VID = "00000000-0000-4000-8000-00000000000a";
const DES = "00000000-0000-4000-8000-00000000000b";

const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrAdmin = principal("hr-admin", [{ role: "hr_admin", scope: { type: "group" } }]);
const hrStaff = principal("hr-staff", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const recruiter = principal("recruiter", [{ role: "recruiter", scope: { type: "group" } }]);
const entityRecruiter = principal("szm-recruiter", [{ role: "recruiter", scope: { type: "entity", id: SZM } }]);
const otherRecruiter = principal("szc-recruiter", [{ role: "recruiter", scope: { type: "entity", id: SZC } }]);
const head = principal("head", [{ role: "department_head", scope: { type: "department", id: VID } }]);
const finance = principal("finance", [{ role: "finance", scope: { type: "group" } }]);
const payroll = principal("payroll", [{ role: "payroll", scope: { type: "group" } }]);
const ceo = principal("ceo", [{ role: "c_level", scope: { type: "group" } }]);
const auditor = principal("auditor", [{ role: "auditor", scope: { type: "group" } }]);
const director = principal("director", [{ role: "entity_director", scope: { type: "entity", id: SZM } }]);
const employee = principal("employee");

const opening = { entityId: SZM, departmentId: VID, teamId: null };
const otherOpening = { entityId: SZC, departmentId: DES, teamId: null };

// Everybody in the catalogue who is not a recruiter of some kind.
const outsiders = [finance, payroll, ceo, auditor, director, head, employee];

describe("running recruitment", () => {
  it("is recruit:manage over the opening's entity", () => {
    for (const who of [owner, hrAdmin, hrStaff, recruiter, entityRecruiter]) expect(canRunRecruitment(who, opening)).toBe(true);
    expect(canRunRecruitment(entityRecruiter, otherOpening)).toBe(false);
    expect(canRunRecruitment(otherRecruiter, opening)).toBe(false);
  });

  it("is held by nobody else in the catalogue", () => {
    for (const who of outsiders) expect(canRunRecruitment(who, opening)).toBe(false);
  });

  it("navigation asks 'anywhere at all'", () => {
    expect([owner, hrAdmin, hrStaff, recruiter, otherRecruiter].every((who) => canRunRecruitment(who))).toBe(true);
    expect(outsiders.some((who) => canRunRecruitment(who))).toBe(false);
  });

  it("the pipeline library is group-wide: an entity's recruiter does not edit it", () => {
    expect(canManagePipelines(owner)).toBe(true);
    expect(canManagePipelines(hrAdmin)).toBe(true);
    expect(canManagePipelines(recruiter)).toBe(true);
    expect(canManagePipelines(entityRecruiter)).toBe(false);
    expect(canManagePipelines(hrStaff)).toBe(false);
  });
});

// The decision this module is asked to defend: a hiring manager gets *their* opening, and the
// candidate database is not theirs to browse.
describe("the hiring team", () => {
  it("opens the opening they are on, and only that one", () => {
    expect(canViewOpening(head, opening, true)).toBe(true);
    expect(canViewOpening(head, opening, false)).toBe(false);
    expect(canViewOpening(head, otherOpening, false)).toBe(false);
  });

  it("acts on its applications — moves them, notes on them", () => {
    expect(canActOnApplication(head, opening, true)).toBe(true);
    expect(canActOnApplication(head, opening, false)).toBe(false);
  });

  it("opens the CVs of its own opening, and no others", () => {
    expect(canOpenCandidateFile(head, opening, true)).toBe(true);
    expect(canOpenCandidateFile(head, opening, false)).toBe(false);
    expect(canOpenCandidateFile(employee, opening, false)).toBe(false);
  });

  it("does not edit the posting — a hiring manager asks, a recruiter writes", () => {
    expect(canEditOpening(head, opening)).toBe(false);
    expect(canEditOpening(entityRecruiter, opening)).toBe(true);
  });

  it("never browses the candidate database", () => {
    expect(canBrowseCandidates(head)).toBe(false);
    expect(canManageCandidates(head)).toBe(false);
    for (const who of outsiders) expect(canBrowseCandidates(who)).toBe(false);
    for (const who of [owner, hrAdmin, hrStaff, recruiter, otherRecruiter]) expect(canBrowseCandidates(who)).toBe(true);
  });

  // Membership without a person record is not membership at all.
  it("is nothing without a person", () => {
    expect(canViewOpening({ personId: null, workforceType: null, grants: [] }, opening, true)).toBe(false);
  });
});

describe("nobody else reaches an opening", () => {
  it("not finance, not payroll, not the CEO, not the auditors, not a colleague", () => {
    for (const who of [finance, payroll, ceo, auditor, director, employee]) {
      expect(canViewOpening(who, opening, false)).toBe(false);
      expect(canActOnApplication(who, opening, false)).toBe(false);
      expect(canOpenCandidateFile(who, opening, false)).toBe(false);
    }
  });

  it("nor a recruiter of another entity", () => {
    expect(canViewOpening(otherRecruiter, opening, false)).toBe(false);
    expect(canEditOpening(otherRecruiter, opening)).toBe(false);
    expect(canOpenCandidateFile(otherRecruiter, opening, false)).toBe(false);
  });
});

// The second decision: running the pipeline and seeing the money are different authorities.
describe("the money", () => {
  it("is read by a covering grant whose role may read compensation", () => {
    expect(canReadRecruitMoney(owner, opening)).toBe(true);
    expect(canReadRecruitMoney(hrAdmin, opening)).toBe(true);
  });

  it("is not read by a plain recruiter, who runs the whole pipeline", () => {
    expect(canRunRecruitment(recruiter, opening)).toBe(true);
    expect(canReadRecruitMoney(recruiter, opening)).toBe(false);
    expect(canReadRecruitMoney(entityRecruiter, opening)).toBe(false);
  });

  it("is not read by HR staff either — their tier stops at restricted", () => {
    expect(canRunRecruitment(hrStaff, opening)).toBe(true);
    expect(canReadRecruitMoney(hrStaff, opening)).toBe(false);
  });

  it("is not read by the hiring manager: line managers never see compensation", () => {
    expect(canViewOpening(head, opening, true)).toBe(true);
    expect(canReadRecruitMoney(head, opening)).toBe(false);
  });

  // A compensation-tier role that cannot open the opening cannot reach the figure through it
  // either: the rule admits nobody it does not already let in (the trap assets/policy.ts records).
  it("is not a back door for finance, payroll or the CEO", () => {
    for (const who of [finance, payroll, ceo, auditor]) {
      expect(canReadRecruitMoney(who, opening)).toBe(false);
      expect(canViewOpening(who, opening, false)).toBe(false);
    }
  });

  it("is scoped: HR of one entity does not read another entity's band", () => {
    const szmHrAdmin = principal("szm-hr", [{ role: "hr_admin", scope: { type: "entity", id: SZM } }]);
    expect(canReadRecruitMoney(szmHrAdmin, opening)).toBe(true);
    expect(canReadRecruitMoney(szmHrAdmin, otherOpening)).toBe(false);
  });
});

describe("hiring requests", () => {
  const request = { entityId: SZM, departmentId: VID, teamId: null, requestedByPersonId: "head", hiringManagerPersonId: "head" };

  it("anybody with a person record may ask for a head", () => {
    for (const who of [head, employee, finance, recruiter]) expect(canFileHiringRequest(who)).toBe(true);
    expect(canFileHiringRequest({ personId: null, workforceType: null, grants: [] })).toBe(false);
  });

  it("is read by its author, its hiring manager and the recruiters of its entity", () => {
    expect(canViewHiringRequest(head, request)).toBe(true);
    expect(canViewHiringRequest(entityRecruiter, request)).toBe(true);
    expect(canViewHiringRequest(hrAdmin, request)).toBe(true);
  });

  it("is read by nobody else — not a colleague, not another entity's recruiter", () => {
    expect(canViewHiringRequest(employee, request)).toBe(false);
    expect(canViewHiringRequest(otherRecruiter, request)).toBe(false);
    expect(canViewHiringRequest(finance, request)).toBe(false);
  });

  it("is turned into an opening by the recruiter of the entity that asked", () => {
    expect(canOpenFromHiringRequest(entityRecruiter, request)).toBe(true);
    expect(canOpenFromHiringRequest(otherRecruiter, request)).toBe(false);
    expect(canOpenFromHiringRequest(head, request)).toBe(false);
  });
});

describe("offers (FR-REC-08) and becoming an employee (FR-REC-09)", () => {
  it("is drafted only by whoever may read a salary over that opening", () => {
    for (const who of [owner, hrAdmin]) expect(canMakeOffer(who, opening)).toBe(true);
    // The pipeline runs it; it does not price it. A recruiter never types a figure.
    for (const who of [recruiter, entityRecruiter, hrStaff, head, ...outsiders]) expect(canMakeOffer(who, opening)).toBe(false);
    // And the money authority is scoped: group-wide HR over one entity is not HR over the other.
    expect(canMakeOffer(principal("szm-hr", [{ role: "hr_admin", scope: { type: "entity", id: SZM } }]), otherOpening)).toBe(false);
  });

  it("is seen — as a fact, without its figure — by everybody who runs the opening", () => {
    for (const who of [owner, hrAdmin, hrStaff, entityRecruiter]) expect(canViewOffer(who, opening, false)).toBe(true);
    // The hiring manager reaches it through the hiring team, and only theirs.
    expect(canViewOffer(head, opening, true)).toBe(true);
    expect(canViewOffer(head, opening, false)).toBe(false);
    for (const who of [finance, payroll, ceo, auditor, employee]) expect(canViewOffer(who, opening, false)).toBe(false);
  });

  it("separates seeing that an offer exists from seeing what it says", () => {
    // The pair that matters: `hr_staff` runs the offer through its life and is never shown a đồng.
    expect(canViewOffer(hrStaff, opening, false)).toBe(true);
    expect(canReadRecruitMoney(hrStaff, opening)).toBe(false);
    expect(canViewOffer(head, opening, true)).toBe(true);
    expect(canReadRecruitMoney(head, opening)).toBe(false);
  });

  it("has the candidate's answer written down by whoever took the call", () => {
    for (const who of [hrAdmin, hrStaff, entityRecruiter]) expect(canRecordOfferResponse(who, opening, false)).toBe(true);
    expect(canRecordOfferResponse(head, opening, true)).toBe(true);
    for (const who of [finance, ceo, employee, otherRecruiter]) expect(canRecordOfferResponse(who, opening, false)).toBe(false);
  });

  it("is turned into an employee only by somebody who may put people on the books", () => {
    // `person:manage` as well as recruitment: conversion writes to the employee register.
    for (const who of [owner, hrAdmin, hrStaff]) expect(canConvertToEmployee(who, opening)).toBe(true);
    // A recruiter may run every opening in the group and still cannot create an employee.
    for (const who of [recruiter, entityRecruiter]) expect(canConvertToEmployee(who, opening)).toBe(false);
    // Nor may someone who may put people on the books elsewhere but runs no recruitment here.
    for (const who of [head, finance, ceo, auditor, employee]) expect(canConvertToEmployee(who, opening)).toBe(false);
    expect(canConvertToEmployee(hrStaff, otherOpening)).toBe(false);
  });
});
