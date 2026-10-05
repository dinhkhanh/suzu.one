// Document generation against a real Postgres (PGlite). The point of this file is the tier rule
// end to end: a leaky template cannot be stored, a salary letter cannot be generated or re-opened
// by somebody without the compensation tier, and a refusal looks exactly like "not found".
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
vi.mock("@/modules/platform/files/storage", () => import("../../../tests/helpers/storage"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { storedObjects } from "../../../tests/helpers/storage";
import { buildIssuedDocumentsExport } from "./exports";
import type { Principal } from "../platform/rbac/policy";
import { generateDocument, listDocumentsAbout, listIssuedDocuments, openDocument, previewDocument, saveTemplate, type TemplateInput, vietnameseWords } from "./service";

const fails = (promise: Promise<unknown>) =>
  promise.then(
    () => "no error",
    (error: Error) => error.message,
  );
const principal = (personId: string, grants: Principal["grants"] = []): Principal => ({ personId, workforceType: "employee", grants });

const ids = {} as Record<"szm" | "vid" | "huy" | "lead" | "officer" | "boss", string>;
let lead: { principal: Principal; personId: string };
let officer: { principal: Principal; personId: string };
let boss: { principal: Principal; personId: string };

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Công ty TNHH SuZu Media", shortName: "SuZu Media" }).returning();
  const [vid] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Sản xuất Video" }).returning();
  Object.assign(ids, { szm: szm.id, vid: vid.id });

  const [boss1] = await db().insert(schema.person).values({ fullName: "Đặng Hoàng Long", searchName: "long", primaryEntityId: szm.id, orgUnitId: vid.id, status: "active" }).returning();
  ids.boss = boss1.id;
  const [huy] = await db()
    .insert(schema.person)
    .values({ fullName: "Hồ Gia Huy", searchName: "huy", primaryEntityId: szm.id, departmentId: vid.id, status: "active", managerId: boss1.id, workEmail: "huy.ho@suzu.group" })
    .returning();
  ids.huy = huy.id;
  for (const [key, fullName] of [
    ["lead", "Lê Thị Mai"],
    ["officer", "Phạm Quốc Bảo"],
  ] as const) {
    const [row] = await db().insert(schema.person).values({ fullName, searchName: key, primaryEntityId: szm.id, status: "active" }).returning();
    ids[key] = row.id;
  }

  // An employment and a primary assignment, so the personal placeholders have something to say.
  const [employment] = await db().insert(schema.employment).values({ personId: huy.id, entityId: szm.id, employeeCode: "SZM0008", startDate: "2023-07-17", seniorityDate: "2023-07-17" }).returning();
  const [position] = await db().insert(schema.position).values({ name: "Dựng phim", searchName: "dung phim" }).returning();
  await db().insert(schema.assignment).values({ employmentId: employment.id, kind: "primary", workforceType: "employee", orgUnitId: vid.id, departmentId: vid.id, positionId: position.id, validFrom: "2023-07-17" });

  lead = { principal: principal(ids.lead, [{ role: "hr_admin", scope: { type: "group" } }]), personId: ids.lead };
  officer = { principal: principal(ids.officer, [{ role: "hr_staff", scope: { type: "entity", id: szm.id } }]), personId: ids.officer };
  boss = { principal: principal(ids.boss, [{ role: "department_head", scope: { type: "unit", id: vid.id } }]), personId: ids.boss };
});

const LETTERHEAD = { companyName: "CÔNG TY TNHH SUZU MEDIA", address: "123 Nguyễn Văn Trỗi, TP. Hồ Chí Minh", taxCode: "0312345678", representative: "Nguyễn Thu Hà", representativeTitle: "Tổng Giám đốc", place: "TP. Hồ Chí Minh" };

let codeCounter = 0;
const template = (over: Partial<TemplateInput> = {}): TemplateInput => ({
  code: `T${++codeCounter}`,
  name: "Giấy xác nhận công tác",
  entityId: null,
  kind: "confirmation_letter",
  tier: "personal",
  body: "{{company.name}} xác nhận {{person.fullName}}, mã {{person.employeeCode}}, chức danh {{person.position}}, làm việc từ {{employment.startDate}}.",
  letterhead: LETTERHEAD,
  isActive: true,
  ...over,
});

