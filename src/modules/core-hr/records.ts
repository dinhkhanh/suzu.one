// The records that hang off a person above the directory tier: restricted fields, contracts,
// dependents, the document vault and emergency contacts. Part of the core-hr service (split from
// service.ts for size); other modules that need any of this get it re-exported from service.ts.
//
// Reads take the viewer's principal and answer null / leave rows out when the tier is not enough.
// Writes are authorized by the actions (policy.ts) before they get here.
import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { fieldBlindIndex, fieldCipher } from "@/lib/crypto";
import type { IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { beginUpload, completeUpload, createDownloadLink, findFile, softDeleteFile, type StoredFileRow } from "@/modules/platform/files/service";
import { canReadTier, type Principal } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";
import { getParameter } from "@/modules/platform/statutory/service";
import { CONTRACT_FILE_TIER, DEPENDENT_FILE_TIER, DOCUMENT_TIERS, type DocumentCategory } from "./document-tiers";
import { checkContract, type ContractType, type JobCategory } from "./engine/contract-rules";
import { SENSITIVE_TEXT_FIELDS } from "./enums";
import { contractTermsContext, dependentContext, NATIONAL_ID_INDEX_CONTEXT, normalizeIdNumber, sensitiveContext } from "./field-contexts";
import { getPersonTarget, inTransaction } from "./service";

type Actor = { personId: string; email?: string | null };
type SensitiveTextField = (typeof SENSITIVE_TEXT_FIELDS)[number];

const seal = (value: string | null, context: string) => (value === null ? null : fieldCipher().encrypt(value, context));
const unseal = (stored: string | null, context: string) => (stored === null ? null : fieldCipher().decrypt(stored, context));

async function readable(principal: Principal, personId: string, tier: Tier) {
  const target = await getPersonTarget(personId);
  return target && canReadTier(principal, target, tier) ? target : null;
}

// ── Restricted fields ───────────────────────────────────────────────────────────────────────

export type BankAccount = { bankName: string; accountNumber: string; accountHolder: string | null; branch: string | null };
export type SensitiveFields = Record<SensitiveTextField, string | null> & { bankAccounts: BankAccount[] };
export type SensitiveSummary = { filled: Record<SensitiveTextField | "bankAccounts", boolean> };

/** Which restricted fields are on file — nothing is decrypted. null = the viewer may not know even that. */
export async function getSensitiveSummary(principal: Principal, personId: string): Promise<SensitiveSummary | null> {
  if (!(await readable(principal, personId, "restricted"))) return null;
  const [row] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, personId)).limit(1);
  const filled = Object.fromEntries([...SENSITIVE_TEXT_FIELDS, "bankAccounts" as const].map((field) => [field, !!row?.[field]])) as SensitiveSummary["filled"];
  return { filled };
}

/**
 * The decrypted restricted fields, with the dependents' ID numbers. null = refused. Every call is
 * a disclosure: the only caller is `revealSensitiveAction`, whose pipeline writes the audit entry.
 */
export async function getSensitiveFields(principal: Principal, personId: string): Promise<(SensitiveFields & { dependents: { id: string; idNumber: string | null; taxCode: string | null }[] }) | null> {
  if (!(await readable(principal, personId, "restricted"))) return null;
  const [row] = await db().select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, personId)).limit(1);
  const text = Object.fromEntries(SENSITIVE_TEXT_FIELDS.map((field) => [field, unseal(row?.[field] ?? null, sensitiveContext(field, personId))])) as Record<SensitiveTextField, string | null>;
  const accounts = unseal(row?.bankAccounts ?? null, sensitiveContext("bankAccounts", personId));
  const dependents = await db().select().from(schema.dependent).where(and(eq(schema.dependent.personId, personId), isNull(schema.dependent.deletedAt)));
  return {
    ...text,
    bankAccounts: accounts ? (JSON.parse(accounts) as BankAccount[]) : [],
    dependents: dependents.map((row) => ({ id: row.id, idNumber: unseal(row.idNumber, dependentContext("idNumber", row.id)), taxCode: unseal(row.taxCode, dependentContext("taxCode", row.id)) })),
  };
}

