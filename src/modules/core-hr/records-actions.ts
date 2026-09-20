"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { canReadTier } from "@/modules/platform/rbac/policy";
import { DOCUMENT_TIERS } from "./document-tiers";
import { CONTRACT_TYPES, DEPENDENT_RELATIONSHIPS, DOCUMENT_CATEGORIES, JOB_CATEGORIES, SENSITIVE_TEXT_FIELDS } from "./enums";
import { canManageRecords, canReadRecords } from "./policy";
import {
  addEmergencyContact,
  ATTACHMENT_OWNERS,
  beginAttachmentUpload,
  beginDocumentUpload,
  completeAttachmentUpload,
  completeDocumentUpload,
  createContract,
  createDependent,
  deleteAttachment,
  deleteContract,
  deleteDependent,
  deleteDocument,
  endDependentDeduction,
  findContract,
  findDependent,
  findDocument,
  findEmergencyContact,
  getContractSalaryTerms,
  getFileDownloadLink,
  getSensitiveFields,
  removeEmergencyContact,
  resolveAttachmentOwner,
  resolveFileOwner,
  terminateContract,
  updateSensitiveFields,
  withoutSecrets,
} from "./records";
import { getPersonTarget } from "./service";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const day = z.iso.date();
// <input type="month"> posts "2026-09"; months are stored as their first day.
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).transform((value) => `${value}-01`);
const fileMeta = { fileName: z.string().min(1).max(300), sizeBytes: z.number().int().positive() };

const refresh = (personId: string) => revalidatePath(`/people/${personId}`);
const actorOf = (user: { person: { id: string }; email: string }) => ({ personId: user.person.id, email: user.email });

// ── Restricted fields ───────────────────────────────────────────────────────────────────────

const revealSensitivePipeline = createAction({
  name: "person.sensitive.read",
  input: z.object({ personId: z.uuid() }),
  authorize: async (user, input) => canReadRecords(user.principal, await getPersonTarget(input.personId), "restricted"),
  run: async ({ user, input }) => {
    const fields = await getSensitiveFields(user.principal, input.personId);
    if (!fields) throw new ActionError("forbidden");
    const target = await getPersonTarget(input.personId);
    // Who looked, at whom, and which fields were there to see — never the values.
    const shown = [...SENSITIVE_TEXT_FIELDS.filter((field) => fields[field] !== null), ...(fields.bankAccounts.length ? ["bankAccounts"] : []), ...(fields.dependents.length ? ["dependents"] : [])];
    return { data: fields, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId }, summary: `fields: ${shown.join(", ") || "none"}` } };
  },
});

export async function revealSensitiveAction(input: unknown) {
  return revealSensitivePipeline(input);
}

const bankAccount = z.object({ bankName: text(120), accountNumber: text(40), accountHolder: text(120), branch: text(120) });

const updateSensitivePipeline = createAction({
  name: "person.sensitive.update",
  input: z.object({
    personId: z.uuid(),
    nationalId: text(40),
    nationalIdIssuedOn: optional(day),
    nationalIdIssuedAt: text(200),
    passportNumber: text(40),
    taxCode: text(40),
    socialInsuranceNumber: text(40),
    healthInsuranceHospital: text(200),
    // Forms post "bankAccounts.0.bankName"; rows without an account number are blank rows.
    bankAccounts: z.record(z.string(), bankAccount).default({}),
  }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), "restricted"),
  run: async ({ input }) => {
    const { personId, bankAccounts, ...fields } = input;
    const accounts = Object.values(bankAccounts).flatMap((row) => (row.accountNumber && row.bankName ? [{ bankName: row.bankName, accountNumber: row.accountNumber, accountHolder: row.accountHolder, branch: row.branch }] : []));
    const { changed, entityId } = await updateSensitiveFields(personId, { ...fields, bankAccounts: accounts });
    refresh(personId);
    return { data: { changed }, audit: { resource: { type: "person", id: personId, entityId }, summary: `changed: ${changed.join(", ") || "nothing"}`, after: { changed } } };
  },
});

export async function updateSensitiveAction(input: unknown) {
  return updateSensitivePipeline(input);
}

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

