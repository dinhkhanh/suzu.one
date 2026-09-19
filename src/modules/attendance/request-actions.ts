"use server";
// Attendance requests, the monthly timesheet (confirm → approve → lock), adjustments after the
// lock and the anomaly console's actions.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { type CsvFile, EXPORT_ROW_LIMIT, toCsv } from "@/modules/platform/export/csv";
import { beginUpload, completeUpload, createDownloadLink, findFile } from "@/modules/platform/files/service";
import { notify } from "@/modules/platform/notifications/service";
import { can } from "@/modules/platform/rbac/policy";
import { ANOMALY_KINDS, listAnomalies } from "./anomalies";
import { ADJUSTMENT_FIELDS, approveMonth, confirmMonth, createAdjustment, findAdjustment, isMonth, lockPeriod, remindToConfirm, reopenMonth, voidAdjustment } from "./months";
import { canApproveMonthOf, canConfirmHoursOf, canFileAttendanceRequestFor, canLockPeriod, canManageAttendanceOf } from "./policy";
import { ATTENDANCE_REQUEST_TYPES, type AttendanceRequestInput, cancelAttendanceRequest, confirmWorkedMinutes, decideAttendanceRequest, findAttendanceRequest, findByApproval, getAttendanceRequestView, isPendingEvidence, resubmitAttendanceRequest, submitAttendanceRequest } from "./requests";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const text = (max: number) => optional(z.string().trim().max(max));
const day = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const month = z.string().refine(isMonth, "invalid_month");
const decimal = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : value), z.number().min(min).max(max));
const wholeNumber = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value), z.number().int().min(min).max(max));

const refresh = () => {
  revalidatePath("/attendance", "layout");
  revalidatePath("/approvals");
};

type ActingUser = { person: { id: string }; principal: Parameters<typeof can>[0] };
const isHrFor = async (user: ActingUser, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && canManageAttendanceOf(user.principal, target);
};

// ── Requests ────────────────────────────────────────────────────────────────────────────────

// One flat form for the four types; which fields matter depends on `type`.
const requestFields = {
  type: z.enum(ATTENDANCE_REQUEST_TYPES),
  startDate: day,
  endDate: optional(day),
  reason: z.string().trim().min(3).max(1000),
  evidenceFileId: optional(z.uuid()),
  cause: z.enum(["forgot", "device_error", "other"]).default("forgot"),
  inTime: optional(time),
  outTime: optional(time),
  outNextDay: checkbox.default(false),
  kind: z.enum(["wfh", "off_site", "business_trip"]).default("wfh"),
  portion: z.enum(["full", "am", "pm"]).default("full"),
  locationName: text(200),
  latitude: optional(decimal(-90, 90)),
  longitude: optional(decimal(-180, 180)),
  radiusM: optional(wholeNumber(50, 5000)),
  from: optional(time),
  to: optional(time),
  compensation: optional(z.enum(["pay", "time_off"])),
};
type RequestFields = z.output<z.ZodObject<typeof requestFields>>;

function toInput(fields: RequestFields): AttendanceRequestInput {
  const base = { type: fields.type, startDate: fields.startDate, endDate: fields.type === "remote_work" ? (fields.endDate ?? fields.startDate) : fields.startDate, reason: fields.reason, evidenceFileId: fields.type === "attendance_correction" ? fields.evidenceFileId : null, compensation: fields.compensation };
  if (fields.type === "attendance_correction") return { ...base, details: { type: fields.type, cause: fields.cause, inTime: fields.inTime, outTime: fields.outTime, outNextDay: fields.outNextDay && !!fields.outTime } };
  if (fields.type === "remote_work") return { ...base, details: { type: fields.type, kind: fields.kind, portion: fields.portion, locationName: fields.locationName, latitude: fields.latitude, longitude: fields.longitude, radiusM: fields.radiusM } };
  if (fields.type === "overtime") return { ...base, details: { type: fields.type, from: fields.from ?? "", to: fields.to ?? "" } };
  return { ...base, details: { type: fields.type, from: fields.from, to: fields.to } };
}

