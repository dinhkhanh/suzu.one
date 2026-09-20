// Salary structures, the salary change flow, pay profiles and the rule governance, end to end on
// PGlite. The point of most tests here is access: who the SQL of a list returns rows for, who a
// request shows figures to, and that no amount ever lands in a clear-text column.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import type { Grant, Principal } from "@/modules/platform/rbac/policy";
import { migrateTestDb } from "../../../tests/helpers/db";
import { decideComponent, proposeComponent, resolveCatalogue } from "./components";
import { DEFAULT_PAYROLL_POLICY } from "./enums";
import { decidePolicy, getPayrollPolicy, proposePolicy } from "./policies";
import { decideProfile, getProfilesOn, listProfileProposals, listSimpleProfileExposure, submitProfile } from "./profiles";
import { compensationReach } from "./policy";
import { decideSalaryChange, getSalaryChange, getSalaryDecision, getSalaryFile, getStructureOn, listSalaryOverview, listStructuresBetween, type SalaryChangeInput, submitSalaryChange } from "./salaries";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"media" | "creative" | "video" | "owner" | "ceo" | "cnb" | "cnbCreative" | "manager" | "hrStaff" | "director" | "huy" | "lan" | "mai", string>;
type Viewer = { personId: string; principal: Principal };
const who = {} as Record<"owner" | "ceo" | "cnb" | "cnbCreative" | "manager" | "hrStaff" | "director" | "huy" | "lan", Viewer>;

// Figures chosen so that a leak is easy to grep for.
const HUY_BASE = 23_456_789;
const HUY_RAISE = 27_654_321;
const terms = (baseSalary: number, meal = 730_000) => ({ baseSalary, insuranceSalary: baseSalary, allowances: [{ code: "ALW_MEAL", amount: meal }] });
const change = (personId: string, validFrom: string, baseSalary: number, reason: SalaryChangeInput["reason"] = "raise"): SalaryChangeInput => ({ personId, validFrom, reason, terms: terms(baseSalary), note: "theo đề xuất của trưởng bộ phận" });
const approve = { action: "approve" as const, comment: null };

