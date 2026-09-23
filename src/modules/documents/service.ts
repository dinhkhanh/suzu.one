// Document generation (FR-CHR-06) — the module's only entry point.
//
// The shape of the thing: a template is text plus a tier; a *context* is the facts allowed at that
// tier; rendering is pure. Compensation facts are fetched through `payroll/service`'s own
// `getSalaryFile`, which authorizes inside and returns null to anyone who may not see them — so
// even if the tier check above it were wrong, the figures would not be there to print.
import "server-only";
import { and, asc, desc, eq, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getPersonTarget, listEmploymentFacts } from "@/modules/core-hr/service";
import { getSalaryFile } from "@/modules/payroll/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";
import { type DocumentKind, KIND_PREFIX, type LetterheadFields } from "./enums";
import { atLeast, placeholdersIn, renderTemplate, requiredTier, templateProblems } from "./engine/template";
import { canGenerate, canOpenDocument } from "./policy";

export * from "./enums";
export * from "./engine/template";
export { canGenerate, canManageTemplates, canOpenDocument, canReadTemplates } from "./policy";

type Executor = Tx | ReturnType<typeof db>;
export type DocumentTemplateRow = typeof schema.documentTemplate.$inferSelect;
export type GeneratedDocumentRow = typeof schema.generatedDocument.$inferSelect;

const now = () => new Date();
const formatDay = (date: IsoDate | null) => (date ? date.split("-").reverse().join("/") : "");
const formatVnd = (amount: number) => amount.toLocaleString("vi-VN");

// ── The template library ────────────────────────────────────────────────────────────────────

export type TemplateInput = { code: string; name: string; entityId: string | null; kind: DocumentKind; tier: Tier; body: string; letterhead: LetterheadFields; isActive: boolean };

export async function listTemplates(executor: Executor = db()): Promise<(DocumentTemplateRow & { entityName: string | null })[]> {
  const rows = await executor
    .select({ template: schema.documentTemplate, entityName: schema.entity.shortName })
    .from(schema.documentTemplate)
    .leftJoin(schema.entity, eq(schema.entity.id, schema.documentTemplate.entityId))
    .orderBy(asc(schema.documentTemplate.kind), asc(schema.documentTemplate.name));
  return rows.map((row) => ({ ...row.template, entityName: row.entityName }));
}

export async function findTemplate(templateId: string, executor: Executor = db()): Promise<DocumentTemplateRow | undefined> {
  const [row] = await executor.select().from(schema.documentTemplate).where(eq(schema.documentTemplate.id, templateId)).limit(1);
  return row;
}

/**
 * Saves a template — and refuses one whose body says more than its tier admits. This is the
 * first and most important of the three checks: a leaky template never exists, so no later
 * mistake can print it.
 */
export async function saveTemplate(templateId: string | null, input: TemplateInput, actorPersonId: string): Promise<{ before: DocumentTemplateRow | null; after: DocumentTemplateRow }> {
  const problems = templateProblems({ name: input.name, body: input.body, tier: input.tier });
  if (problems.length > 0) throw new ActionError(problems[0]);

  const values = { ...input, code: input.code.toUpperCase(), updatedByPersonId: actorPersonId, updatedAt: now() };
  if (!templateId) {
    const [after] = await db().insert(schema.documentTemplate).values(values).returning();
    return { before: null, after };
  }
  const before = await findTemplate(templateId);
  if (!before) throw new ActionError("template_not_found");
  const [after] = await db()
    .update(schema.documentTemplate)
    .set({ ...values, version: before.version + 1 })
    .where(eq(schema.documentTemplate.id, templateId))
    .returning();
  return { before, after };
}

/** The tier a body needs — for the designer, so the form can say why a tier will be refused. */
export const tierNeededFor = (body: string): Tier => requiredTier(placeholdersIn(body));

// ── The facts a document may print ──────────────────────────────────────────────────────────