const submitPipeline = createAction({
  name: "attendance.request.submit",
  // Without `personId` the request is the signed-in person's own; HR may file for the people they keep attendance for.
  input: z.object({ personId: optional(z.uuid()), ...requestFields }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId ?? user.person.id);
    return !!target && canFileAttendanceRequestFor(user.principal, target);
  },
  run: async ({ user, input }) => {
    const { personId, ...fields } = input;
    const subjectId = personId ?? user.person.id;
    const filed = await submitAttendanceRequest(subjectId, toInput(fields), { personId: user.person.id, isHr: await isHrFor(user, subjectId) });
    refresh();
    const row = filed.attendanceRequest;
    return { data: { id: row.id, approvalRequestId: filed.approvalRequestId, outcome: filed.outcome, warnings: filed.warnings }, audit: { resource: { type: "attendance_request", id: row.id, entityId: row.entityId }, summary: `${row.type} ${row.startDate}${row.endDate !== row.startDate ? ` – ${row.endDate}` : ""}`, after: { personId: subjectId, type: row.type, startDate: row.startDate, endDate: row.endDate, details: row.details, compensation: row.compensation, approvalRequestId: filed.approvalRequestId } } };
  },
});
export async function submitAttendanceRequestAction(input: unknown) {
  return submitPipeline(input);
}

const resubmitPipeline = createAction({
  name: "attendance.request.resubmit",
  input: z.object({ requestId: z.uuid(), ...requestFields }),
  // The requester's own returned request; the engine checks the rest.
  authorize: async (user, input) => !!(await getAttendanceRequestView({ personId: user.person.id, principal: user.principal }, input.requestId))?.isRequester,
  run: async ({ user, input }) => {
    const { requestId, ...fields } = input;
    const current = await findByApproval(requestId);
    const result = await resubmitAttendanceRequest(requestId, toInput(fields), { personId: user.person.id, isHr: current ? await isHrFor(user, current.personId) : false });
    refresh();
    revalidatePath(`/approvals/attendance/${requestId}`);
    const row = result.attendanceRequest;
    return { data: { id: row.id, approvalRequestId: requestId, warnings: result.warnings }, audit: { resource: { type: "attendance_request", id: row.id, entityId: row.entityId }, summary: `resubmitted ${row.type} ${row.startDate}`, before: { startDate: result.before.startDate, endDate: result.before.endDate, details: result.before.details }, after: { startDate: row.startDate, endDate: row.endDate, details: row.details } } };
  },
});
export async function resubmitAttendanceRequestAction(input: unknown) {
  return resubmitPipeline(input);
}

const decidePipeline = createAction({
  name: "attendance.request.decide",
  input: z.object({ requestId: z.uuid(), decision: z.enum(["approve", "reject", "return"]), comment: text(1000) }),
  // Being asked by the flow is the whole authority.
  authorize: async (user, input) => !!(await getAttendanceRequestView({ personId: user.person.id, principal: user.principal }, input.requestId))?.canDecide,
  run: async ({ user, input }) => {
    const { request, before, outcome, attendanceRequest } = await decideAttendanceRequest(user.person.id, input.requestId, { action: input.decision, comment: input.comment });
    refresh();
    revalidatePath(`/approvals/attendance/${request.id}`);
    return { data: { outcome }, audit: { resource: { type: "attendance_request", id: attendanceRequest.id, entityId: request.entityId }, summary: `${input.decision}: ${request.summary}`, before: { status: before.status }, after: { status: request.status, requestStatus: attendanceRequest.status, requestId: request.id } } };
  },
});
export async function decideAttendanceRequestAction(input: unknown) {
  return decidePipeline(input);
}

const ownOrHr = async (user: ActingUser, attendanceRequestId: string) => {
  const row = await findAttendanceRequest(attendanceRequestId);
  if (!row) return false;
  return row.personId === user.person.id || row.filedByPersonId === user.person.id || isHrFor(user, row.personId);
};

const cancelPipeline = createAction({
  name: "attendance.request.cancel",
  input: z.object({ attendanceRequestId: z.uuid(), reason: text(500) }),
  authorize: (user, input) => ownOrHr(user, input.attendanceRequestId),
  run: async ({ user, input }) => {
    const current = await findAttendanceRequest(input.attendanceRequestId);
    const { before, after } = await cancelAttendanceRequest(input.attendanceRequestId, { personId: user.person.id, isHr: await isHrFor(user, current!.personId) }, input.reason);
    refresh();
    if (after.approvalRequestId) revalidatePath(`/approvals/attendance/${after.approvalRequestId}`);
    return { data: { status: after.status }, audit: { resource: { type: "attendance_request", id: after.id, entityId: after.entityId }, summary: `${before.status} → ${after.status}: ${after.type} ${after.startDate}`, before: { status: before.status }, after: { status: after.status, reason: input.reason } } };
  },
});
export async function cancelAttendanceRequestAction(input: unknown) {
  return cancelPipeline(input);
}

