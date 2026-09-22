"use server";
// The commercial side of delivery (FR-PJM-06, 11, 55, 56, 58, 59): retainers, change requests,
// acceptance, the billing queue, client reports and the close-out. Each action re-checks the
// project against the viewer — including whether it is closed — and money is written only by a
// holder of `pjm:commercial` over the project's entity: for anyone else a fee field is ignored,
// never trusted from the browser.
import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "../platform/auth/session";
import { getRequest } from "../platform/approvals/service";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "../platform/files/service";
import { kbViewerOf } from "../kb/service";
import { CHANNELS, CONTENT_FORMATS } from "../work/enums";
import type { WorkViewer } from "../work/policy";
import { invalidateWorkDirectory } from "../work/service";
import { createAcceptance, findAcceptance, refreshAcceptance, sendAcceptance, signAcceptance, voidAcceptance } from "./acceptance";
import { billingItemForAcceptance, createManualBillingItem, decideBillingItem, findBillingItem, projectByJobNumber } from "./billing";
import { changeRequestType, changeWithEvidence, decideChange, findChange, saveChange, submitChange, withdrawChange } from "./change-requests";
import { findClientReport, saveClientReport } from "./client-reports";
import { closeProject, publishLessons, saveRetro } from "./close";
import { ACCEPTANCE_SCOPES } from "./engine/acceptance";
import { CHANGE_REQUESTERS } from "./engine/change-request";
import { RETAINER_ROLLOVERS } from "./engine/retainer";
import { checkbox, hours, hoursDelta, idList, isoDate, month, optional, rows, text, vnd, vndDelta } from "./form-inputs";
import { canCloseProject, canDecideBilling, canEditFees, canHoldRetro, canManageAcceptance, canManageChanges, canEditRetainer, canViewPlan, canWriteClientReport, type PlanFacts } from "./policy";
import { ensureCurrentPeriods, getRetainer, saveRetainer } from "./retainers";
import { planProjectFor } from "./views";

const may = async (user: CurrentUser, projectId: string | null, rule: (viewer: WorkViewer, facts: PlanFacts) => boolean) => {
  const found = await planProjectFor(user, projectId);
  return !!found && rule(found.viewer, found.facts);
};
const auditProject = (projectId: string, entityId: string | null = null) => ({ type: "work_project", id: projectId, entityId });

function refresh(projectId: string) {
  for (const tab of ["", "/plan", "/deliverables", "/budget", "/retainer", "/changes", "/acceptance", "/reports", "/close"]) revalidatePath(`/projects/${projectId}${tab}`);
  revalidatePath(`/work/projects/${projectId}`);
  revalidatePath("/projects");
  revalidatePath("/projects/billing");
}

const FILE_TIER = "personal" as const;
const CHANGE_EVIDENCE = "project_change";
const SIGNED_SCAN = "project_acceptance";

/** Only the pending upload this person started a moment ago, for this owner. */
async function ownPendingUpload(user: CurrentUser, fileId: string, ownerType: string): Promise<boolean> {
  const [row] = await db()
    .select({ id: schema.storedFile.id })
    .from(schema.storedFile)
    .where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.ownerType, ownerType), eq(schema.storedFile.uploadedByPersonId, user.person.id), eq(schema.storedFile.status, "pending")))
    .limit(1);
  return !!row;
}

const line = z.object({ title: z.string().trim().min(1).max(200), quantity: z.coerce.number().int().min(1).max(1000), format: optional(z.enum(CONTENT_FORMATS)), channel: optional(z.enum(CHANNELS)) });

// ── Retainers (FR-PJM-06) ───────────────────────────────────────────────────────────────────

