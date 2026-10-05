// Document generation (FR-CHR-06) — the module's only entry point.
//
// The shape of the thing: a template is text plus a tier; a *context* is the facts allowed at that
// tier; rendering is pure. Compensation facts are fetched through `payroll/service`'s own
// `getSalaryFile`, which authorizes inside and returns null to anyone who may not see them — so
// even if the tier check above it were wrong, the figures would not be there to print.
import "server-only";
import { and, asc, desc, eq, isNull, like, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { createTranslator } from "next-intl";
import { ActionError } from "@/lib/action";
import { cached, invalidate, TTL } from "@/lib/cache";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { jobTitle } from "@/lib/job-levels";
import { documentEventOf, documentFactsOf, getPersonTarget, getPersonTargets, getSensitiveFields, type PlacementWords } from "@/modules/core-hr/service";
import { getSalaryFile } from "@/modules/payroll/service";
import { findFile, softDeleteFile, type StoredFileRow, storeIncomingFile } from "@/modules/platform/files/service";
import { listEntities } from "@/modules/platform/org/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";
import vi from "../../../messages/vi.json";
import { renderDocumentPdf } from "./document-pdf";
import { type DocumentKind, KIND_PREFIX, type LetterheadFields } from "./enums";
import { atLeast, placeholdersIn, renderTemplate, requiredTier, templateProblems } from "./engine/template";
import { canGenerate, canOpenDocument } from "./policy";

export * from "./enums";
export * from "./engine/template";
export { canGenerate, canManageTemplates, canOpenDocument, canReadTemplates } from "./policy";
export { type DocumentPdfInput, renderDocumentPdf } from "./document-pdf";

type Executor = Tx | ReturnType<typeof db>;
export type DocumentTemplateRow = typeof schema.documentTemplate.$inferSelect;
export type GeneratedDocumentRow = typeof schema.generatedDocument.$inferSelect;

const now = () => new Date();
const formatDay = (date: IsoDate | null) => (date ? date.split("-").reverse().join("/") : "");
const formatVnd = (amount: number) => amount.toLocaleString("vi-VN");

// ── The template library ────────────────────────────────────────────────────────────────────

export type TemplateInput = { code: string; name: string; entityId: string | null; kind: DocumentKind; tier: Tier; body: string; letterhead: LetterheadFields; isActive: boolean };

// The template library is reference data: one entry in the shared cache, dropped by `saveTemplate`.
const TEMPLATES_KEY = "documents:templates";

/** Inside a transaction the rows are read there; otherwise from the shared cache. */
export async function listTemplates(executor?: Executor): Promise<(DocumentTemplateRow & { entityName: string | null })[]> {
  const read = async (from: Executor) => {
    const rows = await from
      .select({ template: schema.documentTemplate, entityName: schema.entity.shortName })
      .from(schema.documentTemplate)
      .leftJoin(schema.entity, eq(schema.entity.id, schema.documentTemplate.entityId))
      .orderBy(asc(schema.documentTemplate.kind), asc(schema.documentTemplate.name));
    return rows.map((row) => ({ ...row.template, entityName: row.entityName }));
  };
  return executor ? read(executor) : cached(TEMPLATES_KEY, TTL.reference, () => read(db()));
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
    await invalidate(TEMPLATES_KEY);
    return { before: null, after };
  }
  const before = await findTemplate(templateId);
  if (!before) throw new ActionError("template_not_found");
  const [after] = await db()
    .update(schema.documentTemplate)
    .set({ ...values, version: before.version + 1 })
    .where(eq(schema.documentTemplate.id, templateId))
    .returning();
  await invalidate(TEMPLATES_KEY);
  return { before, after };
}

/** The tier a body needs — for the designer, so the form can say why a tier will be refused. */
export const tierNeededFor = (body: string): Tier => requiredTier(placeholdersIn(body));

// ── The facts a document may print ──────────────────────────────────────────────────────────

// A paper is Vietnamese whoever presses "generate" (like the acceptance record): every value that is
// a code in the database — a workforce type, a contract type, an event — is printed in words from
// the messages, never as the code and never as a literal here (FR-PLT-02).
const word = createTranslator({ locale: "vi", messages: vi });
const said = (key: string, fallback: string) => (word.has(key as never) ? word(key as never) : fallback);
const peopleWord = createTranslator({ locale: "vi", messages: vi, namespace: "people" });
const documentWord = createTranslator({ locale: "vi", messages: vi, namespace: "documents" });