const confirmHoursPipeline = createAction({
  name: "attendance.request.confirm_hours",
  input: z.object({ attendanceRequestId: z.uuid(), minutes: wholeNumber(0, 960) }),
  authorize: async (user, input) => {
    const row = await findAttendanceRequest(input.attendanceRequestId);
    const target = row ? await getPersonTarget(row.personId) : null;
    return !!target && canConfirmHoursOf(user.principal, target);
  },
  run: async ({ user, input }) => {
    const { before, after } = await confirmWorkedMinutes(input.attendanceRequestId, user.person.id, input.minutes);
    refresh();
    if (after.approvalRequestId) revalidatePath(`/approvals/attendance/${after.approvalRequestId}`);
    return { data: { confirmedMinutes: after.confirmedMinutes }, audit: { resource: { type: "attendance_request", id: after.id, entityId: after.entityId }, summary: `hours confirmed: ${input.minutes} min on ${after.startDate}`, before: { confirmedMinutes: before.confirmedMinutes }, after: { confirmedMinutes: after.confirmedMinutes } } };
  },
});
export async function confirmWorkedMinutesAction(input: unknown) {
  return confirmHoursPipeline(input);
}

// ── Evidence (a photo of the broken clock, a message from the client) ───────────────────────

const beginEvidencePipeline = createAction({
  name: "attendance.evidence.begin",
  input: z.object({ personId: optional(z.uuid()), fileName: z.string().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId ?? user.person.id);
    return !!target && canFileAttendanceRequestFor(user.principal, target);
  },
  run: async ({ user, input }) => {
    const personId = input.personId ?? user.person.id;
    const target = await getPersonTarget(personId);
    const upload = await beginUpload({ ownerType: "attendance_evidence", ownerId: personId, entityId: target?.entityId ?? null, tier: "personal" }, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "file", id: upload.fileId, entityId: target?.entityId ?? null }, summary: `attendance evidence: ${input.fileName}` } };
  },
});
export async function beginEvidenceAction(input: unknown) {
  return beginEvidencePipeline(input);
}

const completeEvidencePipeline = createAction({
  name: "attendance.evidence.complete",
  input: z.object({ fileId: z.uuid() }),
  authorize: (user, input) => isPendingEvidence(input.fileId, user.person.id),
  run: async ({ user, input }) => {
    const file = await completeUpload(input.fileId, { personId: user.person.id, email: user.email });
    return { data: { fileId: file.id, fileName: file.fileName }, audit: { resource: { type: "file", id: file.id, entityId: file.entityId }, summary: `attendance evidence stored: ${file.fileName}` } };
  },
});
export async function completeEvidenceAction(input: unknown) {
  return completeEvidencePipeline(input);
}

// Whoever may open the request may open its evidence.
const evidenceLinkPipeline = createAction({
  name: "attendance.evidence.open",
  input: z.object({ requestId: z.uuid() }),
  authorize: async (user, input) => !!(await getAttendanceRequestView({ personId: user.person.id, principal: user.principal }, input.requestId))?.attendanceRequest.evidenceFileId,
  run: async ({ user, input }) => {
    const view = await getAttendanceRequestView({ personId: user.person.id, principal: user.principal }, input.requestId);
    const file = view?.attendanceRequest.evidenceFileId ? await findFile(view.attendanceRequest.evidenceFileId) : undefined;
    if (!file) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "file", id: file.id, entityId: file.entityId }, summary: `attendance evidence opened: ${file.fileName}` } };
  },
});
export async function evidenceLinkAction(input: unknown) {
  return evidenceLinkPipeline(input);
}

// ── The monthly timesheet ───────────────────────────────────────────────────────────────────

const confirmMonthPipeline = createAction({
  name: "attendance.month.confirm",
  input: z.object({ month }),
  // One's own month, nobody else's.
  authorize: () => true,
  run: async ({ user, input }) => {
    const { before, after } = await confirmMonth(user.person.id, input.month);
    refresh();
    return { data: { status: after.status }, audit: { resource: { type: "timesheet_month", id: after.id, entityId: after.entityId }, summary: `confirmed ${input.month}`, before: { status: before.status }, after: { status: after.status, summary: after.summary } } };
  },
});
export async function confirmMonthAction(input: unknown) {
  return confirmMonthPipeline(input);
}