const retainerPipeline = createAction({
  name: "projects.retainer.save",
  input: z.object({
    projectId: z.uuid(),
    startMonth: month,
    endMonth: optional(month),
    lines: rows(line, 30).default([]),
    hoursPerMonth: hours,
    feePerMonthVnd: vnd.optional(),
    rollover: z.enum(RETAINER_ROLLOVERS),
    isActive: checkbox.default(false),
  }),
  authorize: (user, input) => may(user, input.projectId, canEditRetainer),
  run: async ({ user, input }) => {
    const found = (await planProjectFor(user, input.projectId))!;
    const editsFees = canEditFees(found.viewer, found.facts);
    // The fee is written only by someone who may read it; for anyone else it stays as it was.
    const fee = editsFees && input.feePerMonthVnd !== undefined ? { feePerMonthVnd: input.feePerMonthVnd } : {};
    // The months and the switch are money too: they decide how many months are billed, and for how
    // long. Only a `pjm:commercial` holder moves them — the account manager keeps the scope lines.
    const stored = await getRetainer(input.projectId);
    const months = editsFees ? { startMonth: input.startMonth, endMonth: input.endMonth, isActive: input.isActive } : stored ? { startMonth: stored.startMonth, endMonth: stored.endMonth, isActive: stored.isActive } : null;
    if (!months) throw new ActionError("retainer_terms_need_commercial");
    if (!editsFees && (input.startMonth !== months.startMonth || input.endMonth !== months.endMonth || input.isActive !== months.isActive)) throw new ActionError("retainer_terms_need_commercial");
    const { before, after } = await saveRetainer(input.projectId, { ...months, lines: input.lines.map((row) => ({ title: row.title, quantity: row.quantity, format: row.format, channel: row.channel })), minutesPerMonth: input.hoursPerMonth, rollover: input.rollover, ...fee });
    // This month is made now rather than at midnight: the account manager sees it at once.
    const made = after.isActive ? await ensureCurrentPeriods(after.id) : { periods: 0, closed: 0, billed: 0 };
    refresh(input.projectId);
    const shape = (row: typeof after | null) => (row ? { startMonth: row.startMonth, endMonth: row.endMonth, lines: row.lines, minutesPerMonth: row.minutesPerMonth, rollover: row.rollover, isActive: row.isActive } : null);
    return { data: { id: after.id, periods: made.periods }, audit: { resource: auditProject(input.projectId, found.project.entityId), summary: `retainer ${after.startMonth}–${after.endMonth ?? "…"}`, before: shape(before), after: { ...shape(after), feeChanged: "feePerMonthVnd" in fee } } };
  },
});
export async function saveRetainerAction(input: unknown) {
  return retainerPipeline(input);
}

// ── Change requests (FR-PJM-11) ─────────────────────────────────────────────────────────────

const changeProject = async (changeId: string) => (await findChange(changeId))?.projectId ?? null;

const saveChangePipeline = createAction({
  name: "projects.change.save",
  input: z.object({
    projectId: z.uuid(),
    changeId: optional(z.uuid()),
    title: z.string().trim().min(1).max(200),
    description: text(4000),
    requestedBy: z.enum(CHANGE_REQUESTERS),
    lines: rows(line, 30).default([]),
    cancelIds: idList.default([]),
    hoursDelta,
    feeDeltaVnd: vndDelta.optional(),
    dueDateTo: optional(isoDate),
    evidenceFileId: optional(z.uuid()),
    evidenceUrl: optional(z.url().max(500)),
  }),
  authorize: (user, input) => may(user, input.projectId, canManageChanges),
  run: async ({ user, input }) => {
    const found = (await planProjectFor(user, input.projectId))!;
    const withFee = canEditFees(found.viewer, found.facts);
    if (input.evidenceFileId) {
      const file = await findFile(input.evidenceFileId);
      if (!file || file.ownerType !== CHANGE_EVIDENCE || file.ownerId !== input.projectId) throw new ActionError("file_not_found");
    }
    const impact = {
      ...(input.lines.length ? { deliverables: input.lines.map((row) => ({ title: row.title, quantity: row.quantity, format: row.format, channel: row.channel })) } : {}),
      ...(input.cancelIds.length ? { cancelDeliverableIds: input.cancelIds } : {}),
      ...(input.hoursDelta ? { minutesDelta: input.hoursDelta } : {}),
      ...(withFee && input.feeDeltaVnd ? { feeDeltaVnd: input.feeDeltaVnd } : {}),
      ...(input.dueDateTo ? { dueDateTo: input.dueDateTo } : {}),
    };
    const { before, after } = await saveChange(input.projectId, input.changeId, { title: input.title, description: input.description, requestedBy: input.requestedBy, impact, evidenceFileId: input.evidenceFileId, evidenceUrl: input.evidenceUrl }, user.person.id, { withFee });
    refresh(input.projectId);
    // The fee delta is money: the log says that it changed, never how much, like the fee itself.
    const shape = (row: typeof after | null) => (row ? { title: row.title, requestedBy: row.requestedBy, status: row.status, minutesDelta: row.impact.minutesDelta ?? null, dueDateTo: row.impact.dueDateTo ?? null, lines: row.impact.deliverables?.length ?? 0, cancelled: row.impact.cancelDeliverableIds?.length ?? 0, feeChange: !!row.impact.feeDeltaVnd } : null);
    return { data: { id: after.id, number: after.number }, audit: { resource: auditProject(input.projectId, found.project.entityId), summary: `CR-${after.number}: ${after.title}`.slice(0, 300), before: shape(before), after: shape(after) } };
  },
});
export async function saveChangeAction(input: unknown) {
  return saveChangePipeline(input);
}