const SALARY_BODY = "Xác nhận {{person.fullName}} có tổng thu nhập {{salary.total}} đồng/tháng (bằng chữ: {{salary.totalInWords}}).";

describe("saving a template", () => {
  it("stores an ordinary letter and bumps its version on every edit", async () => {
    const { after } = await saveTemplate(null, template({ code: "XN-1" }), ids.lead);
    expect(after.version).toBe(1);
    const { after: edited } = await saveTemplate(after.id, template({ code: "XN-1", name: "Giấy xác nhận công tác (v2)" }), ids.lead);
    expect(edited.version).toBe(2);
  });

  // The first and most important of the three checks.
  it("REFUSES a body that prints a salary at a tier below compensation", async () => {
    expect(await fails(saveTemplate(null, template({ body: SALARY_BODY, tier: "personal" }), ids.lead))).toBe("template_tier_too_low");
    expect(await fails(saveTemplate(null, template({ body: SALARY_BODY, tier: "restricted" }), ids.lead))).toBe("template_tier_too_low");
    // …and stores it happily at the tier it needs.
    const { after } = await saveTemplate(null, template({ body: SALARY_BODY, tier: "compensation" }), ids.lead);
    expect(after.tier).toBe("compensation");
  });

  it("refuses a placeholder nobody can fill", async () => {
    expect(await fails(saveTemplate(null, template({ body: "Xin chào {{person.luckyNumber}}" }), ids.lead))).toBe("template_unknown_placeholder");
  });

  it("cannot be edited into a leak either — the check runs on every save", async () => {
    const { after } = await saveTemplate(null, template({ tier: "personal" }), ids.lead);
    expect(await fails(saveTemplate(after.id, template({ code: after.code, body: SALARY_BODY, tier: "personal" }), ids.lead))).toBe("template_tier_too_low");
    // The stored row is untouched: still the harmless body, still v1.
    const [row] = await db().select().from(schema.documentTemplate).where(eq(schema.documentTemplate.id, after.id)).limit(1);
    expect(row.body).not.toContain("salary.total");
    expect(row.version).toBe(1);
  });
});