/**
 * Builds the context for one person, gathering **only** what the tier allows.
 *
 * The tiers are cumulative and the cut is made here, not in the template: at `personal` no date of
 * birth is fetched at all, and below `compensation` no salary is even looked up. A fact that is
 * never read cannot leak through a bug in the renderer.
 */
async function buildContext(viewer: { principal: Principal; personId: string }, subjectPersonId: string, template: DocumentTemplateRow, number: string): Promise<Record<string, string>> {
  const [facts] = await listEmploymentFacts({ personIds: [subjectPersonId] });
  if (!facts) throw new ActionError("document_subject_unknown");

  const letterhead = template.letterhead ?? {};
  const today = todayInVietnam();
  const context: Record<string, string> = {
    "company.name": letterhead.companyName ?? "",
    "company.address": letterhead.address ?? "",
    "company.taxCode": letterhead.taxCode ?? "",
    "company.phone": letterhead.phone ?? "",
    "company.representative": letterhead.representative ?? "",
    "company.representativeTitle": letterhead.representativeTitle ?? "",
    "document.number": number,
    "document.date": formatDay(today),
    "document.place": letterhead.place ?? "",
  };

  // personal ── who they are and what they do.
  if (atLeast(template.tier, "personal")) {
    const [placement] = await db()
      .select({ positionName: schema.position.name, departmentName: schema.orgUnit.name })
      .from(schema.assignment)
      .leftJoin(schema.position, eq(schema.position.id, schema.assignment.positionId))
      .leftJoin(schema.orgUnit, eq(schema.orgUnit.id, schema.assignment.departmentId))
      .where(and(eq(schema.assignment.employmentId, facts.employmentId ?? ""), eq(schema.assignment.kind, "primary")))
      .orderBy(desc(schema.assignment.validFrom))
      .limit(1);
    Object.assign(context, {
      "person.fullName": facts.fullName,
      "person.employeeCode": facts.employeeCode ?? "",
      "person.workEmail": facts.workEmail ?? "",
      "person.position": placement?.positionName ?? "",
      "person.department": placement?.departmentName ?? "",
      "employment.startDate": formatDay(facts.startDate),
      "employment.seniorityDate": formatDay(facts.seniorityDate),
      "employment.endDate": formatDay(facts.endDate),
      "employment.type": facts.workforceType,
      "employment.status": facts.status,
    });
  }

  // restricted ── identity facts.
  if (atLeast(template.tier, "restricted")) {
    Object.assign(context, { "person.dateOfBirth": formatDay(facts.dateOfBirth), "person.gender": facts.gender ?? "" });
  }

  // compensation ── the figures, and only through payroll's own authorized reader.
  if (atLeast(template.tier, "compensation")) {
    const file = await getSalaryFile({ principal: viewer.principal, personId: viewer.personId }, subjectPersonId);
    // null = payroll itself says this viewer may not see the figures. The document is then made
    // with the holes visible rather than silently filled — but `canGenerate` has already refused,
    // so in practice this is the belt beneath the braces.
    const current = file?.structures.find((row) => !row.validTo || row.validTo >= todayInVietnam()) ?? file?.structures[0];
    if (current) {
      const allowances = current.terms.allowances.reduce((sum, line) => sum + line.amount, 0);
      const total = current.terms.baseSalary + allowances;
      Object.assign(context, {
        "salary.base": formatVnd(current.terms.baseSalary),
        "salary.insurance": formatVnd(current.terms.insuranceSalary),
        "salary.allowances": formatVnd(allowances),
        "salary.total": formatVnd(total),
        "salary.totalInWords": vietnameseWords(total),
        "salary.effectiveFrom": formatDay(current.validFrom),
      });
    }
  }
  return context;
}

// ── Numbering ───────────────────────────────────────────────────────────────────────────────