/** Replaces the restricted fields. Returns only the *names* of what changed: values never reach the audit log. */
export async function updateSensitiveFields(personId: string, input: SensitiveFields, executor: Tx | ReturnType<typeof db> = db()): Promise<{ changed: string[]; entityId: string | null }> {
  const target = await getPersonTarget(personId, executor);
  if (!target) throw new ActionError("person_not_found");
  const [before] = await executor.select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, personId)).limit(1);

  const accounts = input.bankAccounts.length ? JSON.stringify(input.bankAccounts) : null;
  const plain: Record<string, string | null> = { ...Object.fromEntries(SENSITIVE_TEXT_FIELDS.map((field) => [field, input[field]])), bankAccounts: accounts };
  const changed: string[] = [];
  const values: Record<string, string | null> = {};
  for (const [field, value] of Object.entries(plain)) {
    const context = sensitiveContext(field, personId);
    const stored = (before as Record<string, unknown> | undefined)?.[field] as string | null | undefined;
    if (unseal(stored ?? null, context) === value) continue;
    changed.push(field);
    values[field] = seal(value, context);
  }
  if (changed.includes("nationalId")) values.nationalIdIndex = input.nationalId ? fieldBlindIndex(normalizeIdNumber(input.nationalId), NATIONAL_ID_INDEX_CONTEXT) : null;
  if (changed.length) {
    await executor
      .insert(schema.personSensitive)
      .values({ personId, ...values })
      .onConflictDoUpdate({ target: schema.personSensitive.personId, set: { ...values, updatedAt: new Date() } });
  }
  return { changed, entityId: target.entityId ?? null };
}

/**
 * Changes some restricted fields and leaves the rest as they are — what an approved change request
 * does. A new bank account becomes the first one (the one pay goes to); the others are kept.
 */
export async function patchSensitiveFields(executor: Tx | ReturnType<typeof db>, personId: string, patch: Partial<Record<SensitiveTextField, string | null>> & { bankAccount?: BankAccount | null }) {
  const [row] = await executor.select().from(schema.personSensitive).where(eq(schema.personSensitive.personId, personId)).limit(1);
  const current = Object.fromEntries(SENSITIVE_TEXT_FIELDS.map((field) => [field, unseal(row?.[field] ?? null, sensitiveContext(field, personId))])) as Record<SensitiveTextField, string | null>;
  const stored = unseal(row?.bankAccounts ?? null, sensitiveContext("bankAccounts", personId));
  const accounts = stored ? (JSON.parse(stored) as BankAccount[]) : [];
  const { bankAccount, ...text } = patch;
  const bankAccounts = bankAccount ? [bankAccount, ...accounts.slice(1).filter((account) => account.accountNumber !== bankAccount.accountNumber)] : accounts;
  return updateSensitiveFields(personId, { ...current, ...text, bankAccounts }, executor);
}

/** Other people with the same national ID on file — for the duplicate-person warning. Decrypts nothing. */
export async function findPeopleByNationalId(nationalId: string, exceptPersonId?: string): Promise<string[]> {
  const rows = await db().select({ personId: schema.personSensitive.personId }).from(schema.personSensitive).where(eq(schema.personSensitive.nationalIdIndex, fieldBlindIndex(normalizeIdNumber(nationalId), NATIONAL_ID_INDEX_CONTEXT)));
  return rows.map((row) => row.personId).filter((id) => id !== exceptPersonId);
}

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

export type ContractRow = typeof schema.contract.$inferSelect;
export type ContractView = Pick<ContractRow, "id" | "number" | "type" | "parentContractId" | "jobCategory" | "signDate" | "startDate" | "endDate" | "terminatedOn" | "note"> & {
  // null below the compensation tier: not even whether terms or a signed copy exist.
  hasSalaryTerms: boolean | null;
  files: { id: string; fileName: string }[] | null;
};

