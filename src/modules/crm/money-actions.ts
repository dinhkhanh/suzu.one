"use server";
// Contracts (FR-CRM-25), invoices and payments (FR-CRM-30..32). A contract is the account's
// people's and the sellers'; its value follows the money rule and is written only by someone who
// may see it. Invoices and payments are finance's, over the entity of what they invoice.
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "../platform/auth/session";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "../platform/files/service";
import { billingItemsByIds } from "@/modules/projects/service";
import { findAccount } from "./accounts";
import { findContract, linkProjectToContract, saveContract, signContract, terminateContract } from "./contracts";
import { CONTRACT_KINDS, PAYMENT_METHODS } from "./enums";
import { checkbox, days, isoDate, optional, text, vnd } from "./form-inputs";
import { findInvoice, recordInvoice, recordPayment, removePayment, writeOffInvoice } from "./invoices";
import { type AccountFacts, canEditContracts, canRecordInvoices, canSeeAccountMoney, canViewContracts, type CrmViewer } from "./policy";
import { loadCrm } from "./viewer";

const SIGNED_CONTRACT = "crm_contract";
const FILE_TIER = "personal" as const;

async function mayAccount(user: CurrentUser, clientId: string, rule: (viewer: CrmViewer, account: AccountFacts) => boolean): Promise<boolean> {
  const [{ viewer }, account] = await Promise.all([loadCrm(user), findAccount(clientId)]);
  return !!account && rule(viewer, account.facts);
}

async function mayContract(user: CurrentUser, contractId: string, rule: (viewer: CrmViewer, account: AccountFacts) => boolean): Promise<boolean> {
  const contract = await findContract(contractId);
  return !!contract && mayAccount(user, contract.clientId, rule);
}

function refreshContract(clientId: string, contractId?: string) {
  revalidatePath("/crm/contracts");
  revalidatePath(`/crm/accounts/${clientId}`);
  if (contractId) revalidatePath(`/crm/contracts/${contractId}`);
}

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

const contractPipeline = createAction({
  name: "crm.contract.save",
  input: z.object({
    clientId: z.uuid(),
    contractId: optional(z.uuid()),
    number: z.string().trim().min(1).max(80),
    title: z.string().trim().min(1).max(200),
    kind: z.enum(CONTRACT_KINDS),
    entityId: optional(z.uuid()),
    parentContractId: optional(z.uuid()),
    dealId: optional(z.uuid()),
    startDate: optional(isoDate),
    endDate: optional(isoDate),
    valueVnd: vnd,
    paymentTermsDays: days,
    autoRenew: checkbox.default(false),
    noticeDays: days,
    note: text(2000),
  }),
  authorize: (user, input) => mayAccount(user, input.clientId, canEditContracts),
  run: async ({ user, input }) => {
    const { clientId, contractId, valueVnd, ...values } = input;
    // The value is written only by someone who may read it; for anyone else the field is ignored.
    const seesMoney = await mayAccount(user, clientId, canSeeAccountMoney);
    const { before, after } = await saveContract(clientId, contractId, { ...values, ...(seesMoney ? { valueVnd } : {}) }, user.person.id);
    refreshContract(clientId, after.id);
    return { data: { id: after.id }, audit: { resource: { type: "crm_contract", id: after.id, entityId: after.entityId }, summary: after.number, before, after } };
  },
});
export async function saveContractAction(input: unknown) {
  return contractPipeline(input);
}

const signPipeline = createAction({
  name: "crm.contract.sign",
  input: z.object({ contractId: z.uuid(), signedOn: isoDate, fileId: z.uuid() }),
  authorize: (user, input) => mayContract(user, input.contractId, canEditContracts),
  run: async ({ input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.ownerType !== SIGNED_CONTRACT || file.ownerId !== input.contractId || file.status !== "ready") throw new ActionError("file_not_found");
    const { before, after } = await signContract(input.contractId, { signedOn: input.signedOn, signedFileId: input.fileId });
    refreshContract(after.clientId, after.id);
    return { data: { id: after.id }, audit: { resource: { type: "crm_contract", id: after.id, entityId: after.entityId }, before: { status: before.status }, after: { status: after.status, signedOn: after.signedOn } } };
  },
});
export async function signContractAction(input: unknown) {
  return signPipeline(input);
}

