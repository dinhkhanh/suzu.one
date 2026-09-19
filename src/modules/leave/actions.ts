"use server";
// Leave: the employee's own requests, the approver's decision, HR's configuration and postings.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "@/modules/platform/files/service";
import { can } from "@/modules/platform/rbac/policy";
import { ACCRUAL_METHODS, BASE_SOURCES, LEAVE_CATEGORIES, PAYROLL_TREATMENTS, PORTIONS, PROBATION_RULES, ROUNDINGS, WORKFORCE_TYPES } from "./enums";
import { openingBalanceImport } from "./import";
import { adjustBalance, runLeaveAccruals } from "./ledger";
import { canFileLeaveFor, canManageLeaveConfig, canManageLeaveOf } from "./policy";
import { amendLeave, cancelLeave, decideLeave, findLeaveRequest, getLeaveRequestView, submitLeave } from "./requests";
import { deleteStaffingRule, getLeaveType, getStaffingRule, saveLeavePolicy, saveLeaveType, saveStaffingRule } from "./types";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const text = (max: number) => optional(z.string().trim().max(max));
const day = z.iso.date();
const wholeNumber = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value), z.number().int().min(min).max(max));
// "1", "1.5", "1,5", "-2" → hundredths of a day.
const daysCenti = (min: number, max: number) =>
  z.preprocess((value) => {
    if (typeof value === "number") return Math.round(value * 100);
    const match = typeof value === "string" ? /^(-?)(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(value.trim()) : null;
    if (!match) return value === "" ? undefined : Number.NaN;
    const centi = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
    return match[1] ? -centi : centi;
  }, z.number().int().min(min).max(max));

const refresh = () => {
  revalidatePath("/leave", "layout");
  revalidatePath("/approvals");
};

// ── Requests ────────────────────────────────────────────────────────────────────────────────

const portion = z.enum(PORTIONS);
const leaveFields = {
  leaveTypeId: z.uuid(),
  startDate: day,
  endDate: day,
  startPortion: portion.default("full"),
  endPortion: portion.default("full"),
  minutes: optional(wholeNumber(15, 1440)),
  reason: text(1000),
  attachmentFileId: optional(z.uuid()),
};

const isHrFor = async (user: { principal: Parameters<typeof can>[0] }, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && canManageLeaveOf(user.principal, target);
};

const submitPipeline = createAction({
  name: "leave.request.submit",
  // Without `personId` the request is the signed-in person's own; HR may file for the people they look after.
  input: z.object({ personId: optional(z.uuid()), ...leaveFields }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId ?? user.person.id);
    return !!target && canFileLeaveFor(user.principal, target);
  },
  run: async ({ user, input }) => {
    const { personId, ...leave } = input;
    const subjectId = personId ?? user.person.id;
    const filed = await submitLeave(subjectId, leave, { personId: user.person.id, isHr: await isHrFor(user, subjectId) });
    refresh();
    return { data: { id: filed.leaveRequest.id, approvalRequestId: filed.approvalRequestId, outcome: filed.outcome, conflicts: filed.conflicts }, audit: { resource: { type: "leave_request", id: filed.leaveRequest.id, entityId: filed.leaveRequest.entityId }, summary: `${leave.startDate} – ${leave.endDate}, ${filed.leaveRequest.totalCenti / 100} day(s)`, after: { personId: subjectId, leaveTypeId: leave.leaveTypeId, startDate: leave.startDate, endDate: leave.endDate, totalCenti: filed.leaveRequest.totalCenti, approvalRequestId: filed.approvalRequestId } } };
  },
});
export async function submitLeaveAction(input: unknown) {
  return submitPipeline(input);
}

// The person's own request (or one they filed), or HR's for the people they look after. The
// service decides what may still be done with it (started leave is HR's to cancel).
const ownOrHr = async (user: { person: { id: string }; principal: Parameters<typeof can>[0] }, leaveRequestId: string) => {
  const request = await findLeaveRequest(leaveRequestId);
  if (!request) return false;
  return request.personId === user.person.id || request.filedByPersonId === user.person.id || isHrFor(user, request.personId);
};