const createContractPipeline = createAction({
  name: "contract.create",
  input: z.object({
    personId: z.uuid(),
    number: z.string().trim().min(1).max(60),
    type: z.enum(CONTRACT_TYPES),
    parentContractId: optional(z.uuid()),
    jobCategory: optional(z.enum(JOB_CATEGORIES)),
    signDate: optional(day),
    startDate: day,
    endDate: optional(day),
    salaryTerms: text(2000),
    note: text(500),
  }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), "personal"),
  run: async ({ user, input }) => {
    const { personId, ...details } = input;
    const target = await getPersonTarget(personId);
    // Pay is written only by those who may read it back.
    if (details.salaryTerms && !(target && canReadTier(user.principal, target, "compensation"))) throw new ActionError("contract_salary_terms_forbidden");
    const created = await createContract(personId, details, user.person.id);
    refresh(personId);
    return { data: { id: created.id }, audit: { resource: { type: "contract", id: created.id, entityId: created.entityId }, summary: `${created.number} (${created.type})`, after: withoutSecrets(created, ["salaryTerms"]) } };
  },
});

export async function createContractAction(input: unknown) {
  return createContractPipeline(input);
}

const contractTarget = async (contractId: string) => {
  const contract = await findContract(contractId);
  return contract ? getPersonTarget(contract.personId) : null;
};

const terminateContractPipeline = createAction({
  name: "contract.terminate",
  input: z.object({ contractId: z.uuid(), terminatedOn: day }),
  authorize: async (user, input) => canManageRecords(user.principal, await contractTarget(input.contractId), "personal"),
  run: async ({ input }) => {
    const { before, after } = await terminateContract(input.contractId, input.terminatedOn);
    refresh(after.personId);
    return { data: { id: after.id }, audit: { resource: { type: "contract", id: after.id, entityId: after.entityId }, summary: `${after.number} ended ${after.terminatedOn}`, before: withoutSecrets(before, ["salaryTerms"]), after: withoutSecrets(after, ["salaryTerms"]) } };
  },
});

export async function terminateContractAction(input: unknown) {
  return terminateContractPipeline(input);
}

const deleteContractPipeline = createAction({
  name: "contract.delete",
  input: z.object({ contractId: z.uuid() }),
  authorize: async (user, input) => canManageRecords(user.principal, await contractTarget(input.contractId), "personal"),
  run: async ({ input }) => {
    const removed = await deleteContract(input.contractId);
    refresh(removed.personId);
    return { data: { id: removed.id }, audit: { resource: { type: "contract", id: removed.id, entityId: removed.entityId }, summary: removed.number, before: withoutSecrets(removed, ["salaryTerms"]) } };
  },
});

export async function deleteContractAction(input: unknown) {
  return deleteContractPipeline(input);
}

const revealTermsPipeline = createAction({
  name: "contract.salary_terms.read",
  input: z.object({ contractId: z.uuid() }),
  authorize: async (user, input) => canReadRecords(user.principal, await contractTarget(input.contractId), "compensation"),
  run: async ({ user, input }) => {
    const contract = await findContract(input.contractId);
    if (!contract) throw new ActionError("contract_not_found");
    return { data: { salaryTerms: await getContractSalaryTerms(user.principal, input.contractId) }, audit: { resource: { type: "contract", id: contract.id, entityId: contract.entityId }, summary: contract.number } };
  },
});

export async function revealContractTermsAction(input: unknown) {
  return revealTermsPipeline(input);
}

// ── Dependents ──────────────────────────────────────────────────────────────────────────────

const createDependentPipeline = createAction({
  name: "dependent.create",
  input: z.object({
    personId: z.uuid(),
    fullName: z.string().trim().min(2).max(120),
    relationship: z.enum(DEPENDENT_RELATIONSHIPS),
    dateOfBirth: optional(day),
    idNumber: text(40),
    taxCode: text(40),
    deductionFrom: month,
    deductionTo: optional(month),
    note: text(500),
  }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), "restricted"),
  run: async ({ input }) => {
    const { personId, ...details } = input;
    const created = await createDependent(personId, details);
    const target = await getPersonTarget(personId);
    refresh(personId);
    return { data: { id: created.id }, audit: { resource: { type: "dependent", id: created.id, entityId: target?.entityId }, summary: `${created.relationship} from ${created.deductionFrom.slice(0, 7)}`, after: withoutSecrets(created, ["idNumber", "taxCode"]) } };
  },
});

export async function createDependentAction(input: unknown) {
  return createDependentPipeline(input);
}

const dependentTarget = async (dependentId: string) => {
  const row = await findDependent(dependentId);
  return row ? getPersonTarget(row.personId) : null;
};