const approveMonthsPipeline = createAction({
  name: "attendance.month.approve",
  input: z.object({ month, personIds: z.array(z.uuid()).min(1).max(200) }),
  authorize: async (user, input) => {
    for (const personId of input.personIds) {
      const target = await getPersonTarget(personId);
      if (!target || !canApproveMonthOf(user.principal, target)) return false;
    }
    return true;
  },
  run: async ({ user, input }) => {
    // Each month is its own transaction: one person's unconfirmed month does not hold up the others.
    const results: { personId: string; ok: boolean; message?: string }[] = [];
    for (const personId of input.personIds) {
      try {
        await approveMonth(personId, input.month, { personId: user.person.id, isHr: await isHrFor(user, personId) });
        results.push({ personId, ok: true });
      } catch (error) {
        if (!(error instanceof ActionError)) throw error;
        results.push({ personId, ok: false, message: error.message });
      }
    }
    refresh();
    const approved = results.filter((row) => row.ok).length;
    return { data: { approved, results }, audit: { resource: { type: "timesheet_month", id: input.month }, summary: `approved ${approved} of ${results.length} for ${input.month}`, after: { month: input.month, results } } };
  },
});
export async function approveMonthsAction(input: unknown) {
  return approveMonthsPipeline(input);
}

const reopenMonthPipeline = createAction({
  name: "attendance.month.reopen",
  input: z.object({ month, personId: z.uuid(), comment: z.string().trim().min(3).max(500) }),
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    return !!target && canApproveMonthOf(user.principal, target);
  },
  run: async ({ user, input }) => {
    const { before, after } = await reopenMonth(input.personId, input.month, user.person.id, input.comment);
    refresh();
    return { data: { status: after.status }, audit: { resource: { type: "timesheet_month", id: after.id, entityId: after.entityId }, summary: `sent back ${input.month}: ${input.comment}`, before: { status: before.status }, after: { status: after.status } } };
  },
});
export async function reopenMonthAction(input: unknown) {
  return reopenMonthPipeline(input);
}

const lockPipeline = createAction({
  name: "attendance.period.lock",
  input: z.object({ entityId: z.uuid(), month, overrideReason: text(500) }),
  authorize: (user, input) => canLockPeriod(user.principal, input.entityId),
  run: async ({ user, input }) => {
    if (input.overrideReason !== null && input.overrideReason.length < 10) throw new ActionError("timesheet_override_reason_short");
    const result = await lockPeriod(input.entityId, input.month, user.person.id, { overrideReason: input.overrideReason });
    refresh();
    return { data: { people: result.people, days: result.days, toilPosted: result.toilPosted.length, exceptions: result.exceptions.length }, audit: { resource: { type: "timesheet_period", id: result.period.id, entityId: input.entityId }, summary: `locked ${input.month}: ${result.people} people, ${result.days} days${result.exceptions.length ? `, override with ${result.exceptions.length} exception(s)` : ""}`, after: { month: input.month, people: result.people, days: result.days, toilPosted: result.toilPosted, overrideReason: input.overrideReason, exceptions: result.exceptions } } };
  },
});
export async function lockPeriodAction(input: unknown) {
  return lockPipeline(input);
}

const remindPipeline = createAction({
  name: "attendance.period.remind",
  input: z.object({ entityId: z.uuid(), month }),
  authorize: (user, input) => canLockPeriod(user.principal, input.entityId),
  run: async ({ input }) => {
    const told = await remindToConfirm(input.entityId, input.month);
    return { data: { told }, audit: { resource: { type: "timesheet_period", id: `${input.entityId}:${input.month}`, entityId: input.entityId }, summary: `reminded ${told} people to confirm ${input.month}` } };
  },
});
export async function remindToConfirmAction(input: unknown) {
  return remindPipeline(input);
}

// ── After the lock ──────────────────────────────────────────────────────────────────────────

const signedMinutes = z.preprocess((value) => (typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : blankToNull(value)), z.number().int().min(-60_000).max(60_000).nullable().default(null));