/** Newest first. Type, number and dates are personal tier; pay and the signed copy are compensation. null = refused. */
export async function listContracts(principal: Principal, personId: string): Promise<ContractView[] | null> {
  const target = await readable(principal, personId, "personal");
  if (!target) return null;
  const seesPay = canReadTier(principal, target, "compensation");
  const rows = await db().select().from(schema.contract).where(and(eq(schema.contract.personId, personId), isNull(schema.contract.deletedAt))).orderBy(desc(schema.contract.startDate), desc(schema.contract.createdAt));
  const files = seesPay && rows.length ? await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.ownerType, "contract"), inArray(schema.storedFile.ownerId, rows.map((row) => row.id)), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))) : [];
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    type: row.type,
    parentContractId: row.parentContractId,
    jobCategory: row.jobCategory,
    signDate: row.signDate,
    startDate: row.startDate,
    endDate: row.endDate,
    terminatedOn: row.terminatedOn,
    note: row.note,
    hasSalaryTerms: seesPay ? !!row.salaryTerms : null,
    files: seesPay ? files.filter((file) => file.ownerId === row.id).map((file) => ({ id: file.id, fileName: file.fileName })) : null,
  }));
}

export async function findContract(contractId: string): Promise<ContractRow | undefined> {
  const [row] = await db().select().from(schema.contract).where(and(eq(schema.contract.id, contractId), isNull(schema.contract.deletedAt))).limit(1);
  return row;
}

/** Compensation tier; a disclosure like `getSensitiveFields`, audited by the action that calls it. null = refused or none. */
export async function getContractSalaryTerms(principal: Principal, contractId: string): Promise<string | null> {
  const row = await findContract(contractId);
  if (!row || !(await readable(principal, row.personId, "compensation"))) return null;
  return unseal(row.salaryTerms, contractTermsContext(row.id));
}

export type ContractInput = {
  number: string;
  type: ContractType;
  parentContractId: string | null;
  jobCategory: JobCategory | null;
  signDate: IsoDate | null;
  startDate: IsoDate;
  endDate: IsoDate | null;
  /** Only ever set by someone who reads the compensation tier; the action strips it otherwise. */
  salaryTerms: string | null;
  note: string | null;
};

export async function createContract(personId: string, input: ContractInput, actorPersonId: string): Promise<ContractRow> {
  // The law in force when the contract starts is the one it must satisfy.
  const [fixedTerm, probation] = await Promise.all([getParameter("contract.fixed_term", input.startDate), getParameter("probation.limits", input.startDate)]);
  return inTransaction(async (tx) => {
    const [employment] = await tx.select().from(schema.employment).where(eq(schema.employment.personId, personId)).orderBy(desc(schema.employment.startDate)).limit(1).for("update");
    if (!employment) throw new ActionError("no_employment");
    const existing = await tx.select().from(schema.contract).where(and(eq(schema.contract.employmentId, employment.id), isNull(schema.contract.deletedAt)));
    const [problem] = checkContract(input, existing, { fixedTerm, probation });
    if (problem) throw new ActionError(problem);

    const id = randomUUID();
    const [created] = await tx
      .insert(schema.contract)
      .values({ ...input, id, employmentId: employment.id, personId, entityId: employment.entityId, salaryTerms: seal(input.salaryTerms, contractTermsContext(id)), createdByPersonId: actorPersonId })
      .returning();
    return created;
  });
}

/** Ends a contract early (resignation, mutual agreement); the row and its history stay. */
export async function terminateContract(contractId: string, terminatedOn: IsoDate): Promise<{ before: ContractRow; after: ContractRow }> {
  const before = await findContract(contractId);
  if (!before) throw new ActionError("contract_not_found");
  if (terminatedOn < before.startDate || (before.endDate && terminatedOn > before.endDate)) throw new ActionError("contract_termination_outside_term");
  const [after] = await db().update(schema.contract).set({ terminatedOn, updatedAt: new Date() }).where(eq(schema.contract.id, contractId)).returning();
  return { before, after };
}