const endDeductionPipeline = createAction({
  name: "dependent.deduction_end",
  input: z.object({ dependentId: z.uuid(), deductionTo: optional(month) }),
  authorize: async (user, input) => canManageRecords(user.principal, await dependentTarget(input.dependentId), "restricted"),
  run: async ({ input }) => {
    const { before, after } = await endDependentDeduction(input.dependentId, input.deductionTo);
    const target = await getPersonTarget(after.personId);
    refresh(after.personId);
    return { data: { id: after.id }, audit: { resource: { type: "dependent", id: after.id, entityId: target?.entityId }, summary: `deduction to ${after.deductionTo?.slice(0, 7) ?? "open"}`, before: { deductionTo: before.deductionTo }, after: { deductionTo: after.deductionTo } } };
  },
});

export async function endDependentDeductionAction(input: unknown) {
  return endDeductionPipeline(input);
}

const deleteDependentPipeline = createAction({
  name: "dependent.delete",
  input: z.object({ dependentId: z.uuid() }),
  authorize: async (user, input) => canManageRecords(user.principal, await dependentTarget(input.dependentId), "restricted"),
  run: async ({ input }) => {
    const removed = await deleteDependent(input.dependentId);
    const target = await getPersonTarget(removed.personId);
    refresh(removed.personId);
    return { data: { id: removed.id }, audit: { resource: { type: "dependent", id: removed.id, entityId: target?.entityId }, summary: removed.relationship, before: withoutSecrets(removed, ["idNumber", "taxCode"]) } };
  },
});

export async function deleteDependentAction(input: unknown) {
  return deleteDependentPipeline(input);
}

// ── Emergency contacts ──────────────────────────────────────────────────────────────────────

const addContactPipeline = createAction({
  name: "emergency_contact.add",
  input: z.object({ personId: z.uuid(), fullName: z.string().trim().min(2).max(120), relationship: text(60), phone: z.string().trim().min(3).max(30), note: text(300) }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), "personal"),
  run: async ({ input }) => {
    const { personId, ...details } = input;
    const created = await addEmergencyContact(personId, details);
    const target = await getPersonTarget(personId);
    refresh(personId);
    return { data: { id: created.id }, audit: { resource: { type: "emergency_contact", id: created.id, entityId: target?.entityId }, summary: created.fullName, after: created } };
  },
});

export async function addEmergencyContactAction(input: unknown) {
  return addContactPipeline(input);
}

const removeContactPipeline = createAction({
  name: "emergency_contact.remove",
  input: z.object({ contactId: z.uuid() }),
  authorize: async (user, input) => {
    const contact = await findEmergencyContact(input.contactId);
    return canManageRecords(user.principal, contact ? await getPersonTarget(contact.personId) : null, "personal");
  },
  run: async ({ input }) => {
    const removed = await removeEmergencyContact(input.contactId);
    const target = await getPersonTarget(removed.personId);
    refresh(removed.personId);
    return { data: { id: removed.id }, audit: { resource: { type: "emergency_contact", id: removed.id, entityId: target?.entityId }, summary: removed.fullName, before: removed } };
  },
});

export async function removeEmergencyContactAction(input: unknown) {
  return removeContactPipeline(input);
}

// ── Document vault ──────────────────────────────────────────────────────────────────────────

const beginDocumentPipeline = createAction({
  name: "document.upload.begin",
  input: z.object({ personId: z.uuid(), category: z.enum(DOCUMENT_CATEGORIES), ...fileMeta }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), DOCUMENT_TIERS[input.category]),
  run: async ({ user, input }) => {
    const { personId, ...file } = input;
    const upload = await beginDocumentUpload(personId, file, actorOf(user));
    return { data: upload, audit: { resource: { type: "person", id: personId }, summary: `${input.category}: ${input.fileName}` } };
  },
});

export async function beginDocumentUploadAction(input: unknown) {
  return beginDocumentPipeline(input);
}

const completeDocumentPipeline = createAction({
  name: "document.create",
  input: z.object({ personId: z.uuid(), fileId: z.uuid(), category: z.enum(DOCUMENT_CATEGORIES), title: z.string().trim().min(1).max(200), expiresOn: optional(day) }),
  authorize: async (user, input) => canManageRecords(user.principal, await getPersonTarget(input.personId), DOCUMENT_TIERS[input.category]),
  run: async ({ user, input }) => {
    const { personId, ...details } = input;
    const created = await completeDocumentUpload(personId, details, actorOf(user));
    refresh(personId);
    return { data: { id: created.id }, audit: { resource: { type: "person_document", id: created.id, entityId: created.entityId }, summary: `${created.category}: ${created.title}`, after: created } };
  },
});