const terminatePipeline = createAction({
  name: "crm.contract.terminate",
  input: z.object({ contractId: z.uuid(), terminatedOn: isoDate, note: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => mayContract(user, input.contractId, canEditContracts),
  run: async ({ input }) => {
    const { before, after } = await terminateContract(input.contractId, input);
    refreshContract(after.clientId, after.id);
    return { data: { id: after.id }, audit: { resource: { type: "crm_contract", id: after.id, entityId: after.entityId }, before: { status: before.status }, after: { status: after.status, terminatedOn: after.terminatedOn } } };
  },
});
export async function terminateContractAction(input: unknown) {
  return terminatePipeline(input);
}

const linkPipeline = createAction({
  name: "crm.contract.link_project",
  input: z.object({ projectId: z.uuid(), clientId: z.uuid(), contractId: optional(z.uuid()) }),
  authorize: (user, input) => mayAccount(user, input.clientId, canEditContracts),
  run: async ({ input }) => {
    const [project] = await db().select({ clientId: schema.workProject.clientId }).from(schema.workProject).where(eq(schema.workProject.id, input.projectId)).limit(1);
    const account = project?.clientId ? await findAccount(project.clientId) : null;
    if (!account || account.client.id !== input.clientId) throw new ActionError("project_not_found");
    await linkProjectToContract(input.projectId, input.contractId);
    refreshContract(input.clientId, input.contractId ?? undefined);
    revalidatePath(`/projects/${input.projectId}`);
    return { data: { ok: true }, audit: { resource: { type: "work_project", id: input.projectId }, summary: input.contractId ?? "unlinked" } };
  },
});
export async function linkProjectContractAction(input: unknown) {
  return linkPipeline(input);
}

const beginScanPipeline = createAction({
  name: "crm.contract.scan.begin",
  input: z.object({ contractId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => mayContract(user, input.contractId, canEditContracts),
  run: async ({ user, input }) => {
    const contract = (await findContract(input.contractId))!;
    const upload = await beginUpload({ ownerType: SIGNED_CONTRACT, ownerId: contract.id, entityId: contract.entityId, tier: FILE_TIER }, { fileName: input.fileName, sizeBytes: input.sizeBytes }, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: contract.entityId }, summary: input.fileName } };
  },
});
export async function beginContractScanAction(input: unknown) {
  return beginScanPipeline(input);
}

const completeScanPipeline = createAction({
  name: "crm.contract.scan.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const [row] = await db()
      .select({ id: schema.storedFile.id })
      .from(schema.storedFile)
      .where(and(eq(schema.storedFile.id, input.fileId), eq(schema.storedFile.ownerType, SIGNED_CONTRACT), eq(schema.storedFile.uploadedByPersonId, user.person.id), eq(schema.storedFile.status, "pending")))
      .limit(1);
    return !!row;
  },
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function completeContractScanAction(input: unknown) {
  return completeScanPipeline(input);
}

const openScanPipeline = createAction({
  name: "crm.contract.scan.open",
  input: z.object({ contractId: z.uuid() }),
  // The signed paper opens for whoever works the account — and only as that contract's own scan.
  authorize: (user, input) => mayContract(user, input.contractId, canViewContracts),
  run: async ({ user, input }) => {
    const contract = await findContract(input.contractId);
    const file = contract?.signedFileId ? await findFile(contract.signedFileId) : undefined;
    if (!contract || !file || file.ownerType !== SIGNED_CONTRACT || file.ownerId !== contract.id) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function openContractScanAction(input: unknown) {
  return openScanPipeline(input);
}

// ── Invoices and payments ───────────────────────────────────────────────────────────────────

const invoicePipeline = createAction({
  name: "crm.invoice.record",
  input: z.object({
    itemIds: z.preprocess((value) => (value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(z.uuid()).min(1).max(100)),
    number: z.string().trim().min(1).max(60),
    issuedOn: isoDate,
    vatRateBp: z.coerce.number().int().min(0).max(10_000),
    amounts: z.record(z.string(), vnd).default({}),
    note: text(1000),
  }),
  authorize: async (user, input) => {
    const items = await billingItemsByIds(input.itemIds);
    const { viewer } = await loadCrm(user);
    return items.length > 0 && items.every((item) => canRecordInvoices(viewer, item.entityId));
  },
  run: async ({ user, input }) => {
    const amounts = Object.fromEntries(Object.entries(input.amounts).flatMap(([id, value]) => (value === null ? [] : [[id, value]])));
    const invoice = await recordInvoice({ itemIds: input.itemIds, number: input.number, issuedOn: input.issuedOn, vatRateBp: input.vatRateBp, amounts, note: input.note }, user.person.id);
    revalidatePath("/crm/invoices");
    revalidatePath("/projects/billing");
    revalidatePath(`/crm/accounts/${invoice.clientId}`);
    return { data: { id: invoice.id }, audit: { resource: { type: "crm_invoice", id: invoice.id, entityId: invoice.entityId }, summary: invoice.number, after: invoice } };
  },
});
export async function recordInvoiceAction(input: unknown) {
  return invoicePipeline(input);
}

async function mayInvoice(user: CurrentUser, invoiceId: string): Promise<boolean> {
  const invoice = await findInvoice(invoiceId);
  return !!invoice && canRecordInvoices((await loadCrm(user)).viewer, invoice.entityId);
}

const paymentPipeline = createAction({
  name: "crm.invoice.payment",
  input: z.object({ invoiceId: z.uuid(), receivedOn: isoDate, amountVnd: vnd.refine((value) => value !== null && value > 0), method: z.enum(PAYMENT_METHODS), reference: text(120), note: text(500) }),
  authorize: (user, input) => mayInvoice(user, input.invoiceId),
  run: async ({ user, input }) => {
    const { payment, invoice } = await recordPayment(input.invoiceId, { receivedOn: input.receivedOn, amountVnd: input.amountVnd!, method: input.method, reference: input.reference, note: input.note }, user.person.id);
    revalidatePath(`/crm/invoices/${invoice.id}`);
    revalidatePath("/crm/invoices");
    return { data: { id: payment.id, status: invoice.status }, audit: { resource: { type: "crm_invoice", id: invoice.id, entityId: invoice.entityId }, summary: `payment ${payment.amountVnd}`, after: payment } };
  },
});
export async function recordPaymentAction(input: unknown) {
  return paymentPipeline(input);
}

const removePaymentPipeline = createAction({
  name: "crm.invoice.payment_remove",
  input: z.object({ invoiceId: z.uuid(), paymentId: z.uuid() }),
  authorize: async (user, input) => {
    const [row] = await db().select({ invoiceId: schema.crmPayment.invoiceId }).from(schema.crmPayment).where(eq(schema.crmPayment.id, input.paymentId)).limit(1);
    return row?.invoiceId === input.invoiceId && mayInvoice(user, input.invoiceId);
  },
  run: async ({ input }) => {
    const { payment, invoice } = await removePayment(input.paymentId);
    revalidatePath(`/crm/invoices/${invoice.id}`);
    revalidatePath("/crm/invoices");
    return { data: { status: invoice.status }, audit: { resource: { type: "crm_invoice", id: invoice.id, entityId: invoice.entityId }, before: payment } };
  },
});
export async function removePaymentAction(input: unknown) {
  return removePaymentPipeline(input);
}

const writeOffPipeline = createAction({
  name: "crm.invoice.write_off",
  input: z.object({ invoiceId: z.uuid(), reason: z.string().trim().min(1).max(1000) }),
  authorize: (user, input) => mayInvoice(user, input.invoiceId),
  run: async ({ input }) => {
    const { before, after } = await writeOffInvoice(input.invoiceId, input.reason);
    revalidatePath(`/crm/invoices/${after.id}`);
    revalidatePath("/crm/invoices");
    return { data: { status: after.status }, audit: { resource: { type: "crm_invoice", id: after.id, entityId: after.entityId }, before: { status: before.status }, after: { status: after.status, reason: after.writtenOffReason } } };
  },
});
export async function writeOffInvoiceAction(input: unknown) {
  return writeOffPipeline(input);
}