/** "Phòng Video · Dựng phim · Senior" — a placement in words, for a decision's from → to. */
const placementWords = (placement: PlacementWords | null) =>
  placement ? [placement.entity, placement.position, jobTitle(peopleWord, placement), placement.department, placement.team].filter(Boolean).join(" · ") : "";

/**
 * The letterhead of a paper: the entity's own name, address, tax code and representative win over
 * the template's, so a group template prints the right company for each entity and an entity's
 * details are kept in one place (FR-CHR-06). The template supplies what the entity does not keep —
 * the phone, the signer's title, the place in the dateline.
 */
export async function letterheadFor(template: Pick<DocumentTemplateRow, "letterhead">, entityId: string | null): Promise<LetterheadFields> {
  // The entities are reference data, in the org module's cache.
  const entity = entityId ? (await listEntities()).find((row) => row.id === entityId) : undefined;
  const own = Object.fromEntries(Object.entries({ companyName: entity?.legalName, address: entity?.address, taxCode: entity?.taxCode, representative: entity?.legalRepresentative }).filter(([, value]) => !!value)) as LetterheadFields;
  return { ...(template.letterhead ?? {}), ...own };
}

type ContextOptions = { number: string; issuedOn: IsoDate; letterhead: LetterheadFields; eventId?: string | null };

/**
 * Builds the context for one person, gathering **only** what the tier allows.
 *
 * The tiers are cumulative and the cut is made here, not in the template: at `personal` no date of
 * birth is fetched at all, and below `compensation` no salary is even looked up. A fact that is
 * never read cannot leak through a bug in the renderer. Every fact is as the record stood on the
 * day of issue — the placement and the contract then in force.
 */