export async function completeDocumentUploadAction(input: unknown) {
  return completeDocumentPipeline(input);
}

const deleteDocumentPipeline = createAction({
  name: "document.delete",
  input: z.object({ documentId: z.uuid() }),
  authorize: async (user, input) => {
    const document = await findDocument(input.documentId);
    return !!document && canManageRecords(user.principal, await getPersonTarget(document.personId), document.tier as "personal");
  },
  run: async ({ input }) => {
    const removed = await deleteDocument(input.documentId);
    refresh(removed.personId);
    return { data: { id: removed.id }, audit: { resource: { type: "person_document", id: removed.id, entityId: removed.entityId }, summary: `${removed.category}: ${removed.title}`, before: removed } };
  },
});

export async function deleteDocumentAction(input: unknown) {
  return deleteDocumentPipeline(input);
}

// ── Attachments (signed contract copies, dependents' papers) and downloads ──────────────────

const beginAttachmentPipeline = createAction({
  name: "attachment.upload.begin",
  input: z.object({ ownerType: z.enum(ATTACHMENT_OWNERS), ownerId: z.uuid(), ...fileMeta }),
  authorize: async (user, input) => {
    const owner = await resolveAttachmentOwner(input.ownerType, input.ownerId);
    return !!owner && canManageRecords(user.principal, await getPersonTarget(owner.personId), owner.tier);
  },
  run: async ({ user, input }) => {
    const { ownerType, ownerId, ...file } = input;
    const upload = await beginAttachmentUpload(ownerType, ownerId, file, actorOf(user));
    return { data: upload, audit: { resource: { type: ownerType, id: ownerId }, summary: input.fileName } };
  },
});

export async function beginAttachmentUploadAction(input: unknown) {
  return beginAttachmentPipeline(input);
}

const completeAttachmentPipeline = createAction({
  name: "attachment.create",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const owned = await resolveFileOwner(input.fileId, { pending: true });
    return !!owned && owned.file.ownerType !== "person_document" && canManageRecords(user.principal, await getPersonTarget(owned.personId), owned.tier);
  },
  run: async ({ user, input }) => {
    const owned = await resolveFileOwner(input.fileId, { pending: true });
    const file = await completeAttachmentUpload(input.fileId, actorOf(user));
    if (owned) refresh(owned.personId);
    return { data: { id: file.id }, audit: { resource: { type: file.ownerType, id: file.ownerId, entityId: file.entityId }, summary: file.fileName, after: { fileId: file.id, sizeBytes: file.sizeBytes } } };
  },
});

export async function completeAttachmentUploadAction(input: unknown) {
  return completeAttachmentPipeline(input);
}

const deleteAttachmentPipeline = createAction({
  name: "attachment.delete",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const owned = await resolveFileOwner(input.fileId);
    // Vault files go with their document row (document.delete), not on their own.
    return !!owned && owned.file.ownerType !== "person_document" && canManageRecords(user.principal, await getPersonTarget(owned.personId), owned.tier);
  },
  run: async ({ input }) => {
    const owned = await resolveFileOwner(input.fileId);
    const file = await deleteAttachment(input.fileId);
    if (owned) refresh(owned.personId);
    return { data: { id: file.id }, audit: { resource: { type: file.ownerType, id: file.ownerId, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function deleteAttachmentAction(input: unknown) {
  return deleteAttachmentPipeline(input);
}

const downloadPipeline = createAction({
  name: "file.download",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const owned = await resolveFileOwner(input.fileId);
    return !!owned && canReadRecords(user.principal, await getPersonTarget(owned.personId), owned.tier);
  },
  run: async ({ user, input }) => {
    const url = await getFileDownloadLink(user.principal, input.fileId, actorOf(user), user.request);
    const owned = await resolveFileOwner(input.fileId);
    if (!url || !owned) throw new ActionError("file_not_found");
    return { data: { url }, audit: { resource: { type: owned.file.ownerType, id: owned.file.ownerId, entityId: owned.file.entityId }, summary: owned.file.fileName } };
  },
});

export async function fileDownloadAction(input: unknown) {
  return downloadPipeline(input);
}