const amendPipeline = createAction({
  name: "leave.request.amend",
  input: z.object({ leaveRequestId: z.uuid(), ...leaveFields }),
  authorize: (user, input) => ownOrHr(user, input.leaveRequestId),
  run: async ({ user, input }) => {
    const { leaveRequestId, ...leave } = input;
    const current = await findLeaveRequest(leaveRequestId);
    const result = await amendLeave(leaveRequestId, leave, { personId: user.person.id, isHr: await isHrFor(user, current!.personId) });
    refresh();
    return { data: { id: result.leaveRequest.id, approvalRequestId: result.approvalRequestId, conflicts: result.conflicts }, audit: { resource: { type: "leave_request", id: result.leaveRequest.id, entityId: result.leaveRequest.entityId }, summary: `amends ${leaveRequestId}: ${leave.startDate} – ${leave.endDate}`, before: { id: result.before.id, startDate: result.before.startDate, endDate: result.before.endDate, status: result.before.status }, after: { startDate: leave.startDate, endDate: leave.endDate, totalCenti: result.leaveRequest.totalCenti } } };
  },
});
export async function amendLeaveAction(input: unknown) {
  return amendPipeline(input);
}

const cancelPipeline = createAction({
  name: "leave.request.cancel",
  input: z.object({ leaveRequestId: z.uuid(), reason: text(500) }),
  authorize: (user, input) => ownOrHr(user, input.leaveRequestId),
  run: async ({ user, input }) => {
    const current = await findLeaveRequest(input.leaveRequestId);
    const { before, after } = await cancelLeave(input.leaveRequestId, { personId: user.person.id, isHr: await isHrFor(user, current!.personId) }, input.reason);
    refresh();
    if (after.approvalRequestId) revalidatePath(`/approvals/leave/${after.approvalRequestId}`);
    return { data: { status: after.status }, audit: { resource: { type: "leave_request", id: after.id, entityId: after.entityId }, summary: `${before.status} → ${after.status}: ${after.startDate} – ${after.endDate}`, before: { status: before.status }, after: { status: after.status, reason: input.reason } } };
  },
});
export async function cancelLeaveAction(input: unknown) {
  return cancelPipeline(input);
}

const decidePipeline = createAction({
  name: "leave.request.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  // Being asked by the flow is the whole authority: the engine put the line manager (or whoever the entity's flow names) there.
  authorize: async (user, input) => !!(await getLeaveRequestView({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome, leaveRequest } = await decideLeave(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    refresh();
    revalidatePath(`/approvals/leave/${request.id}`);
    return { data: { outcome }, audit: { resource: { type: "leave_request", id: leaveRequest.id, entityId: request.entityId }, summary: `${input.decision}: ${request.summary}`, before: { status: before.status }, after: { status: request.status, leaveStatus: leaveRequest.status, requestId: request.id } } };
  },
});
export async function decideLeaveAction(input: unknown) {
  return decidePipeline(input);
}

// ── Attachments (a doctor's note, a wedding invitation) ─────────────────────────────────────

const beginAttachmentPipeline = createAction({
  name: "leave.attachment.begin",
  input: z.object({ personId: optional(z.uuid()), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId ?? user.person.id);
    return !!target && canFileLeaveFor(user.principal, target);
  },
  run: async ({ user, input }) => {
    const personId = input.personId ?? user.person.id;
    const target = await getPersonTarget(personId);
    // Owned by the person until a request points at it; personal tier, like the reason for the leave.
    const upload = await beginUpload({ ownerType: "leave_attachment", ownerId: personId, entityId: target?.entityId ?? null, tier: "personal" }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "file", id: upload.fileId, entityId: target?.entityId ?? null }, summary: `leave attachment: ${input.fileName}` } };
  },
});
export async function beginLeaveAttachmentAction(input: unknown) {
  return beginAttachmentPipeline(input);
}

const attachmentOwner = async (user: { person: { id: string }; principal: Parameters<typeof can>[0] }, fileId: string) => {
  const file = await findFile(fileId);
  if (!file || file.ownerType !== "leave_attachment") return false;
  const target = await getPersonTarget(file.ownerId);
  return !!target && canFileLeaveFor(user.principal, target);
};