/** For contracts entered by mistake. Soft (DR-03). */
export async function deleteContract(contractId: string): Promise<ContractRow> {
  const [row] = await db().update(schema.contract).set({ deletedAt: new Date() }).where(and(eq(schema.contract.id, contractId), isNull(schema.contract.deletedAt))).returning();
  if (!row) throw new ActionError("contract_not_found");
  return row;
}

/** Audit-safe copy: the ciphertext says nothing, but it has no business in the log either. */
export const withoutSecrets = <Row extends Record<string, unknown>>(row: Row, fields: readonly (keyof Row)[]) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, fields.includes(key) && value !== null ? "[encrypted]" : value]));

// ── Dependents ──────────────────────────────────────────────────────────────────────────────

export type DependentRow = typeof schema.dependent.$inferSelect;
export type DependentView = Pick<DependentRow, "id" | "fullName" | "relationship" | "dateOfBirth" | "deductionFrom" | "deductionTo" | "note"> & { hasIdNumber: boolean; hasTaxCode: boolean; files: { id: string; fileName: string }[] };

/** The PIT family-deduction register: restricted tier as a whole. null = refused. ID numbers come with `getSensitiveFields`. */
export async function listDependents(principal: Principal, personId: string): Promise<DependentView[] | null> {
  if (!(await readable(principal, personId, "restricted"))) return null;
  const rows = await db().select().from(schema.dependent).where(and(eq(schema.dependent.personId, personId), isNull(schema.dependent.deletedAt))).orderBy(asc(schema.dependent.deductionFrom), asc(schema.dependent.createdAt));
  const files = rows.length ? await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.ownerType, "dependent"), inArray(schema.storedFile.ownerId, rows.map((row) => row.id)), eq(schema.storedFile.status, "ready"), isNull(schema.storedFile.deletedAt))) : [];
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    relationship: row.relationship,
    dateOfBirth: row.dateOfBirth,
    deductionFrom: row.deductionFrom,
    deductionTo: row.deductionTo,
    note: row.note,
    hasIdNumber: !!row.idNumber,
    hasTaxCode: !!row.taxCode,
    files: files.filter((file) => file.ownerId === row.id).map((file) => ({ id: file.id, fileName: file.fileName })),
  }));
}

export type DependentInput = { fullName: string; relationship: DependentRow["relationship"]; dateOfBirth: IsoDate | null; idNumber: string | null; taxCode: string | null; deductionFrom: IsoDate; deductionTo: IsoDate | null; note: string | null };

export async function findDependent(dependentId: string): Promise<DependentRow | undefined> {
  const [row] = await db().select().from(schema.dependent).where(and(eq(schema.dependent.id, dependentId), isNull(schema.dependent.deletedAt))).limit(1);
  return row;
}

export async function createDependent(personId: string, input: DependentInput): Promise<DependentRow> {
  if (input.deductionTo && input.deductionTo < input.deductionFrom) throw new ActionError("dependent_months");
  const id = randomUUID();
  const [created] = await db()
    .insert(schema.dependent)
    .values({ ...input, id, personId, fullName: input.fullName.trim().replace(/\s+/g, " "), idNumber: seal(input.idNumber, dependentContext("idNumber", id)), taxCode: seal(input.taxCode, dependentContext("taxCode", id)) })
    .returning();
  return created;
}

/** The last month the deduction counts (the child turned 18, the parent started a pension…). null re-opens it. */
export async function endDependentDeduction(dependentId: string, deductionTo: IsoDate | null): Promise<{ before: DependentRow; after: DependentRow }> {
  const before = await findDependent(dependentId);
  if (!before) throw new ActionError("dependent_not_found");
  if (deductionTo && deductionTo < before.deductionFrom) throw new ActionError("dependent_months");
  const [after] = await db().update(schema.dependent).set({ deductionTo, updatedAt: new Date() }).where(eq(schema.dependent.id, dependentId)).returning();
  return { before, after };
}

