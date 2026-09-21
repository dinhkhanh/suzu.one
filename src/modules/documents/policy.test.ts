import { describe, expect, it } from "vitest";
import type { Principal } from "../platform/rbac/policy";
import { canGenerate, canManageTemplates, canOpenDocument, canReadTemplates } from "./policy";

const SZM = "00000000-0000-4000-8000-000000000001";
const SZC = "00000000-0000-4000-8000-000000000002";
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const owner = principal("owner", [{ role: "owner", scope: { type: "group" } }]);
const hrAdmin = principal("hr-admin", [{ role: "hr_admin", scope: { type: "group" } }]);
const hrStaff = principal("hr-staff", [{ role: "hr_staff", scope: { type: "entity", id: SZM } }]);
const cAndB = principal("c-and-b", [{ role: "payroll", scope: { type: "entity", id: SZM } }]);
const manager = principal("boss", [{ role: "department_head", scope: { type: "unit", id: "d" } }]);
const finance = principal("finance", [{ role: "finance", scope: { type: "group" } }]);
const employee = principal("employee");

// Somebody in SZM whose department head is "boss" and whose manager is "boss".
const subject = { personId: "subject", entityId: SZM, departmentId: "d", teamId: null, managerId: "boss" };

describe("the template library", () => {
  it("is HR's to write, and a group template takes a group-wide grant", () => {
    expect(canManageTemplates(owner, null)).toBe(true);
    expect(canManageTemplates(hrAdmin, null)).toBe(true);
    // An entity-scoped HR officer may write that entity's templates but not a group-wide one.
    expect(canManageTemplates(hrStaff, SZM)).toBe(true);
    expect(canManageTemplates(hrStaff, null)).toBe(false);
    expect(canManageTemplates(hrStaff, SZC)).toBe(false);
  });

  it("is not for finance, a manager or an ordinary employee", () => {
    for (const who of [finance, manager, employee]) {
      expect(canManageTemplates(who, SZM)).toBe(false);
      expect(canReadTemplates(who)).toBe(false);
    }
  });
});

// The rule the whole module exists to keep.
describe("generating a document", () => {
  it("needs BOTH the record and the tier", () => {
    // HR keeps the record and may read personal facts: an employment letter is theirs to issue.
    expect(canGenerate(hrStaff, subject, "personal")).toBe(true);
    // The same officer has no compensation tier, so the salary letter is refused.
    expect(canGenerate(hrStaff, subject, "compensation")).toBe(false);
  });

  it("REFUSES a line manager the salary letter — and every other letter, since they keep no record", () => {
    expect(canGenerate(manager, subject, "compensation")).toBe(false);
    expect(canGenerate(manager, subject, "personal")).toBe(false);
    expect(canGenerate(manager, subject, "public_internal")).toBe(false);
  });

  it("refuses C&B too, who read the money but do not keep the record", () => {
    // `person:manage` is what says "these are your people"; the compensation tier alone is not enough.
    expect(canGenerate(cAndB, subject, "compensation")).toBe(false);
  });

  it("allows the owner everything", () => {
    for (const tier of ["public_internal", "personal", "restricted", "compensation"] as const) {
      expect(canGenerate(owner, subject, tier)).toBe(true);
    }
  });

  it("stops at the entity: an SZM officer issues nothing about an SZC person", () => {
    expect(canGenerate(hrStaff, { ...subject, entityId: SZC }, "personal")).toBe(false);
  });

  it("refuses an ordinary employee a letter about themselves through this route", () => {
    // Self-service letters are a request type (week 1), not a licence to run the generator.
    expect(canGenerate(employee, { ...subject, personId: "employee" }, "personal")).toBe(false);
  });

  it("reads the same on the way back in: opening is generating, re-checked now", () => {
    expect(canOpenDocument).toBe(canGenerate);
    expect(canOpenDocument(hrStaff, subject, "compensation")).toBe(false);
    expect(canOpenDocument(hrAdmin, subject, "personal")).toBe(true);
  });

  /**
   * The HR *lead* (`hr_admin`) does carry the compensation tier in the role catalogue — they
   * propose the payroll — so the salary letter is theirs to issue. The HR *officer* (`hr_staff`,
   * `maxTier: restricted`) is the one who may not, and that is the pair the whole rule turns on.
   * Pinned here so that a change to the catalogue has to come past this test.
   */
  it("separates the HR lead from the HR officer exactly where the tiers do", () => {
    expect(canGenerate(hrAdmin, subject, "restricted")).toBe(true);
    expect(canGenerate(hrAdmin, subject, "compensation")).toBe(true);

    expect(canGenerate(hrStaff, subject, "personal")).toBe(true);
    expect(canGenerate(hrStaff, subject, "restricted")).toBe(true);
    expect(canGenerate(hrStaff, subject, "compensation")).toBe(false);
  });
});