/** "SZM-XN-2026-0007". Counted from what is already on the books, per entity, kind and year. */
async function nextNumber(executor: Executor, entityCode: string, kind: DocumentKind, year: number): Promise<string> {
  const prefix = `${entityCode}-${KIND_PREFIX[kind]}-${year}-`;
  const rows = await executor.select({ number: schema.generatedDocument.number }).from(schema.generatedDocument).where(like(schema.generatedDocument.number, `${prefix}%`));
  const highest = rows.reduce((top, row) => {
    const tail = row.number.slice(prefix.length);
    return /^\d+$/.test(tail) ? Math.max(top, Number(tail)) : top;
  }, 0);
  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}

// ── Making a document ───────────────────────────────────────────────────────────────────────

/** `tier` is the document's own: the template's when it is made, the one recorded with it afterwards. */
export type RenderedDocument = { template: DocumentTemplateRow; tier: GeneratedDocumentRow["tier"]; number: string; title: string; text: string; missing: string[]; letterhead: LetterheadFields; subjectName: string };

/**
 * Renders a document without recording it — the preview. Refuses exactly as generation does, so
 * nothing can be read here that could not be generated.
 */
export async function previewDocument(viewer: { principal: Principal; personId: string }, templateId: string, subjectPersonId: string): Promise<RenderedDocument | null> {
  const template = await findTemplate(templateId);
  const subject = await getPersonTarget(subjectPersonId);
  if (!template || !template.isActive || !subject) return null;
  if (!canGenerate(viewer.principal, subject, template.tier)) return null;

  const context = await buildContext(viewer, subjectPersonId, template, "(chưa cấp số)");
  const { text, missing } = renderTemplate(template.body, context);
  return { template, tier: template.tier, number: "(chưa cấp số)", title: template.name, text, missing, letterhead: template.letterhead ?? {}, subjectName: context["person.fullName"] ?? "" };
}

/** Makes the document, gives it a number and records that it was made. */
export async function generateDocument(viewer: { principal: Principal; personId: string }, templateId: string, subjectPersonId: string): Promise<{ document: GeneratedDocumentRow; rendered: RenderedDocument }> {
  const template = await findTemplate(templateId);
  if (!template || !template.isActive) throw new ActionError("template_not_found");
  const subject = await getPersonTarget(subjectPersonId);
  if (!subject) throw new ActionError("document_subject_unknown");
  if (!canGenerate(viewer.principal, subject, template.tier)) throw new ActionError("document_forbidden");

  const entityId = template.entityId ?? subject.entityId ?? null;
  const [entityRow] = entityId ? await db().select({ code: schema.entity.code }).from(schema.entity).where(eq(schema.entity.id, entityId)).limit(1) : [];
  const number = await nextNumber(db(), entityRow?.code ?? "SZ", template.kind, Number(todayInVietnam().slice(0, 4)));

  const context = await buildContext(viewer, subjectPersonId, template, number);
  const { text, missing } = renderTemplate(template.body, context);

  const [document] = await db()
    .insert(schema.generatedDocument)
    .values({ templateId: template.id, templateCode: template.code, templateVersion: template.version, kind: template.kind, tier: template.tier, subjectPersonId, entityId, number, generatedByPersonId: viewer.personId })
    .returning();

  return { document, rendered: { template, tier: template.tier, number, title: template.name, text, missing, letterhead: template.letterhead ?? {}, subjectName: context["person.fullName"] ?? "" } };
}

/**
 * Re-opens a document that was made earlier, re-rendering it from the template it was made from.
 * The tier is checked **again, now** — a document is not a key that keeps working after the lock
 * is changed. null = not there, or not this viewer's to read; the route answers 404 either way.
 */