export async function deleteDependent(dependentId: string): Promise<DependentRow> {
  const [row] = await db().update(schema.dependent).set({ deletedAt: new Date() }).where(and(eq(schema.dependent.id, dependentId), isNull(schema.dependent.deletedAt))).returning();
  if (!row) throw new ActionError("dependent_not_found");
  return row;
}

// ── Emergency contacts (personal tier) ──────────────────────────────────────────────────────

export type EmergencyContactRow = typeof schema.emergencyContact.$inferSelect;

export async function listEmergencyContacts(principal: Principal, personId: string): Promise<EmergencyContactRow[] | null> {
  if (!(await readable(principal, personId, "personal"))) return null;
  return db().select().from(schema.emergencyContact).where(eq(schema.emergencyContact.personId, personId)).orderBy(asc(schema.emergencyContact.createdAt));
}

export async function addEmergencyContact(personId: string, input: { fullName: string; relationship: string | null; phone: string; note: string | null }): Promise<EmergencyContactRow> {
  const [created] = await db().insert(schema.emergencyContact).values({ personId, ...input }).returning();
  return created;
}

export async function findEmergencyContact(id: string): Promise<EmergencyContactRow | undefined> {
  const [row] = await db().select().from(schema.emergencyContact).where(eq(schema.emergencyContact.id, id)).limit(1);
  return row;
}

export async function removeEmergencyContact(id: string): Promise<EmergencyContactRow> {
  const [row] = await db().delete(schema.emergencyContact).where(eq(schema.emergencyContact.id, id)).returning();
  if (!row) throw new ActionError("contact_not_found");
  return row;
}

// ── Document vault and attachments ──────────────────────────────────────────────────────────

export type DocumentView = { id: string; category: DocumentCategory; title: string; expiresOn: IsoDate | null; tier: Tier; fileId: string; fileName: string; sizeBytes: number; createdAt: Date };

/** Only the documents whose tier the viewer reads: a line manager sees degrees, never ID scans or signed contracts. */
export async function listDocuments(principal: Principal, personId: string): Promise<DocumentView[]> {
  const target = await getPersonTarget(personId);
  if (!target) return [];
  const rows = await db()
    .select({ document: schema.personDocument, fileName: schema.storedFile.fileName, sizeBytes: schema.storedFile.sizeBytes })
    .from(schema.personDocument)
    .innerJoin(schema.storedFile, eq(schema.storedFile.id, schema.personDocument.fileId))
    .where(and(eq(schema.personDocument.personId, personId), isNull(schema.personDocument.deletedAt)))
    .orderBy(asc(schema.personDocument.category), desc(schema.personDocument.createdAt));
  return rows
    .filter((row) => canReadTier(principal, target, row.document.tier as Tier))
    .map(({ document, fileName, sizeBytes }) => ({ id: document.id, category: document.category, title: document.title, expiresOn: document.expiresOn, tier: document.tier as Tier, fileId: document.fileId, fileName, sizeBytes, createdAt: document.createdAt }));
}

type Upload = { fileId: string; uploadUrl: string; contentType: string };

/** Step 1 of a vault upload. The document row is only written once the bytes have arrived and been checked. */
export async function beginDocumentUpload(personId: string, input: { category: DocumentCategory; fileName: string; sizeBytes: number }, actor: Actor): Promise<Upload> {
  const target = await getPersonTarget(personId);
  if (!target) throw new ActionError("person_not_found");
  return beginUpload({ ownerType: "person_document", ownerId: randomUUID(), entityId: target.entityId ?? null, tier: DOCUMENT_TIERS[input.category] }, input, actor);
}