const completeAttachmentPipeline = createAction({
  name: "leave.attachment.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: (user, input) => attachmentOwner(user, input.fileId),
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "file", id: file.id, entityId: file.entityId }, summary: `leave attachment stored: ${file.fileName}` } };
  },
});
export async function completeLeaveAttachmentAction(input: unknown) {
  return completeAttachmentPipeline(input);
}

// Whoever may open the request may open its attachment.
const attachmentLinkPipeline = createAction({
  name: "leave.attachment.open",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => !!(await getLeaveRequestView({ personId: user.person.id, principal: user.principal }, input.requestId))?.leaveRequest.attachmentFileId,
  run: async ({ user, input }) => {
    const view = await getLeaveRequestView({ personId: user.person.id, principal: user.principal }, input.requestId);
    const file = view?.leaveRequest.attachmentFileId ? await findFile(view.leaveRequest.attachmentFileId) : undefined;
    if (!file) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "file", id: file.id, entityId: file.entityId }, summary: `leave attachment opened: ${file.fileName}` } };
  },
});
export async function leaveAttachmentLinkAction(input: unknown) {
  return attachmentLinkPipeline(input);
}

// ── HR: balances ────────────────────────────────────────────────────────────────────────────

const adjustPipeline = createAction({
  name: "leave.balance.adjust",
  input: z.object({ personId: z.uuid(), leaveTypeId: z.uuid(), year: wholeNumber(2000, 2100), days: daysCenti(-36_500, 36_500), reason: z.string().trim().min(3).max(500) }),
  authorize: (user, input) => isHrFor(user, input.personId),
  run: async ({ user, input }) => {
    const target = await getPersonTarget(input.personId);
    const { entry, balanceBefore, balanceAfter } = await adjustBalance({ personId: input.personId, leaveTypeId: input.leaveTypeId, year: input.year, amountCenti: input.days, reason: input.reason }, user.person.id);
    refresh();
    return { data: { id: entry.id, balanceCenti: balanceAfter }, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: `leave adjustment ${input.days / 100} day(s), ${input.year}: ${input.reason}`, before: { balanceCenti: balanceBefore }, after: { balanceCenti: balanceAfter, leaveTypeId: input.leaveTypeId, entryId: entry.id } } };
  },
});
export async function adjustLeaveBalanceAction(input: unknown) {
  return adjustPipeline(input);
}

// The nightly job by hand — after an import of opening balances, or a new policy. Group HR only.
const accrualPipeline = createAction({
  name: "leave.accrual.run",
  input: z.object({}),
  authorize: (user) => can(user.principal, "leave:manage", {}),
  run: async () => {
    const counts = await runLeaveAccruals(todayInVietnam());
    refresh();
    return { data: counts, audit: { resource: { type: "job", id: "leave-accrual" }, summary: JSON.stringify(counts), after: counts } };
  },
});
export async function runLeaveAccrualsAction(input: unknown) {
  return accrualPipeline(input);
}

// ── HR: configuration ───────────────────────────────────────────────────────────────────────

const typePipeline = createAction({
  name: "leave.type.save",
  input: z.object({
    id: optional(z.uuid()),
    entityId: optional(z.uuid()),
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,24}$/),
    name: z.string().trim().min(1).max(120),
    nameEn: text(120),
    category: z.enum(LEAVE_CATEGORIES),
    payrollTreatment: z.enum(PAYROLL_TREATMENTS),
    tracksBalance: checkbox,
    allowHalfDay: checkbox,
    allowHourly: checkbox,
    requiresAttachment: checkbox,
    allowBackdated: checkbox,
    noticeDays: wholeNumber(0, 365).default(0),
    maxDays: optional(daysCenti(50, 36_500)),
    eligibleWorkforceTypes: z.array(z.enum(WORKFORCE_TYPES)).default([]),
    gender: optional(z.enum(["male", "female"])),
    minSeniorityMonths: optional(wholeNumber(1, 600)),
    isLongTerm: checkbox,
    countsUntrackedDays: checkbox,
    isActive: checkbox,
    sortOrder: wholeNumber(0, 999).default(0),
  }),
  authorize: async (user, input) => {
    const existing = input.id ? await getLeaveType(input.id) : null;
    if (input.id && !existing) return false;
    return canManageLeaveConfig(user.principal, existing ? existing.entityId : input.entityId);
  },
  run: async ({ input }) => {
    const { maxDays, eligibleWorkforceTypes, ...rest } = input;
    const { before, after } = await saveLeaveType({ ...rest, isPaid: input.payrollTreatment !== "unpaid", maxDaysPerRequestCenti: maxDays, eligibleWorkforceTypes: eligibleWorkforceTypes.length ? eligibleWorkforceTypes : null });
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "leave_type", id: after.id, entityId: after.entityId }, summary: `${after.code}: ${after.name}`, before, after } };
  },
});
export async function saveLeaveTypeAction(input: unknown) {
  return typePipeline(input);
}