export async function openDocument(viewer: { principal: Principal; personId: string }, documentId: string): Promise<RenderedDocument | null> {
  const [row] = await db().select().from(schema.generatedDocument).where(eq(schema.generatedDocument.id, documentId)).limit(1);
  if (!row) return null;
  const subject = await getPersonTarget(row.subjectPersonId);
  if (!subject || !canOpenDocument(viewer.principal, subject, row.tier)) return null;
  const template = await findTemplate(row.templateId);
  if (!template) return null;

  const context = await buildContext(viewer, row.subjectPersonId, template, row.number);
  const { text, missing } = renderTemplate(template.body, context);
  return { template, tier: row.tier, number: row.number, title: template.name, text, missing, letterhead: template.letterhead ?? {}, subjectName: context["person.fullName"] ?? "" };
}

export type DocumentListRow = GeneratedDocumentRow & { subjectName: string; generatedByName: string | null; templateName: string };

/** The papers made about one person, newest first — for their record page. Caller checks access. */
export async function listDocumentsAbout(subjectPersonId: string, viewer: Principal): Promise<DocumentListRow[]> {
  const author = alias(schema.person, "doc_author");
  const rows = await db()
    .select({ document: schema.generatedDocument, subjectName: schema.person.fullName, generatedByName: author.fullName, templateName: schema.documentTemplate.name })
    .from(schema.generatedDocument)
    .innerJoin(schema.person, eq(schema.person.id, schema.generatedDocument.subjectPersonId))
    .leftJoin(author, eq(author.id, schema.generatedDocument.generatedByPersonId))
    .innerJoin(schema.documentTemplate, eq(schema.documentTemplate.id, schema.generatedDocument.templateId))
    .where(eq(schema.generatedDocument.subjectPersonId, subjectPersonId))
    .orderBy(desc(schema.generatedDocument.createdAt));
  const subject = await getPersonTarget(subjectPersonId);
  if (!subject) return [];
  // A compensation letter is not even listed to somebody who could not open it: the existence of
  // "Giấy xác nhận lương" about a colleague is itself worth nothing to them.
  return rows.filter((row) => canOpenDocument(viewer, subject, row.document.tier)).map((row) => ({ ...row.document, subjectName: row.subjectName, generatedByName: row.generatedByName, templateName: row.templateName }));
}

export async function countDocuments(executor: Executor = db()): Promise<number> {
  const [row] = await executor.select({ value: sql<number>`count(*)::int` }).from(schema.generatedDocument);
  return row?.value ?? 0;
}

// ── Money in words, for a contract that must spell it out ───────────────────────────────────

const ONES = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

/** "12.500.000" → "mười hai triệu năm trăm nghìn đồng". Good enough for a contract's parenthesis. */
export function vietnameseWords(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "";
  if (amount === 0) return "không đồng";
  const groups: number[] = [];
  let rest = Math.floor(amount);
  while (rest > 0) {
    groups.push(rest % 1000);
    rest = Math.floor(rest / 1000);
  }
  const scale = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ"];
  const said: string[] = [];
  for (let index = groups.length - 1; index >= 0; index--) {
    const group = groups[index];
    if (group === 0) continue;
    said.push(threeDigits(group, index !== groups.length - 1) + (scale[index] ?? ""));
  }
  return `${said.join(" ").replace(/\s+/g, " ").trim()} đồng`;
}

function threeDigits(value: number, padHundreds: boolean): string {
  const hundreds = Math.floor(value / 100);
  const tens = Math.floor((value % 100) / 10);
  const ones = value % 10;
  const parts: string[] = [];
  if (hundreds > 0 || padHundreds) parts.push(`${ONES[hundreds]} trăm`);
  if (tens === 0 && ones > 0 && (hundreds > 0 || padHundreds)) parts.push("lẻ");
  if (tens === 1) parts.push("mười");
  else if (tens > 1) parts.push(`${ONES[tens]} mươi`);
  if (ones > 0) {
    if (tens > 1 && ones === 1) parts.push("mốt");
    else if (tens > 0 && ones === 5) parts.push("lăm");
    else parts.push(ONES[ones]);
  }
  return parts.join(" ");
}

export const documentsToday = (): IsoDate => todayInVietnam();