const submitChangePipeline = createAction({
  name: "projects.change.submit",
  input: z.object({ changeId: z.uuid() }),
  authorize: async (user, input) => may(user, await changeProject(input.changeId), canManageChanges),
  run: async ({ user, input }) => {
    const { change, requestId, resubmitted } = await submitChange(input.changeId, user.person.id);
    refresh(change.projectId);
    revalidatePath("/approvals");
    return { data: { requestId, status: change.status }, audit: { resource: auditProject(change.projectId), summary: `CR-${change.number} ${resubmitted ? "resubmitted" : "submitted"}`, after: { requestId, status: change.status } } };
  },
});
export async function submitChangeAction(input: unknown) {
  return submitChangePipeline(input);
}

const withdrawChangePipeline = createAction({
  name: "projects.change.withdraw",
  input: z.object({ changeId: z.uuid() }),
  authorize: async (user, input) => may(user, await changeProject(input.changeId), canManageChanges),
  run: async ({ user, input }) => {
    const { before, after } = await withdrawChange(input.changeId, user.person.id);
    refresh(after.projectId);
    revalidatePath("/approvals");
    return { data: { status: after.status }, audit: { resource: auditProject(after.projectId), summary: `CR-${after.number} withdrawn`, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function withdrawChangeAction(input: unknown) {
  return withdrawChangePipeline(input);
}

const decideChangePipeline = createAction({
  name: "projects.change.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  // Whose turn it is comes from the flow: the project's leads, the commercial step, else the owners.
  authorize: async (user, input) => !!(await getRequest({ personId: user.person.id, principal: user.principal }, changeRequestType, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { change, outcome, entityId, before } = await decideChange(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    // An applied change may have moved the project's due date: the work directory holds it.
    if (outcome === "approved") await invalidateWorkDirectory();
    refresh(change.projectId);
    revalidatePath("/approvals");
    return { data: { outcome }, audit: { resource: auditProject(change.projectId, entityId), summary: `CR-${change.number} ${input.decision}`, before, after: { outcome, status: change.status, applied: change.impact.applied ? { budgetMinutesBefore: change.impact.applied.budgetMinutesBefore, dueDateBefore: change.impact.applied.dueDateBefore } : null } } };
  },
});
export async function decideChangeAction(input: unknown) {
  return decideChangePipeline(input);
}

const beginEvidencePipeline = createAction({
  name: "projects.change.evidence.begin",
  input: z.object({ projectId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => may(user, input.projectId, canManageChanges),
  run: async ({ user, input }) => {
    const found = (await planProjectFor(user, input.projectId))!;
    // Uploaded before the change is saved (the author is still filling it in): owned by the project.
    const upload = await beginUpload({ ownerType: CHANGE_EVIDENCE, ownerId: input.projectId, entityId: found.project.entityId, tier: FILE_TIER }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: found.project.entityId }, summary: input.fileName } };
  },
});
export async function beginChangeEvidenceAction(input: unknown) {
  return beginEvidencePipeline(input);
}

const completeEvidencePipeline = createAction({
  name: "projects.change.evidence.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: (user, input) => ownPendingUpload(user, input.fileId, CHANGE_EVIDENCE),
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function completeChangeEvidenceAction(input: unknown) {
  return completeEvidencePipeline(input);
}

const openEvidencePipeline = createAction({
  name: "projects.change.evidence.open",
  input: z.object({ projectId: z.uuid(), fileId: z.uuid() }),
  // The file opens for whoever may read the project's plan — and only as the evidence of one of its changes.
  authorize: async (user, input) => (await may(user, input.projectId, canViewPlan)) && !!(await changeWithEvidence(input.projectId, input.fileId)),
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file || file.ownerType !== CHANGE_EVIDENCE) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function openChangeEvidenceAction(input: unknown) {
  return openEvidencePipeline(input);
}

// ── Acceptance (FR-PJM-55) ──────────────────────────────────────────────────────────────────

const acceptanceProject = async (acceptanceId: string) => (await findAcceptance(acceptanceId))?.projectId ?? null;

const createAcceptancePipeline = createAction({
  name: "projects.acceptance.create",
  input: z.object({ projectId: z.uuid(), scope: z.enum(ACCEPTANCE_SCOPES), milestoneId: optional(z.uuid()), retainerPeriodId: optional(z.uuid()) }),
  authorize: (user, input) => may(user, input.projectId, canManageAcceptance),
  run: async ({ user, input }) => {
    const row = await createAcceptance(input.projectId, { scope: input.scope, milestoneId: input.milestoneId, retainerPeriodId: input.retainerPeriodId }, user.person.id);
    refresh(input.projectId);
    return { data: { id: row.id, number: row.number }, audit: { resource: auditProject(input.projectId), summary: `acceptance ${row.number}: ${row.scope}`, after: { id: row.id, scope: row.scope, milestoneId: row.milestoneId, retainerPeriodId: row.retainerPeriodId, items: row.items.length } } };
  },
});
export async function createAcceptanceAction(input: unknown) {
  return createAcceptancePipeline(input);
}

const acceptanceStep = (name: string, step: (acceptanceId: string) => Promise<{ before: { status: string }; after: { projectId: string; number: number; status: string } }>) =>
  createAction({
    name,
    input: z.object({ acceptanceId: z.uuid() }),
    authorize: async (user, input) => may(user, await acceptanceProject(input.acceptanceId), canManageAcceptance),
    run: async ({ input }) => {
      const { before, after } = await step(input.acceptanceId);
      refresh(after.projectId);
      return { data: { status: after.status }, audit: { resource: auditProject(after.projectId), summary: `acceptance ${after.number}: ${before.status} → ${after.status}`, before: { status: before.status }, after: { status: after.status } } };
    },
  });
const sendPipeline = acceptanceStep("projects.acceptance.send", sendAcceptance);
const voidPipeline = acceptanceStep("projects.acceptance.void", voidAcceptance);
const refreshPipeline = acceptanceStep("projects.acceptance.refresh", refreshAcceptance);
export async function sendAcceptanceAction(input: unknown) {
  return sendPipeline(input);
}
export async function voidAcceptanceAction(input: unknown) {
  return voidPipeline(input);
}
export async function refreshAcceptanceAction(input: unknown) {
  return refreshPipeline(input);
}

const signPipeline = createAction({
  name: "projects.acceptance.sign",
  input: z.object({ acceptanceId: z.uuid(), signedFileId: z.uuid(), signedOn: isoDate, signedByClient: z.string().trim().min(1).max(200) }),
  authorize: async (user, input) => may(user, await acceptanceProject(input.acceptanceId), canManageAcceptance),
  run: async ({ user, input }) => {
    // The scan must be the one uploaded for this record.
    const file = await findFile(input.signedFileId);
    if (!file || file.ownerType !== SIGNED_SCAN || file.ownerId !== input.acceptanceId) throw new ActionError("file_not_found");
    const { before, after, billingItemId } = await signAcceptance(input.acceptanceId, { signedFileId: input.signedFileId, signedOn: input.signedOn, signedByClient: input.signedByClient }, user.person.id);
    refresh(after.projectId);
    return { data: { status: after.status, billingItemId }, audit: { resource: auditProject(after.projectId), summary: `acceptance ${after.number} signed ${after.signedOn}`, before: { status: before.status }, after: { status: after.status, signedOn: after.signedOn, signedByClient: after.signedByClient, signedFileId: after.signedFileId, billingItemId } } };
  },
});
export async function signAcceptanceAction(input: unknown) {
  return signPipeline(input);
}

const beginScanPipeline = createAction({
  name: "projects.acceptance.scan.begin",
  input: z.object({ acceptanceId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => may(user, await acceptanceProject(input.acceptanceId), canManageAcceptance),
  run: async ({ user, input }) => {
    const acceptance = (await findAcceptance(input.acceptanceId))!;
    const found = (await planProjectFor(user, acceptance.projectId))!;
    const upload = await beginUpload({ ownerType: SIGNED_SCAN, ownerId: acceptance.id, entityId: found.project.entityId, tier: FILE_TIER }, { fileName: input.fileName, sizeBytes: input.sizeBytes }, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: found.project.entityId }, summary: input.fileName } };
  },
});
export async function beginSignedScanAction(input: unknown) {
  return beginScanPipeline(input);
}

const completeScanPipeline = createAction({
  name: "projects.acceptance.scan.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: (user, input) => ownPendingUpload(user, input.fileId, SIGNED_SCAN),
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function completeSignedScanAction(input: unknown) {
  return completeScanPipeline(input);
}

const openScanPipeline = createAction({
  name: "projects.acceptance.scan.open",
  input: z.object({ acceptanceId: z.uuid() }),
  // The project's people, or finance through the billing item the signed acceptance raised.
  authorize: async (user, input) => (await may(user, await acceptanceProject(input.acceptanceId), canViewPlan)) || !!(await billingItemForAcceptance(user.principal, input.acceptanceId)),
  run: async ({ user, input }) => {
    const acceptance = await findAcceptance(input.acceptanceId);
    const file = acceptance?.signedFileId ? await findFile(acceptance.signedFileId) : undefined;
    if (!file) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});
export async function openSignedScanAction(input: unknown) {
  return openScanPipeline(input);
}

// ── The billing queue (FR-PJM-56) ───────────────────────────────────────────────────────────

const decideBillingPipeline = createAction({
  name: "projects.billing.decide",
  input: z.discriminatedUnion("action", [
    z.object({ itemId: z.uuid(), action: z.literal("invoice"), invoiceNumber: z.string().trim().min(1).max(60), invoiceDate: isoDate, amountVnd: vnd }),
    z.object({ itemId: z.uuid(), action: z.literal("waive"), reason: z.string().trim().min(1).max(1000) }),
  ]),
  authorize: async (user, input) => {
    const item = await findBillingItem(input.itemId);
    return !!item && canDecideBilling(user.principal, item);
  },
  run: async ({ user, input }) => {
    const decision = input.action === "invoice" ? { action: "invoice" as const, invoiceNumber: input.invoiceNumber, invoiceDate: input.invoiceDate, amountVnd: input.amountVnd } : { action: "waive" as const, reason: input.reason };
    const { before, after } = await decideBillingItem(input.itemId, decision, user.person.id);
    refresh(after.projectId);
    return { data: { status: after.status }, audit: { resource: { type: "project_billing_item", id: after.id, entityId: after.entityId }, summary: `${after.jobNumber ?? ""} ${after.status}${after.invoiceNumber ? ` ${after.invoiceNumber}` : ""}`.trim(), before: { status: before.status }, after: { status: after.status, invoiceNumber: after.invoiceNumber, invoiceDate: after.invoiceDate, waivedReason: after.waivedReason } } };
  },
});
export async function decideBillingAction(input: unknown) {
  return decideBillingPipeline(input);
}

async function projectOfManualItem(input: { projectId: string | null; jobNumber: string | null }): Promise<string | null> {
  return input.projectId ?? (input.jobNumber ? await projectByJobNumber(input.jobNumber) : null);
}

const manualBillingPipeline = createAction({
  name: "projects.billing.manual",
  input: z.object({ projectId: optional(z.uuid()), jobNumber: text(40), description: z.string().trim().min(1).max(300), reference: text(120), amountVnd: vnd }),
  // Finance adds items for projects it cannot open: what counts is `pjm:commercial` over the project's entity.
  authorize: async (user, input) => {
    const found = await planProjectFor(user, await projectOfManualItem(input));
    return !!found && canDecideBilling(user.principal, { entityId: found.project.entityId });
  },
  run: async ({ user, input }) => {
    const projectId = (await projectOfManualItem(input))!;
    const item = await createManualBillingItem(projectId, { description: input.description, reference: input.reference, amountVnd: input.amountVnd }, user.person.id);
    refresh(projectId);
    return { data: { id: item.id }, audit: { resource: { type: "project_billing_item", id: item.id, entityId: item.entityId }, summary: `${item.jobNumber ?? ""} manual: ${item.description}`.slice(0, 300), after: { projectId, description: item.description, reference: item.reference, amountSet: item.amountVnd !== null } } };
  },
});
export async function createManualBillingAction(input: unknown) {
  return manualBillingPipeline(input);
}

// ── Client reports (FR-PJM-58) ──────────────────────────────────────────────────────────────

const reportPipeline = createAction({
  name: "projects.client_report.save",
  input: z.object({ projectId: z.uuid(), reportId: optional(z.uuid()), title: z.string().trim().min(1).max(200), periodFrom: isoDate, periodTo: isoDate, summary: text(8000), nextPlan: text(8000), showHours: checkbox.default(false) }),
  authorize: async (user, input) => {
    if (input.reportId && (await findClientReport(input.reportId))?.projectId !== input.projectId) return false;
    return may(user, input.projectId, canWriteClientReport);
  },
  run: async ({ user, input }) => {
    const { projectId, reportId, ...values } = input;
    const { before, after } = await saveClientReport(projectId, reportId, values, user.person.id);
    refresh(projectId);
    const shape = (row: typeof after | null) => (row ? { title: row.title, periodFrom: row.periodFrom, periodTo: row.periodTo, showHours: row.showHours } : null);
    return { data: { id: after.id }, audit: { resource: auditProject(projectId), summary: `client report ${after.periodFrom}–${after.periodTo}`, before: shape(before), after: shape(after) } };
  },
});
export async function saveClientReportAction(input: unknown) {
  return reportPipeline(input);
}

// ── Close-out (FR-PJM-59) ───────────────────────────────────────────────────────────────────

const retroPipeline = createAction({
  name: "projects.retro.save",
  input: z.object({ projectId: z.uuid(), heldOn: isoDate, attendeeIds: idList.default([]), wentWell: text(8000), improve: text(8000), actions: text(8000) }),
  authorize: (user, input) => may(user, input.projectId, canHoldRetro),
  run: async ({ user, input }) => {
    const retro = Object.fromEntries(Object.entries({ wentWell: input.wentWell, improve: input.improve, actions: input.actions }).filter(([, value]) => value !== null)) as Record<string, string>;
    const { before, after } = await saveRetro(input.projectId, { heldOn: input.heldOn, attendeeIds: input.attendeeIds, retro }, user.person.id);
    refresh(input.projectId);
    return { data: { id: after.id }, audit: { resource: auditProject(input.projectId), summary: `retrospective ${after.heldOn}`, before: before ? { heldOn: before.heldOn } : null, after: { heldOn: after.heldOn, parts: Object.keys(retro) } } };
  },
});
export async function saveRetroAction(input: unknown) {
  return retroPipeline(input);
}

const closePipeline = createAction({
  name: "projects.close",
  input: z.object({ projectId: z.uuid(), overrideReason: text(2000) }),
  authorize: (user, input) => may(user, input.projectId, canCloseProject),
  run: async ({ user, input }) => {
    const { plan, report, projectStatusBefore } = await closeProject(input.projectId, { overrideReason: input.overrideReason }, user.person.id);
    // The project is "done" now: the work directory holds its status.
    await invalidateWorkDirectory();
    refresh(input.projectId);
    // An override is the point of this record: what was unmet and why the lead closed anyway.
    return { data: { closedAt: plan.closedAt }, audit: { resource: auditProject(input.projectId), summary: report.unmet.length ? `closed with ${report.unmet.join(", ")} unmet: ${report.overrideReason}`.slice(0, 300) : "closed", before: { status: projectStatusBefore }, after: { status: "done", unmet: report.unmet, overrideReason: report.overrideReason } } };
  },
});
export async function closeProjectAction(input: unknown) {
  return closePipeline(input);
}

const lessonsPipeline = createAction({
  name: "projects.retro.publish_lessons",
  input: z.object({ projectId: z.uuid(), spaceId: z.uuid() }),
  // Holding the retro is one right; writing in the space is the knowledge base's to decide, inside.
  authorize: (user, input) => may(user, input.projectId, canHoldRetro),
  run: async ({ user, input }) => {
    const found = (await planProjectFor(user, input.projectId))!;
    const t = await getTranslations("projects.close");
    const title = t("lessonsTitle", { project: found.project.name });
    const { pageId, spaceKey } = await publishLessons(kbViewerOf(user), input.projectId, input.spaceId, title, { wentWell: t("retro.wentWell"), improve: t("retro.improve"), actions: t("retro.actions") });
    revalidatePath("/kb");
    return { data: { pageId, spaceKey }, audit: { resource: { type: "kb_page", id: pageId }, summary: `lessons of ${input.projectId}`, after: { projectId: input.projectId, spaceId: input.spaceId } } };
  },
});
export async function publishLessonsAction(input: unknown) {
  return lessonsPipeline(input);
}