const policyPipeline = createAction({
  name: "leave.policy.save",
  input: z.object({
    leaveTypeId: z.uuid(),
    entityId: optional(z.uuid()),
    validFrom: day,
    accrualMethod: z.enum(ACCRUAL_METHODS),
    baseSource: z.enum(BASE_SOURCES),
    fixedDays: daysCenti(0, 36_500).default(0),
    extraDays: daysCenti(0, 36_500).default(0),
    seniorityBonus: checkbox,
    prorate: checkbox,
    rounding: z.enum(ROUNDINGS),
    probationRule: z.enum(PROBATION_RULES),
    carryOverCap: optional(daysCenti(0, 36_500)),
    carryOverExpiry: optional(z.string().trim().regex(/^\d{2}-\d{2}$/)),
    payoutOnTermination: checkbox,
    allowNegative: daysCenti(0, 36_500).default(0),
    note: text(500),
  }),
  // A policy for every entity takes a group-wide grant; an entity's own policy its HR.
  authorize: async (user, input) => !!(await getLeaveType(input.leaveTypeId)) && canManageLeaveConfig(user.principal, input.entityId),
  run: async ({ user, input }) => {
    const { fixedDays, extraDays, carryOverCap, allowNegative, ...rest } = input;
    const { before, after } = await saveLeavePolicy({ ...rest, fixedDaysCenti: fixedDays, extraDaysCenti: extraDays, carryOverCapCenti: carryOverCap, allowNegativeCenti: allowNegative }, user.person.id);
    refresh();
    return { data: { id: after.id }, audit: { resource: { type: "leave_policy", id: after.id, entityId: after.entityId }, summary: `policy from ${after.validFrom}`, before, after } };
  },
});
export async function saveLeavePolicyAction(input: unknown) {
  return policyPipeline(input);
}

const staffingPipeline = createAction({
  name: "leave.staffing_rule.save",
  input: z.object({ entityId: optional(z.uuid()), departmentId: optional(z.uuid()), teamId: optional(z.uuid()), minPresent: wholeNumber(1, 500) }),
  authorize: (user, input) => canManageLeaveConfig(user.principal, input.entityId),
  run: async ({ input }) => {
    const rule = await saveStaffingRule(input);
    refresh();
    return { data: { id: rule.id }, audit: { resource: { type: "team_staffing_rule", id: rule.id, entityId: rule.entityId }, summary: `at least ${rule.minPresent} present`, after: rule } };
  },
});
export async function saveStaffingRuleAction(input: unknown) {
  return staffingPipeline(input);
}

const deleteStaffingPipeline = createAction({
  name: "leave.staffing_rule.delete",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const rule = await getStaffingRule(input.id);
    return !!rule && canManageLeaveConfig(user.principal, rule.entityId);
  },
  run: async ({ input }) => {
    const rule = await deleteStaffingRule(input.id);
    refresh();
    return { data: { id: rule.id }, audit: { resource: { type: "team_staffing_rule", id: rule.id, entityId: rule.entityId }, summary: "removed", before: rule } };
  },
});
export async function deleteStaffingRuleAction(input: unknown) {
  return deleteStaffingPipeline(input);
}

// ── Opening balances import ─────────────────────────────────────────────────────────────────

export async function stageOpeningBalancesAction(input: unknown) {
  return openingBalanceImport.stage(input);
}
export async function commitOpeningBalancesAction(input: unknown) {
  return openingBalanceImport.commit(input);
}