async function buildContext(viewer: { principal: Principal; personId: string }, subjectPersonId: string, template: DocumentTemplateRow, options: ContextOptions): Promise<Record<string, string>> {
  const facts = await documentFactsOf(subjectPersonId, options.issuedOn);
  if (!facts) throw new ActionError("document_subject_unknown");

  const { letterhead } = options;
  const context: Record<string, string> = {
    "company.name": letterhead.companyName ?? "",
    "company.address": letterhead.address ?? "",
    "company.taxCode": letterhead.taxCode ?? "",
    "company.phone": letterhead.phone ?? "",
    "company.representative": letterhead.representative ?? "",
    "company.representativeTitle": letterhead.representativeTitle ?? "",
    "document.number": options.number,
    "document.date": formatDay(options.issuedOn),
    "document.place": letterhead.place ?? "",
  };

  // personal ── who they are, what they do, under which contract, and the event the paper is for.
  if (atLeast(template.tier, "personal")) {
    const event = options.eventId ? await documentEventOf(options.eventId, subjectPersonId) : null;
    // Why a salary changed is a compensation fact; that it changed is not.
    const eventReason = event && (event.type === "salary_change" || event.type === "pay_profile_change") && !atLeast(template.tier, "compensation") ? "" : (event?.reason ?? "");
    Object.assign(context, {
      "person.fullName": facts.fullName,
      "person.employeeCode": facts.employeeCode ?? "",
      "person.workEmail": facts.workEmail ?? "",
      "person.position": facts.positionName ?? "",
      "person.department": facts.departmentName ?? "",
      "person.team": facts.teamName ?? "",
      "person.jobTitle": jobTitle(peopleWord, facts) ?? "",
      "person.manager": facts.managerName ?? "",
      "person.branch": facts.branchName ?? "",
      "person.phone": facts.profile?.phone ?? "",
      "person.nationality": facts.profile?.nationality ?? "",
      "person.permanentAddress": facts.profile?.permanentAddress ?? "",
      "person.currentAddress": facts.profile?.currentAddress ?? "",
      "employment.startDate": formatDay(facts.startDate),
      "employment.seniorityDate": formatDay(facts.seniorityDate),
      "employment.endDate": formatDay(facts.endDate),
      "employment.type": facts.workforceType ? said(`people.workforceType.${facts.workforceType}`, facts.workforceType) : "",
      "employment.status": said(`people.status.${facts.status}`, facts.status),
      "employment.workLocation": facts.workLocation ?? "",
      "contract.number": facts.contract?.number ?? "",
      "contract.type": facts.contract ? said(`records.contracts.types.${facts.contract.type}`, facts.contract.type) : "",
      "contract.signDate": formatDay(facts.contract?.signDate ?? null),
      "contract.startDate": formatDay(facts.contract?.startDate ?? null),
      "contract.endDate": formatDay(facts.contract?.endDate ?? null),
      "event.type": event ? said(`lifecycle.types.${event.type}`, event.type) : "",
      "event.effectiveDate": formatDay(event?.effectiveDate ?? null),
      "event.reason": eventReason,
      "event.from": placementWords(event?.from ?? null),
      "event.to": placementWords(event?.to ?? null),
    });
  }

  // restricted ── identity facts, decrypted only through core HR's own authorized reader.
  if (atLeast(template.tier, "restricted")) {
    const sensitive = await getSensitiveFields(viewer.principal, subjectPersonId);
    Object.assign(context, {
      "person.dateOfBirth": formatDay(facts.profile?.dateOfBirth ?? null),
      "person.gender": facts.profile?.gender ? said(`people.gender.${facts.profile.gender}`, facts.profile.gender) : "",
      "person.idNumber": sensitive?.nationalId ?? "",
      "person.idIssuedOn": sensitive?.nationalIdIssuedOn ? formatDay(sensitive.nationalIdIssuedOn as IsoDate) : "",
      "person.idIssuedAt": sensitive?.nationalIdIssuedAt ?? "",
      "person.taxCode": sensitive?.taxCode ?? "",
      "person.socialInsuranceNumber": sensitive?.socialInsuranceNumber ?? "",
    });
  }

  // compensation ── the figures, and only through payroll's own authorized reader.
  if (atLeast(template.tier, "compensation")) {
    const file = await getSalaryFile({ principal: viewer.principal, personId: viewer.personId }, subjectPersonId);
    // null = payroll itself says this viewer may not see the figures. The document is then made
    // with the holes visible rather than silently filled — but `canGenerate` has already refused,
    // so in practice this is the belt beneath the braces.
    const current = file?.structures.find((row) => row.validFrom <= options.issuedOn && (!row.validTo || row.validTo >= options.issuedOn)) ?? file?.structures[0];
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

/**
 * "SZM-XN-2026-0007": the next number per entity, kind and year, taken under a lock held until the
 * caller's transaction ends — two papers issued in the same second never share a number (the
 * unique index would refuse the second outright). The highest tail is found in SQL.
 */
async function nextNumber(tx: Tx, entityCode: string, kind: DocumentKind, year: number): Promise<string> {
  const prefix = `${entityCode}-${KIND_PREFIX[kind]}-${year}-`;
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`document_number:${prefix}`}))`);
  const tail = sql`substring(${schema.generatedDocument.number} from ${prefix.length + 1}::int)`;
  const [row] = await tx
    .select({ highest: sql<number>`coalesce(max(case when ${tail} ~ '^[0-9]+$' then ${tail}::int end), 0)::int` })
    .from(schema.generatedDocument)
    .where(like(schema.generatedDocument.number, `${prefix}%`));
  return `${prefix}${String((row?.highest ?? 0) + 1).padStart(4, "0")}`;
}

// ── Making a document ───────────────────────────────────────────────────────────────────────

/** `tier` is the document's own: the template's when it is made, the one recorded with it afterwards. */
export type RenderedDocument = { template: DocumentTemplateRow; tier: GeneratedDocumentRow["tier"]; number: string; title: string; text: string; missing: string[]; letterhead: LetterheadFields; subjectName: string };

const PREVIEW_NUMBER = "(chưa cấp số)";

/**
 * Renders a document without recording it — the preview. Refuses exactly as generation does, so
 * nothing can be read here that could not be generated.
 */
export async function previewDocument(viewer: { principal: Principal; personId: string }, templateId: string, subjectPersonId: string): Promise<RenderedDocument | null> {
  const template = await findTemplate(templateId);
  const subject = await getPersonTarget(subjectPersonId);
  if (!template || !template.isActive || !subject) return null;
  if (!canGenerate(viewer.principal, subject, template.tier)) return null;

  const letterhead = await letterheadFor(template, template.entityId ?? subject.entityId ?? null);
  const context = await buildContext(viewer, subjectPersonId, template, { number: PREVIEW_NUMBER, issuedOn: todayInVietnam(), letterhead });
  const { text, missing } = renderTemplate(template.body, context);
  return { template, tier: template.tier, number: PREVIEW_NUMBER, title: template.name, text, missing, letterhead, subjectName: context["person.fullName"] ?? "" };
}

// The issued paper is filed among the document's own files, at the document's tier.
const PAPER_OWNER = "generated_document";

/** Renders the paper as the record stands on `issuedOn` and stores it. The file is the paper from then on. */
async function storePaper(viewer: { principal: Principal; personId: string }, row: GeneratedDocumentRow, template: DocumentTemplateRow, issuedOn: IsoDate) {
  const letterhead = await letterheadFor(template, row.entityId);
  const context = await buildContext(viewer, row.subjectPersonId, template, { number: row.number, issuedOn, letterhead, eventId: row.eventId });
  const { text, missing } = renderTemplate(template.body, context);
  const title = row.title ?? template.name;
  const bytes = renderDocumentPdf({ title, number: row.number, text, letterhead, footer: documentWord("pdfFooter", { number: row.number }), today: issuedOn });
  const file = await storeIncomingFile({ ownerType: PAPER_OWNER, ownerId: row.id, entityId: row.entityId, tier: row.tier }, { fileName: `${row.number.replaceAll("/", "_")}.pdf`, bytes });
  return { file, rendered: { template, tier: row.tier, number: row.number, title, text, missing, letterhead, subjectName: context["person.fullName"] ?? "" } satisfies RenderedDocument };
}

/**
 * Makes the document, gives it a number, and keeps the paper as it was issued (CHR-01). The number
 * is taken and the record written in one short transaction under the numbering lock; the paper is
 * rendered and stored straight after. If that fails the record goes again — a number is never left
 * standing without its paper, and being the highest, it is simply taken by the next one.
 * `eventId` ties the paper to the lifecycle event it was issued for (a probation pass, a renewal).
 */
export async function generateDocument(viewer: { principal: Principal; personId: string }, templateId: string, subjectPersonId: string, options: { eventId?: string | null } = {}): Promise<{ document: GeneratedDocumentRow; rendered: RenderedDocument }> {
  const template = await findTemplate(templateId);
  if (!template || !template.isActive) throw new ActionError("template_not_found");
  const subject = await getPersonTarget(subjectPersonId);
  if (!subject) throw new ActionError("document_subject_unknown");
  if (!canGenerate(viewer.principal, subject, template.tier)) throw new ActionError("document_forbidden");

  const entityId = template.entityId ?? subject.entityId ?? null;
  const entityRow = entityId ? (await listEntities()).find((row) => row.id === entityId) : undefined;
  const issuedOn = todayInVietnam();

  const row = await db().transaction(async (tx) => {
    const number = await nextNumber(tx, entityRow?.code ?? "SZ", template.kind, Number(issuedOn.slice(0, 4)));
    const [inserted] = await tx
      .insert(schema.generatedDocument)
      .values({ templateId: template.id, templateCode: template.code, templateVersion: template.version, kind: template.kind, tier: template.tier, subjectPersonId, entityId, number, title: template.name, eventId: options.eventId ?? null, generatedByPersonId: viewer.personId })
      .returning();
    return inserted;
  });

  let stored: Awaited<ReturnType<typeof storePaper>>;
  try {
    stored = await storePaper(viewer, row, template, issuedOn);
  } catch (error) {
    await db().delete(schema.generatedDocument).where(eq(schema.generatedDocument.id, row.id));
    throw error;
  }
  const [document] = await db().update(schema.generatedDocument).set({ fileId: stored.file.id, updatedAt: now() }).where(eq(schema.generatedDocument.id, row.id)).returning();
  return { document, rendered: stored.rendered };
}

export type OpenedDocument = { document: GeneratedDocumentRow; file: StoredFileRow };

/**
 * Re-opens a document that was made earlier: the paper as it was issued, never a new rendering. The
 * tier is checked **again, now** — a document is not a key that keeps working after the lock is
 * changed. null = not there, or not this viewer's to read; the route answers 404 either way.
 *
 * A document made before papers were kept has none yet: it is issued on this first opening, dated
 * the day it was made, and that file is the paper from then on. The update takes only a row that
 * still has no file, so two readers opening it at once keep one paper between them.
 */
export async function openDocument(viewer: { principal: Principal; personId: string }, documentId: string): Promise<OpenedDocument | null> {
  const [row] = await db().select().from(schema.generatedDocument).where(eq(schema.generatedDocument.id, documentId)).limit(1);
  if (!row) return null;
  const subject = await getPersonTarget(row.subjectPersonId);
  if (!subject || !canOpenDocument(viewer.principal, subject, row.tier)) return null;
  if (row.fileId) {
    const file = await findFile(row.fileId);
    return file ? { document: row, file } : null;
  }

  const template = await findTemplate(row.templateId);
  if (!template) return null;
  const { file } = await storePaper(viewer, row, template, todayInVietnam(row.createdAt));
  const [kept] = await db()
    .update(schema.generatedDocument)
    .set({ fileId: file.id, updatedAt: now() })
    .where(and(eq(schema.generatedDocument.id, row.id), isNull(schema.generatedDocument.fileId)))
    .returning();
  if (kept) return { document: kept, file };
  await softDeleteFile(file.id);
  const [again] = await db().select().from(schema.generatedDocument).where(eq(schema.generatedDocument.id, row.id)).limit(1);
  const theirs = again?.fileId ? await findFile(again.fileId) : undefined;
  return again && theirs ? { document: again, file: theirs } : null;
}

export type DocumentListRow = GeneratedDocumentRow & { subjectName: string; generatedByName: string | null; templateName: string };

const author = alias(schema.person, "doc_author");
const listColumns = { document: schema.generatedDocument, subjectName: schema.person.fullName, generatedByName: author.fullName, templateName: schema.documentTemplate.name };
const toListRow = (row: { document: GeneratedDocumentRow; subjectName: string; generatedByName: string | null; templateName: string }): DocumentListRow => ({
  ...row.document,
  subjectName: row.subjectName,
  generatedByName: row.generatedByName,
  // The name it was issued under; a template renamed since does not rename the paper.
  templateName: row.document.title ?? row.templateName,
});

/**
 * The papers made about one person, newest first — for their record page, and for their own page
 * (`/me`): the person reads every letter issued about them. Caller checks access to the page.
 */
export async function listDocumentsAbout(subjectPersonId: string, viewer: Principal): Promise<DocumentListRow[]> {
  const [subject, rows] = await Promise.all([
    getPersonTarget(subjectPersonId),
    db()
      .select(listColumns)
      .from(schema.generatedDocument)
      .innerJoin(schema.person, eq(schema.person.id, schema.generatedDocument.subjectPersonId))
      .leftJoin(author, eq(author.id, schema.generatedDocument.generatedByPersonId))
      .innerJoin(schema.documentTemplate, eq(schema.documentTemplate.id, schema.generatedDocument.templateId))
      .where(eq(schema.generatedDocument.subjectPersonId, subjectPersonId))
      .orderBy(desc(schema.generatedDocument.createdAt)),
  ]);
  if (!subject) return [];
  // A compensation letter is not even listed to somebody who could not open it: the existence of
  // "Giấy xác nhận lương" about a colleague is itself worth nothing to them.
  return rows.filter((row) => canOpenDocument(viewer, subject, row.document.tier)).map(toListRow);
}

export type RegisterFilter = { kind?: DocumentKind; year?: number };
export const REGISTER_LIMIT = 300;

/**
 * The register of issued papers (CHR-01): every document this reader could open, newest first,
 * narrowed by kind and year. The tier is checked per paper against its subject, as on a record
 * page — a register is not a way round the lock.
 */
export async function listIssuedDocuments(viewer: Principal, filter: RegisterFilter = {}): Promise<DocumentListRow[]> {
  const rows = await db()
    .select(listColumns)
    .from(schema.generatedDocument)
    .innerJoin(schema.person, eq(schema.person.id, schema.generatedDocument.subjectPersonId))
    .leftJoin(author, eq(author.id, schema.generatedDocument.generatedByPersonId))
    .innerJoin(schema.documentTemplate, eq(schema.documentTemplate.id, schema.generatedDocument.templateId))
    .where(
      and(
        filter.kind ? eq(schema.generatedDocument.kind, filter.kind) : undefined,
        filter.year ? sql`extract(year from ${schema.generatedDocument.createdAt} at time zone 'Asia/Ho_Chi_Minh') = ${filter.year}` : undefined,
      ),
    )
    .orderBy(desc(schema.generatedDocument.createdAt))
    .limit(REGISTER_LIMIT);
  const subjects = await getPersonTargets([...new Set(rows.map((row) => row.document.subjectPersonId))]);
  return rows.filter((row) => {
    const subject = subjects.get(row.document.subjectPersonId);
    return !!subject && canOpenDocument(viewer, subject, row.document.tier);
  }).map(toListRow);
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