const adjustPipeline = createAction({
  name: "attendance.adjustment.create",
  input: z.object({ personId: z.uuid(), month, date: optional(day), reason: z.string().trim().min(5).max(1000), ...Object.fromEntries(ADJUSTMENT_FIELDS.map((field) => [field, signedMinutes])) } as { personId: z.ZodUUID; month: typeof month; date: ReturnType<typeof optional<typeof day>>; reason: z.ZodString } & Record<(typeof ADJUSTMENT_FIELDS)[number], typeof signedMinutes>),
  authorize: (user, input) => isHrFor(user, input.personId),
  run: async ({ user, input }) => {
    const deltas = Object.fromEntries(ADJUSTMENT_FIELDS.flatMap((field) => (input[field] ? [[field, input[field]]] : [])));
    const row = await createAdjustment({ personId: input.personId, month: input.month, date: input.date, deltas, reason: input.reason }, user.person.id);
    refresh();
    return { data: { id: row.id }, audit: { resource: { type: "timesheet_adjustment", id: row.id, entityId: row.entityId }, summary: `adjustment to locked ${input.month}: ${input.reason}`, after: { personId: input.personId, month: input.month, date: input.date, deltas: row.deltas } } };
  },
});
export async function createAdjustmentAction(input: unknown) {
  return adjustPipeline(input);
}

const voidAdjustmentPipeline = createAction({
  name: "attendance.adjustment.void",
  input: z.object({ adjustmentId: z.uuid(), reason: z.string().trim().min(5).max(500) }),
  authorize: async (user, input) => {
    const row = await findAdjustment(input.adjustmentId);
    return !!row && isHrFor(user, row.personId);
  },
  run: async ({ user, input }) => {
    const { before, after } = await voidAdjustment(input.adjustmentId, user.person.id, input.reason);
    refresh();
    return { data: { status: after.status }, audit: { resource: { type: "timesheet_adjustment", id: after.id, entityId: after.entityId }, summary: `adjustment voided: ${input.reason}`, before: { status: before.status, deltas: before.deltas }, after: { status: after.status } } };
  },
});
export async function voidAdjustmentAction(input: unknown) {
  return voidAdjustmentPipeline(input);
}

// ── The anomaly console ─────────────────────────────────────────────────────────────────────

const nudgePipeline = createAction({
  name: "attendance.anomaly.nudge",
  input: z.object({ personId: z.uuid(), month }),
  authorize: (user, input) => isHrFor(user, input.personId),
  run: async ({ input }) => {
    const target = await getPersonTarget(input.personId);
    await notify({ recipients: [input.personId], kind: "attendance.nudge", params: { month: input.month }, link: `/attendance?month=${input.month}` });
    return { data: { sent: true }, audit: { resource: { type: "person", id: input.personId, entityId: target?.entityId ?? null }, summary: `nudged about attendance ${input.month}` } };
  },
});
export async function nudgeAction(input: unknown) {
  return nudgePipeline(input);
}

const exportPipeline = createAction({
  name: "attendance.anomalies.export",
  input: z.object({ month, entityId: optional(z.uuid()), departmentId: optional(z.uuid()), personId: optional(z.uuid()), kind: optional(z.enum(ANOMALY_KINDS)) }),
  authorize: (user) => can(user.principal, "attendance:manage"),
  run: async ({ user, input }) => {
    // The screen's own function with the viewer's principal: the file holds what the screen shows.
    const { lines } = await listAnomalies(user.principal, input.month, input);
    const rows = lines.slice(0, EXPORT_ROW_LIMIT);
    const csv = toCsv([{ header: "Loại", value: (row: (typeof rows)[number]) => row.kind }, { header: "Nhân viên", value: (row) => row.fullName ?? "" }, { header: "Ngày", value: (row) => row.date ?? "" }, { header: "Phút", value: (row) => row.minutes ?? "" }, { header: "Chi tiết", value: (row) => row.detail ?? "" }, { header: "Chặn khoá công", value: (row) => (row.blocking ? "x" : "") }], rows);
    const file: CsvFile = { fileName: `attendance-anomalies-${input.month}-${todayInVietnam()}.csv`, csv, rowCount: rows.length, truncated: lines.length > rows.length };
    return { data: file, audit: { resource: { type: "export:attendance_anomalies", id: input.month, entityId: input.entityId }, summary: `${file.rowCount} rows`, after: { filters: input, rowCount: file.rowCount } } };
  },
});
export async function exportAnomaliesAction(input: unknown) {
  return exportPipeline(input);
}