describe("generating a personal letter", () => {
  it("fills the placeholders from the person's record and gives the paper a number", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    const { document, rendered } = await generateDocument(officer, after.id, ids.huy);
    expect(document.number).toMatch(/^SZM-XN-\d{4}-0\d{3}$/);
    expect(rendered.text).toContain("Hồ Gia Huy");
    expect(rendered.text).toContain("SZM0008");
    expect(rendered.text).toContain("Dựng phim");
    expect(rendered.text).toContain("17/07/2023");
    expect(rendered.missing).toEqual([]);
  });

  it("numbers consecutively within the entity, kind and year", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    const first = await generateDocument(officer, after.id, ids.huy);
    const second = await generateDocument(officer, after.id, ids.huy);
    const tail = (number: string) => Number(number.slice(-4));
    expect(tail(second.document.number)).toBe(tail(first.document.number) + 1);
  });

  it("records that it happened and stores NO text in the row — the paper is a file at the document's tier", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    const { document } = await generateDocument(officer, after.id, ids.huy);
    const [row] = await db().select().from(schema.generatedDocument).where(eq(schema.generatedDocument.id, document.id)).limit(1);
    // No column holds the rendered letter — there is no second copy of the facts in a table.
    for (const column of Object.keys(row)) expect(["body", "text", "content", "rendered", "html"]).not.toContain(column);
    for (const value of Object.values(row)) expect(String(value)).not.toContain("Hồ Gia Huy");
    const [file] = await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, row.fileId!)).limit(1);
    expect(file).toMatchObject({ ownerType: "generated_document", ownerId: document.id, tier: "personal", entityId: ids.szm, status: "ready", contentType: "application/pdf" });
    expect(storedObjects.get(file.objectPath)?.bytes.byteLength).toBeGreaterThan(500);
  });

  // CHR-01: re-opening a numbered paper once re-rendered it from today's template, date and facts.
  it("opens the paper AS ISSUED — an edited template or a changed record does not rewrite it", async () => {
    const { after } = await saveTemplate(null, template({ name: "Giấy xác nhận (bản đầu)" }), ids.lead);
    const { document } = await generateDocument(officer, after.id, ids.huy);
    const issued = await openDocument(officer, document.id);
    expect(issued?.file.id).toBe(document.fileId);

    await saveTemplate(after.id, template({ code: after.code, name: "Giấy xác nhận (bản sửa)", body: "Nội dung khác hẳn {{person.fullName}}." }), ids.lead);
    const again = await openDocument(officer, document.id);
    expect(again?.file.id).toBe(document.fileId);
    // The register keeps the name it was issued under.
    const listed = (await listDocumentsAbout(ids.huy, officer.principal)).find((row) => row.id === document.id);
    expect(listed?.templateName).toBe("Giấy xác nhận (bản đầu)");
  });

  it("issues a paper for a document made before papers were kept — once, on its first opening", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    const [legacy] = await db()
      .insert(schema.generatedDocument)
      .values({ templateId: after.id, templateCode: after.code, templateVersion: 1, kind: "confirmation_letter", tier: "personal", subjectPersonId: ids.huy, entityId: ids.szm, number: "SZM-XN-2025-0099", generatedByPersonId: ids.officer, createdAt: new Date("2025-03-04T03:00:00Z") })
      .returning();
    const [first, second] = await Promise.all([openDocument(officer, legacy.id), openDocument(officer, legacy.id)]);
    expect(first?.file.id).toBeTruthy();
    expect(second?.file.id).toBe(first?.file.id);
    expect((await openDocument(officer, legacy.id))?.file.id).toBe(first?.file.id);
    const kept = await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.ownerId, legacy.id), isNull(schema.storedFile.deletedAt)));
    expect(kept).toHaveLength(1);
  });

  it("takes numbers under a lock: papers issued at the same moment never share one", async () => {
    const { after } = await saveTemplate(null, template({ kind: "decision" }), ids.lead);
    const made = await Promise.all([1, 2, 3, 4].map(() => generateDocument(officer, after.id, ids.huy)));
    const numbers = made.map((row) => row.document.number);
    expect(new Set(numbers).size).toBe(4);
    expect(numbers.map((number) => Number(number.slice(-4))).sort()).toEqual([1, 2, 3, 4]);
  });

  it("prints the event it was issued for, and ties the paper to it", async () => {
    const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, ids.huy)).limit(1);
    const [event] = await db()
      .insert(schema.lifecycleEvent)
      .values({ personId: ids.huy, employmentId: employment.id, entityId: ids.szm, type: "promotion", effectiveDate: "2026-02-01", reason: "Hoàn thành xuất sắc", details: { from: { position: "Dựng phim", department: "Sản xuất Video" }, to: { position: "Trưởng nhóm dựng", department: "Sản xuất Video" } } })
      .returning();
    const { after } = await saveTemplate(null, template({ kind: "decision", body: "{{event.type}} từ {{event.effectiveDate}} ({{event.reason}}): {{event.from}} → {{event.to}}." }), ids.lead);
    const { document, rendered } = await generateDocument(officer, after.id, ids.huy, { eventId: event.id });
    expect(document.eventId).toBe(event.id);
    expect(rendered.text).toBe("Thăng chức / bổ nhiệm từ 01/02/2026 (Hoàn thành xuất sắc): Dựng phim · Sản xuất Video → Trưởng nhóm dựng · Sản xuất Video.");
    // An event of somebody else prints nothing.
    const { rendered: stray } = await generateDocument(lead, after.id, ids.officer, { eventId: event.id });
    expect(stray.missing).toContain("event.type");
  });

  it("prints the entity's own letterhead, the record in words and the contract in force", async () => {
    await db().update(schema.entity).set({ legalName: "CÔNG TY TNHH SUZU MEDIA VIỆT NAM", address: "45 Lê Lợi, Quận 1", taxCode: "0399999999", legalRepresentative: "Trần Văn Đại" }).where(eq(schema.entity.id, ids.szm));
    const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, ids.huy)).limit(1);
    await db().insert(schema.contract).values({ employmentId: employment.id, personId: ids.huy, entityId: ids.szm, number: "HĐ-08/2024", type: "indefinite", startDate: "2024-07-17" });
    const { after } = await saveTemplate(null, template({ body: "{{company.name}} · {{company.address}} · {{company.representative}} ({{company.representativeTitle}}) — {{person.fullName}}, {{employment.type}}, {{employment.status}}, hợp đồng {{contract.number}} ({{contract.type}}) từ {{contract.startDate}}." }), ids.lead);
    const rendered = await previewDocument(officer, after.id, ids.huy);
    expect(rendered?.text).toBe("CÔNG TY TNHH SUZU MEDIA VIỆT NAM · 45 Lê Lợi, Quận 1 · Trần Văn Đại (Tổng Giám đốc) — Hồ Gia Huy, Chính thức, Đang làm việc, hợp đồng HĐ-08/2024 (HĐLĐ không xác định thời hạn) từ 17/07/2024.");
    expect(rendered?.letterhead).toMatchObject({ companyName: "CÔNG TY TNHH SUZU MEDIA VIỆT NAM", taxCode: "0399999999", representativeTitle: "Tổng Giám đốc", place: "TP. Hồ Chí Minh" });
  });

  it("refuses a line manager, who keeps no record", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    expect(await fails(generateDocument(boss, after.id, ids.huy))).toBe("document_forbidden");
    expect(await previewDocument(boss, after.id, ids.huy)).toBeNull();
  });
});