export async function completeDocumentUpload(personId: string, input: { fileId: string; category: DocumentCategory; title: string; expiresOn: IsoDate | null }, actor: Actor) {
  const [pending] = await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, input.fileId)).limit(1);
  // The tier was fixed when the upload was allowed; a different category now would re-label the file.
  const target = await getPersonTarget(personId);
  if (!pending || !target || pending.ownerType !== "person_document" || pending.tier !== DOCUMENT_TIERS[input.category] || pending.entityId !== (target.entityId ?? null)) throw new ActionError("file_not_found");
  const file = await completeUpload(input.fileId, actor);
  const [created] = await db()
    .insert(schema.personDocument)
    .values({ id: file.ownerId, personId, entityId: file.entityId, category: input.category, title: input.title, expiresOn: input.expiresOn, tier: file.tier, fileId: file.id, uploadedByPersonId: actor.personId })
    .returning();
  return created;
}

export async function findDocument(documentId: string) {
  const [row] = await db().select().from(schema.personDocument).where(and(eq(schema.personDocument.id, documentId), isNull(schema.personDocument.deletedAt))).limit(1);
  return row;
}

export async function deleteDocument(documentId: string) {
  const [row] = await db().update(schema.personDocument).set({ deletedAt: new Date() }).where(and(eq(schema.personDocument.id, documentId), isNull(schema.personDocument.deletedAt))).returning();
  if (!row) throw new ActionError("document_not_found");
  await softDeleteFile(row.fileId);
  return row;
}

// Files attached straight to a record: a contract's signed copy, a dependent's supporting papers.
export const ATTACHMENT_OWNERS = ["contract", "dependent"] as const;
export type AttachmentOwner = (typeof ATTACHMENT_OWNERS)[number];

/** Whose record a file belongs to and how sensitive it is — what every file action is authorized against. */
export async function resolveAttachmentOwner(ownerType: string, ownerId: string): Promise<{ personId: string; tier: Tier } | null> {
  if (ownerType === "contract") {
    const row = await findContract(ownerId);
    return row ? { personId: row.personId, tier: CONTRACT_FILE_TIER } : null;
  }
  if (ownerType === "dependent") {
    const row = await findDependent(ownerId);
    return row ? { personId: row.personId, tier: DEPENDENT_FILE_TIER } : null;
  }
  if (ownerType === "person_document") {
    const row = await findDocument(ownerId);
    return row ? { personId: row.personId, tier: row.tier as Tier } : null;
  }
  return null;
}

/** `pending: true` looks at an upload that is still to be confirmed. */
export async function resolveFileOwner(fileId: string, options: { pending?: boolean } = {}): Promise<{ file: StoredFileRow; personId: string; tier: Tier } | null> {
  const file = options.pending ? (await db().select().from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.status, "pending"))).limit(1))[0] : await findFile(fileId);
  const owner = file && (await resolveAttachmentOwner(file.ownerType, file.ownerId));
  return file && owner ? { file, ...owner } : null;
}

export async function beginAttachmentUpload(ownerType: AttachmentOwner, ownerId: string, input: { fileName: string; sizeBytes: number }, actor: Actor): Promise<Upload> {
  const owner = await resolveAttachmentOwner(ownerType, ownerId);
  const target = owner && (await getPersonTarget(owner.personId));
  if (!owner || !target) throw new ActionError("file_owner_not_found");
  return beginUpload({ ownerType, ownerId, entityId: target.entityId ?? null, tier: owner.tier }, input, actor);
}

export const completeAttachmentUpload = (fileId: string, actor: Actor) => completeUpload(fileId, actor);

/** A one-minute link. The files service audits the opening of restricted and compensation files. null = refused. */
export async function getFileDownloadLink(principal: Principal, fileId: string, actor: Actor, request?: { ipAddress?: string | null; userAgent?: string | null }): Promise<string | null> {
  const owned = await resolveFileOwner(fileId);
  if (!owned || !(await readable(principal, owned.personId, owned.tier))) return null;
  return createDownloadLink(owned.file, actor, request);
}

export async function deleteAttachment(fileId: string): Promise<StoredFileRow> {
  const file = await softDeleteFile(fileId);
  if (!file) throw new ActionError("file_not_found");
  return file;
}