beforeAll(async () => {
  await migrateTestDb();
  const [media, creative] = await db().insert(schema.entity).values([{ code: "SZM", legalName: "SuZu Media", shortName: "Media" }, { code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }]).returning();
  const [video] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  const hire = async (name: string, entityId: string, managerId: string | null = null, workforceType: "employee" | "collaborator" = "employee") => {
    const { person } = await hirePerson(
      { fullName: name, workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`, profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null }, entityId, employeeCode: null, startDate: "2025-01-01", seniorityDate: null, placement: { workforceType, branchId: null, departmentId: video.id, teamId: null, positionName: null, jobLevel: null, managerId, dottedManagerId: null, workLocation: null } },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  const owner = await hire("The Owner", media.id);
  const ceo = await hire("The Ceo", media.id);
  const cnb = await hire("Cnb Media", media.id);
  const cnbCreative = await hire("Cnb Creative", creative.id);
  const manager = await hire("Line Manager", media.id);
  const hrStaff = await hire("Hr Staff", media.id);
  const director = await hire("Entity Director", media.id);
  const huy = await hire("Ho Gia Huy", media.id, manager);
  const lan = await hire("Tran Thi Lan", creative.id);
  const mai = await hire("Ctv Mai", media.id, manager, "collaborator");
  Object.assign(ids, { media: media.id, creative: creative.id, video: video.id, owner, ceo, cnb, cnbCreative, manager, hrStaff, director, huy, lan, mai });

  const grants: Record<string, Grant[]> = {
    [owner]: [{ role: "owner", scope: { type: "group" } }],
    [ceo]: [{ role: "c_level", scope: { type: "group" } }],
    [cnb]: [{ role: "payroll", scope: { type: "entity", id: media.id } }],
    [cnbCreative]: [{ role: "payroll", scope: { type: "entity", id: creative.id } }],
    // The line manager is also the department head and — worst case — holds it over the whole entity.
    [manager]: [{ role: "department_head", scope: { type: "department", id: video.id } }, { role: "department_head", scope: { type: "entity", id: media.id } }],
    [hrStaff]: [{ role: "hr_staff", scope: { type: "entity", id: media.id } }],
    [director]: [{ role: "entity_director", scope: { type: "entity", id: media.id } }],
  };
  for (const [personId, list] of Object.entries(grants)) await db().insert(schema.roleAssignment).values(list.map((grant) => ({ personId, role: grant.role, scopeType: grant.scope.type, scopeId: grant.scope.type === "group" ? null : grant.scope.id })));
  const viewer = (personId: string): Viewer => ({ personId, principal: { personId, workforceType: "employee", grants: grants[personId] ?? [] } });
  Object.assign(who, { owner: viewer(owner), ceo: viewer(ceo), cnb: viewer(cnb), cnbCreative: viewer(cnbCreative), manager: viewer(manager), hrStaff: viewer(hrStaff), director: viewer(director), huy: viewer(huy), lan: viewer(lan) });

  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });
  await db().insert(schema.statutoryParameter).values({ key: "probation.limits", value: { managerDays: 180, professionalDays: 60, intermediateDays: 30, otherDays: 6, minimumPayPercent: 85 }, validFrom: "2021-01-01", status: "approved" });
});

describe("salary change flow", () => {
  let requestId: string;

  it("C&B proposes; the owner is asked; nothing takes effect yet", async () => {
    const { request, approverIds } = await submitSalaryChange(who.cnb.personId, change(ids.huy, "2025-01-01", HUY_BASE, "initial"));
    requestId = request.id;
    expect(approverIds).toEqual([ids.owner]);
    expect(request.status).toBe("pending");
    expect(await getStructureOn(ids.huy, "2026-08-31")).toBeNull();
    await expect(submitSalaryChange(who.cnb.personId, change(ids.huy, "2025-02-01", HUY_BASE))).rejects.toThrow("salary_change_open");
  });

  it("refuses unknown allowances, a date before the employment and negative or fractional money", async () => {
    await expect(submitSalaryChange(who.cnb.personId, { ...change(ids.lan, "2025-01-01", 10_000_000), terms: { baseSalary: 10_000_000, insuranceSalary: 10_000_000, allowances: [{ code: "PIT", amount: 1 }] } })).rejects.toThrow("salary_allowance_unknown");
    await expect(submitSalaryChange(who.cnb.personId, change(ids.lan, "2024-12-31", 10_000_000))).rejects.toThrow("salary_before_employment");
    await expect(submitSalaryChange(who.cnb.personId, change(ids.lan, "2025-01-01", 10_000_000.5))).rejects.toThrow("salary_terms_invalid");
    await expect(submitSalaryChange(who.cnb.personId, change(ids.lan, "2025-01-01", -1))).rejects.toThrow("salary_terms_invalid");
  });

  it("shows the figures to C&B and the owner — and to nobody the org chart names", async () => {
    expect((await getSalaryChange(who.cnb, requestId))?.figures?.proposed.baseSalary).toBe(HUY_BASE);
    const ownerView = await getSalaryChange(who.owner, requestId);
    expect(ownerView?.canDecide).toBe(true);
    expect(ownerView?.figures?.current).toBeNull();
    for (const viewer of [who.manager, who.hrStaff, who.director, who.huy, who.cnbCreative, who.ceo]) expect(await getSalaryChange(viewer, requestId)).toBeNull();
    expect(await getSalaryChange(who.owner, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  it("a flow that names the line manager still gives them neither figures nor a decision", async () => {
    // What a misconfigured flow or a standing delegation would produce: the manager is an assignee of the open step.
    const [step] = await db().select().from(schema.approvalStep).where(eq(schema.approvalStep.requestId, requestId));
    await db().insert(schema.approvalAssignee).values({ stepId: step.id, requestId, approverPersonId: ids.manager });
    const view = await getSalaryChange(who.manager, requestId);
    expect(view).not.toBeNull();
    expect(view?.figures).toBeNull();
    expect(view?.canDecide).toBe(false);
    await expect(decideSalaryChange(who.manager, requestId, approve)).rejects.toThrow("forbidden");
    expect(JSON.stringify(view)).not.toContain(String(HUY_BASE));
  });

  it("C&B cannot approve their own proposal; another entity's C&B cannot touch it", async () => {
    await expect(decideSalaryChange(who.cnb, requestId, approve)).rejects.toThrow(/approval_(own_request|not_assignee)/);
    await expect(decideSalaryChange(who.cnbCreative, requestId, approve)).rejects.toThrow("forbidden");
  });

  it("the owner approves: the structure starts, numbered, with no timeline event for a first salary", async () => {
    const { outcome, structureId } = await decideSalaryChange(who.owner, requestId, approve);
    expect(outcome).toBe("approved");
    const structure = await getStructureOn(ids.huy, "2026-08-31");
    expect(structure?.id).toBe(structureId);
    expect(structure?.terms).toEqual(terms(HUY_BASE));
    expect(structure?.decisionNumber).toMatch(/^001\/\d{4}\/QĐL-SZM$/);
    expect(await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.type, "salary_change"))).toHaveLength(0);
  });

  it("a raise closes the structure in force the day before and writes a timeline event without figures", async () => {
    await expect(submitSalaryChange(who.cnb.personId, change(ids.huy, "2025-01-01", HUY_RAISE))).rejects.toThrow("salary_version_exists");
    await expect(submitSalaryChange(who.cnb.personId, change(ids.huy, "2024-06-01", HUY_RAISE))).rejects.toThrow(/salary_before/);
    const { request } = await submitSalaryChange(who.cnb.personId, change(ids.huy, "2026-08-16", HUY_RAISE));
    const before = await getSalaryChange(who.owner, request.id);
    expect(before?.figures).toMatchObject({ current: { baseSalary: HUY_BASE }, proposed: { baseSalary: HUY_RAISE } });
    await decideSalaryChange(who.owner, request.id, approve);

    expect((await getStructureOn(ids.huy, "2026-08-15"))?.terms.baseSalary).toBe(HUY_BASE);
    expect((await getStructureOn(ids.huy, "2026-08-16"))?.terms.baseSalary).toBe(HUY_RAISE);
    const august = await listStructuresBetween(ids.media, "2026-08-01", "2026-08-31");
    expect(august.filter((row) => row.personId === ids.huy).map((row) => [row.validFrom, row.validTo])).toEqual([["2025-01-01", "2026-08-15"], ["2026-08-16", null]]);
    const events = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.type, "salary_change"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ personId: ids.huy, effectiveDate: "2026-08-16", reason: "raise", details: {}, approvalRequestId: request.id });
  });

  it("the database refuses overlapping structures whatever the code does", async () => {
    await expect(db().insert(schema.salaryStructure).values({ personId: ids.huy, employmentId: (await getStructureOn(ids.huy, "2026-09-01"))!.employmentId, entityId: ids.media, validFrom: "2026-09-01", termsEnc: "x", reason: "raise" })).rejects.toThrow();
  });

  it("a rejection leaves everything as it was and needs a reason", async () => {
    const { request } = await submitSalaryChange(who.cnbCreative.personId, change(ids.lan, "2025-01-01", 15_000_000, "initial"));
    await expect(decideSalaryChange(who.owner, request.id, { action: "reject", comment: null })).rejects.toThrow("approval_comment_required");
    expect((await decideSalaryChange(who.owner, request.id, { action: "reject", comment: "chờ ngân sách quý sau" })).outcome).toBe("rejected");
    expect(await getStructureOn(ids.lan, "2026-08-31")).toBeNull();
  });

  it("the decision document opens for the person and C&B only", async () => {
    const structure = (await getStructureOn(ids.huy, "2026-09-01"))!;
    for (const viewer of [who.huy, who.cnb, who.owner]) expect((await getSalaryDecision(viewer, structure.id))?.previous?.terms.baseSalary).toBe(HUY_BASE);
    for (const viewer of [who.manager, who.hrStaff, who.director, who.cnbCreative, who.ceo, who.lan]) expect(await getSalaryDecision(viewer, structure.id)).toBeNull();
  });
});

describe("no amount in clear text", () => {
  it("keeps every figure out of approval requests, events, lifecycle events, notifications and the structure's own clear columns", async () => {
    const needles = [String(HUY_BASE), String(HUY_RAISE), "730000", "15000000"];
    for (const table of ["approval_request", "approval_event", "approval_step", "approval_assignee", "lifecycle_event", "notification", "email_outbox", "salary_structure"]) {
      const result = await db().execute(sql.raw(`select row_to_json(t)::text as line from "${table}" t`));
      const lines = ((result as unknown as { rows: { line: string }[] }).rows ?? []).map((row) => row.line);
      for (const line of lines) for (const needle of needles) expect(line, `${table} leaks ${needle}`).not.toContain(needle);
    }
    const [request] = await db().select().from(schema.approvalRequest).where(eq(schema.approvalRequest.subjectPersonId, ids.huy)).limit(1);
    expect(request.payload).toEqual({ reason: "initial", validFrom: "2025-01-01", employmentId: expect.any(String), initial: true });
    expect(request.payloadEnc).toMatch(/^v1\./);
  });

  it("binds a structure's terms to its row: a ciphertext copied to another row does not open", async () => {
    const huy = (await getStructureOn(ids.huy, "2026-09-01"))!;
    const [row] = await db().select().from(schema.salaryStructure).where(eq(schema.salaryStructure.id, huy.id));
    const { request } = await submitSalaryChange(who.cnbCreative.personId, change(ids.lan, "2025-01-01", 9_000_000, "initial"));
    await decideSalaryChange(who.owner, request.id, approve);
    const lan = (await getStructureOn(ids.lan, "2026-09-01"))!;
    await db().update(schema.salaryStructure).set({ termsEnc: row.termsEnc }).where(eq(schema.salaryStructure.id, lan.id));
    await expect(getStructureOn(ids.lan, "2026-09-01")).rejects.toThrow("decryption_failed");
    // Put it right again for the tests below.
    const { fieldCipher } = await import("@/lib/crypto");
    const { salaryTermsContext } = await import("./field-contexts");
    await db().update(schema.salaryStructure).set({ termsEnc: fieldCipher().encrypt(JSON.stringify(terms(9_000_000)), salaryTermsContext(lan.id)) }).where(eq(schema.salaryStructure.id, lan.id));
  });
});

describe("lists and files: filtered in SQL by the entities of the payroll grant", () => {
  it("the salary list returns rows only within the viewer's compensation reach", async () => {
    const names = async (viewer: Viewer) => (await listSalaryOverview(viewer.principal, {}, "2026-09-01")).map((row) => row.fullName).sort();
    expect(await names(who.cnb)).toContain("Ho Gia Huy");
    expect(await names(who.cnb)).not.toContain("Tran Thi Lan");
    expect(await names(who.cnbCreative)).toEqual(["Cnb Creative", "Tran Thi Lan"]);
    expect((await names(who.owner)).length).toBe(10);
    // The org chart gives nothing: line manager + department head (even entity-wide), HR staff, entity director, the CEO, the person.
    for (const viewer of [who.manager, who.hrStaff, who.director, who.ceo, who.huy]) {
      expect(compensationReach(viewer.principal)).toEqual({ all: false, entityIds: [] });
      expect(await names(viewer)).toEqual([]);
    }
  });

  it("an entity filter cannot widen the reach", async () => {
    expect(await listSalaryOverview(who.cnb.principal, { entityId: ids.creative }, "2026-09-01")).toEqual([]);
    expect((await listSalaryOverview(who.cnb.principal, { search: "gia huy" }, "2026-09-01")).map((row) => row.structure?.baseSalary)).toEqual([HUY_RAISE]);
  });

  it("a pay file opens for the person and C&B over their entity; the same null for everyone else and for unknown ids", async () => {
    expect((await getSalaryFile(who.huy, ids.huy))?.structures.map((row) => row.terms.baseSalary)).toEqual([HUY_RAISE, HUY_BASE]);
    expect((await getSalaryFile(who.huy, ids.huy))?.requests).toEqual([]);
    expect((await getSalaryFile(who.cnb, ids.huy))?.requests.length).toBe(2);
    for (const viewer of [who.manager, who.hrStaff, who.director, who.ceo, who.cnbCreative, who.lan]) expect(await getSalaryFile(viewer, ids.huy)).toBeNull();
    expect(await getSalaryFile(who.owner, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("pay profiles (SRS D18)", () => {
  const base = { simpleBasis: null, reviewDate: null, taxResidency: "resident" as const, pitMethod: "progressive" as const, pitCommitment: false, insuranceExemption: null, unionMember: false, note: null };

  it("a first Statutory profile is in force at once", async () => {
    const created = await submitProfile({ ...base, personId: ids.huy, profile: "statutory", validFrom: "2025-01-01" }, ids.cnb);
    expect(created.status).toBe("approved");
    expect((await getProfilesOn([ids.huy], "2026-08-31")).get(ids.huy)?.profile).toBe("statutory");
  });

  it("a first Simple profile waits for the owner, and needs a basis", async () => {
    await expect(submitProfile({ ...base, personId: ids.mai, profile: "simple", validFrom: "2025-01-01" }, ids.cnb)).rejects.toThrow("profile_basis_required");
    const proposed = await submitProfile({ ...base, personId: ids.mai, profile: "simple", simpleBasis: "service_contract", reviewDate: "2026-06-30", validFrom: "2025-01-01" }, ids.cnb);
    expect(proposed.status).toBe("proposed");
    expect((await getProfilesOn([ids.mai], "2026-08-31")).size).toBe(0);
    await expect(submitProfile({ ...base, personId: ids.mai, profile: "statutory", validFrom: "2025-01-01" }, ids.cnb)).rejects.toThrow("profile_proposal_open");
    expect((await listProfileProposals(compensationReach(who.cnbCreative.principal))).length).toBe(0);
    expect((await listProfileProposals(compensationReach(who.manager.principal))).length).toBe(0);
    expect((await listProfileProposals(compensationReach(who.cnb.principal))).map((row) => row.personName)).toEqual(["Ctv Mai"]);
    await decideProfile(proposed.id, "approve", ids.owner);
    expect(await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.type, "pay_profile_change"))).toHaveLength(0);
  });

  it("a move between profiles closes the old one and is a timeline event", async () => {
    const move = await submitProfile({ ...base, personId: ids.huy, profile: "simple", simpleBasis: "other", validFrom: "2026-09-01" }, ids.cnb);
    expect(move.status).toBe("proposed");
    expect((await getProfilesOn([ids.huy], "2026-09-15")).get(ids.huy)?.profile).toBe("statutory");
    await decideProfile(move.id, "approve", ids.owner);
    expect((await getProfilesOn([ids.huy], "2026-08-31")).get(ids.huy)?.profile).toBe("statutory");
    expect((await getProfilesOn([ids.huy], "2026-09-01")).get(ids.huy)?.profile).toBe("simple");
    const events = await db().select().from(schema.lifecycleEvent).where(eq(schema.lifecycleEvent.type, "pay_profile_change"));
    expect(events).toMatchObject([{ personId: ids.huy, effectiveDate: "2026-09-01", details: {} }]);
    await expect(decideProfile(move.id, "approve", ids.owner)).rejects.toThrow("proposal_not_found");
  });

  it("the exposure report lists everyone on the Simple profile with what to look at", async () => {
    const rows = await listSimpleProfileExposure("2026-09-20");
    expect(rows.map((row) => [row.fullName, row.basis, row.months, row.flags])).toEqual([
      ["Ctv Mai", "service_contract", 20, ["review_date_passed", "no_basis_document"]],
      ["Ho Gia Huy", "other", 0, ["no_basis_document"]],
    ]);
  });
});

describe("rule governance (FR-PLT-39)", () => {
  const draft = { entityId: null, code: "ALW_SENIORITY", name: "Phụ cấp thâm niên", nameEn: null, kind: "earning" as const, category: "allowance" as const, source: "formula" as const, taxTreatment: "taxable" as const, exemptCap: null, subjectToInsurance: false, proration: "fixed" as const, roundingRule: "half_up", formula: "min(div_down(service_months, 12), 10) * pct(base_salary, 100)", sortOrder: 25, note: null, validFrom: "2026-10-01" };

  it("a proposed component is not in the catalogue until the owner approves it", async () => {
    const proposed = await proposeComponent(draft, ids.cnb);
    expect((await resolveCatalogue(ids.media, "2026-10-01")).some((row) => row.code === "ALW_SENIORITY")).toBe(false);
    await decideComponent(proposed.id, "approve", ids.owner);
    expect((await resolveCatalogue(ids.media, "2026-10-01")).find((row) => row.code === "ALW_SENIORITY")?.formula).toBe(draft.formula);
    expect((await resolveCatalogue(ids.media, "2026-09-30")).some((row) => row.code === "ALW_SENIORITY")).toBe(false);
  });

  it("refuses a formula that does not check, with the place and the name — never a value", async () => {
    const error = await proposeComponent({ ...draft, code: "ALW_BAD", formula: "base_salary / 2" }, ids.cnb).catch((caught: Error & { details?: unknown }) => caught);
    expect(error).toMatchObject({ message: "component_formula_invalid", details: { formula: { code: "division_operator", position: 12 } } });
    await expect(proposeComponent({ ...draft, code: "ALW_BAD", formula: "process(1)" }, ids.cnb)).rejects.toThrow("component_formula_invalid");
    await expect(proposeComponent({ ...draft, formula: "c_alw_seniority + 1" }, ids.cnb)).rejects.toThrow("component_formula_reads_itself");
    await expect(proposeComponent({ ...draft, code: "BASE", kind: "deduction" }, ids.cnb)).rejects.toThrow("component_kind_fixed");
  });

  it("a new version takes over from the one in force; an entity's version beats the group's", async () => {
    const next = await proposeComponent({ ...draft, formula: "min(div_down(service_months, 12), 15) * pct(base_salary, 100)", validFrom: "2027-01-01" }, ids.cnb);
    await decideComponent(next.id, "approve", ids.owner);
    const versions = (await db().select().from(schema.payComponent).where(eq(schema.payComponent.code, "ALW_SENIORITY"))).map((row) => [row.validFrom, row.validTo]).sort();
    expect(versions).toEqual([["2026-10-01", "2026-12-31"], ["2027-01-01", null]]);
    const own = await proposeComponent({ ...draft, entityId: ids.creative, formula: "pct(base_salary, 200)", validFrom: "2026-10-01" }, ids.cnb);
    await decideComponent(own.id, "approve", ids.owner);
    expect((await resolveCatalogue(ids.creative, "2026-11-01")).find((row) => row.code === "ALW_SENIORITY")?.formula).toBe("pct(base_salary, 200)");
    expect((await resolveCatalogue(ids.media, "2026-11-01")).find((row) => row.code === "ALW_SENIORITY")?.formula).toBe(draft.formula);
    const again = await proposeComponent({ ...draft, validFrom: "2027-01-01" }, ids.cnb);
    await expect(decideComponent(again.id, "approve", ids.owner)).rejects.toThrow("rule_version_exists");
  });

  it("an entity's pay policy replaces the group's once approved", async () => {
    expect((await getPayrollPolicy(ids.media, "2026-08-31")).value.unionEnabled).toBe(false);
    await expect(proposePolicy({ entityId: ids.media, value: { ...DEFAULT_PAYROLL_POLICY, prorationBasis: "fixed_days" }, validFrom: "2026-09-01", note: null }, ids.cnb)).rejects.toThrow("policy_fixed_days");
    const proposed = await proposePolicy({ entityId: ids.media, value: { ...DEFAULT_PAYROLL_POLICY, unionEnabled: true, prorationBasis: "fixed_days", fixedDays: 26 }, validFrom: "2026-09-01", note: null }, ids.cnb);
    expect((await getPayrollPolicy(ids.media, "2026-09-01")).value.unionEnabled).toBe(false);
    await decidePolicy(proposed.id, "approve", ids.owner);
    expect((await getPayrollPolicy(ids.media, "2026-09-01")).value).toMatchObject({ unionEnabled: true, fixedDays: 26 });
    expect((await getPayrollPolicy(ids.media, "2026-08-31")).value.unionEnabled).toBe(false);
    expect((await getPayrollPolicy(ids.creative, "2026-09-01")).value.unionEnabled).toBe(false);
    await expect(getPayrollPolicy(ids.media, "2025-12-31")).rejects.toThrow("payroll_policy_missing");
  });
});