// The requirement this module was built to satisfy.
describe("the salary letter and the compensation tier", () => {
  let salaryTemplateId: string;

  beforeAll(async () => {
    const { after } = await saveTemplate(null, template({ code: "XN-LUONG-T", name: "Giấy xác nhận thu nhập", body: SALARY_BODY, tier: "compensation" }), ids.lead);
    salaryTemplateId = after.id;
  });

  it("is REFUSED to an HR officer who may read personal but not compensation", async () => {
    expect(await fails(generateDocument(officer, salaryTemplateId, ids.huy))).toBe("document_forbidden");
    // The preview says nothing either, and says it the same way as a template that is not there.
    expect(await previewDocument(officer, salaryTemplateId, ids.huy)).toBeNull();
    expect(await previewDocument(officer, "00000000-0000-4000-8000-00000000dead", ids.huy)).toBeNull();
  });

  it("is refused to a line manager", async () => {
    expect(await fails(generateDocument(boss, salaryTemplateId, ids.huy))).toBe("document_forbidden");
    expect(await previewDocument(boss, salaryTemplateId, ids.huy)).toBeNull();
  });

  it("is allowed to the HR lead, who carries the compensation tier", async () => {
    const { document } = await generateDocument(lead, salaryTemplateId, ids.huy);
    expect(document.tier).toBe("compensation");
  });

  it("cannot be RE-OPENED by somebody without the tier, even though it exists", async () => {
    const { document } = await generateDocument(lead, salaryTemplateId, ids.huy);
    expect(await openDocument(lead, document.id)).not.toBeNull();
    // Not "you made it once, so you may have it again": the tier is re-tested now.
    expect(await openDocument(officer, document.id)).toBeNull();
    expect(await openDocument(boss, document.id)).toBeNull();
  });

  it("is opened and listed for the person it is about, on their own page", async () => {
    const { document } = await generateDocument(lead, salaryTemplateId, ids.huy);
    const self = { principal: principal(ids.huy), personId: ids.huy };
    expect((await openDocument(self, document.id))?.document.id).toBe(document.id);
    expect((await listDocumentsAbout(ids.huy, self.principal)).some((row) => row.id === document.id)).toBe(true);
    // …and nobody else's.
    expect(await listDocumentsAbout(ids.huy, principal(ids.officer))).toEqual([]);
  });

  it("keeps the register to what each reader could open", async () => {
    const { document } = await generateDocument(lead, salaryTemplateId, ids.huy);
    expect((await listIssuedDocuments(lead.principal)).some((row) => row.id === document.id)).toBe(true);
    const officerSees = await listIssuedDocuments(officer.principal);
    expect(officerSees.length).toBeGreaterThan(0);
    expect(officerSees.some((row) => row.tier === "compensation")).toBe(false);
    expect(await listIssuedDocuments(boss.principal)).toEqual([]);
    expect((await listIssuedDocuments(lead.principal, { kind: "decision" })).every((row) => row.kind === "decision")).toBe(true);
  });

  it("exports the register as each reader sees it, tier by tier", async () => {
    const { document } = await generateDocument(lead, salaryTemplateId, ids.huy);
    const listed = await listIssuedDocuments(lead.principal);
    const leadFile = await buildIssuedDocumentsExport(lead.principal, {}, "en");
    expect(leadFile.file.table.header).toEqual(["Number", "Template", "Kind", "About", "Sensitivity", "Issued by", "Issued"]);
    expect(leadFile.file.table.rows).toHaveLength(listed.length);
    expect(leadFile.file.table.rows.some((row) => row[0] === document.number && row[4] === "Compensation")).toBe(true);
    // The officer's file, like the officer's register, holds no compensation paper.
    const officerFile = await buildIssuedDocumentsExport(officer.principal, {}, "vi");
    expect(officerFile.file.table.rows).toHaveLength((await listIssuedDocuments(officer.principal)).length);
    expect(officerFile.file.table.rows.some((row) => row[4] === "Lương thưởng")).toBe(false);
    expect((await buildIssuedDocumentsExport(boss.principal, {}, "en")).file.table.rows).toEqual([]);
    const decisions = await buildIssuedDocumentsExport(lead.principal, { kind: "decision" }, "vi");
    expect(decisions.file.table.rows.every((row) => row[2] === "Quyết định")).toBe(true);
  });

  it("is not even LISTED to somebody who could not open it", async () => {
    await generateDocument(lead, salaryTemplateId, ids.huy);
    const seenByLead = await listDocumentsAbout(ids.huy, lead.principal);
    const seenByOfficer = await listDocumentsAbout(ids.huy, officer.principal);
    expect(seenByLead.some((row) => row.tier === "compensation")).toBe(true);
    // Knowing that a salary letter exists about a colleague is itself worth something.
    expect(seenByOfficer.some((row) => row.tier === "compensation")).toBe(false);
    // The officer still sees the personal letters.
    expect(seenByOfficer.every((row) => row.tier !== "compensation")).toBe(true);
    expect(await listDocumentsAbout(ids.huy, boss.principal)).toEqual([]);
  });

  it("prints visible markers, not blanks, when the figures are not there to print", async () => {
    // This person has no salary structure at all, so `getSalaryFile` yields nothing to fill with.
    const rendered = await previewDocument(lead, salaryTemplateId, ids.huy);
    expect(rendered?.missing).toContain("salary.total");
    expect(rendered?.text).toContain("[salary.total]");
  });
});

describe("money in words", () => {
  it("spells a contract's figure", () => {
    expect(vietnameseWords(0)).toBe("không đồng");
    expect(vietnameseWords(12_500_000)).toBe("mười hai triệu năm trăm nghìn đồng");
    expect(vietnameseWords(1_000_000)).toBe("một triệu đồng");
    expect(vietnameseWords(21_000)).toBe("hai mươi mốt nghìn đồng");
    expect(vietnameseWords(15_000)).toBe("mười lăm nghìn đồng");
  });

  it("refuses nonsense rather than inventing words for it", () => {
    expect(vietnameseWords(-1)).toBe("");
    expect(vietnameseWords(Number.NaN)).toBe("");
  });
});
