// Document generation against a real Postgres (PGlite). The point of this file is the tier rule
// end to end: a leaky template cannot be stored, a salary letter cannot be generated or re-opened
// by somebody without the compensation tier, and a refusal looks exactly like "not found".
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
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

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { generateDocument, listDocumentsAbout, openDocument, previewDocument, saveTemplate, type TemplateInput, vietnameseWords } from "./service";

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
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Sản xuất Video" }).returning();
  Object.assign(ids, { szm: szm.id, vid: vid.id });

  const [boss1] = await db().insert(schema.person).values({ fullName: "Đặng Hoàng Long", searchName: "long", primaryEntityId: szm.id, departmentId: vid.id, status: "active" }).returning();
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
  await db().insert(schema.assignment).values({ employmentId: employment.id, kind: "primary", workforceType: "employee", departmentId: vid.id, positionId: position.id, validFrom: "2023-07-17" });

  lead = { principal: principal(ids.lead, [{ role: "hr_admin", scope: { type: "group" } }]), personId: ids.lead };
  officer = { principal: principal(ids.officer, [{ role: "hr_staff", scope: { type: "entity", id: szm.id } }]), personId: ids.officer };
  boss = { principal: principal(ids.boss, [{ role: "department_head", scope: { type: "department", id: vid.id } }]), personId: ids.boss };
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

  it("records that it happened and stores NO text — re-opening re-renders it", async () => {
    const { after } = await saveTemplate(null, template(), ids.lead);
    const { document } = await generateDocument(officer, after.id, ids.huy);
    const [row] = await db().select().from(schema.generatedDocument).where(eq(schema.generatedDocument.id, document.id)).limit(1);
    // No column holds the rendered letter — there is no second copy of the facts to leak.
    for (const column of Object.keys(row)) expect(["body", "text", "content", "rendered", "html"]).not.toContain(column);
    for (const value of Object.values(row)) expect(String(value)).not.toContain("Hồ Gia Huy");
    expect((await openDocument(officer, document.id))?.text).toContain("Hồ Gia Huy");
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
