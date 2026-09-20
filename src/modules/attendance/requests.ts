// Attendance requests on the approval engine (FR-ATT-10, 11, 12, 18): a punch correction, remote
// work (WFH, off-site, business trip), pre-approved overtime, and work on a holiday or rest day.
// One table, four request types. The decision and its effect — the correction's punches, the
// timesheet recompute — happen in one transaction. Nothing here touches a locked month.
import "server-only";
import { and, desc, eq, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getPersonTarget } from "@/modules/core-hr/service";
import { type ApproverStep, decideRequest, defineRequestType, getRequest, previewApprovers, type RequestTypeDefinition, type RequestView, resubmitRequest, submitRequest, withdrawRequest } from "@/modules/platform/approvals/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { getParameter } from "@/modules/platform/statutory/service";
import { getAttendancePolicy } from "./attendance-policies";
import { eachDate } from "./engine/calendar";
import { instantOf } from "./engine/merge";
import { clockMinutes, correctionAllowed, type OvertimeCapWarning, overtimeCapWarnings, windowOf } from "./engine/requests";
import { requestTimesheetRecompute } from "./recompute";
import type { AttendanceRequestDetails } from "./schema";
import { getDayPlans } from "./schedules";
import { monthEnd, monthOf, monthStart } from "./timesheets";

type Executor = Tx | ReturnType<typeof db>;
export type AttendanceRequestRow = typeof schema.attendanceRequest.$inferSelect;
export type AttendanceRequestType = AttendanceRequestRow["type"];
export const ATTENDANCE_REQUEST_TYPES = ["attendance_correction", "remote_work", "overtime", "holiday_work"] as const;

// Every type starts with the line manager alone. An entity that wants HR or the department head
// on, say, holiday work adds the step on /admin/approval-flows; `minutes`, `days` and `kind` are
// there for conditions ("overtime above 240 minutes also needs the department head").
const define = (type: AttendanceRequestType, bulkApprovable: RequestTypeDefinition["bulkApprovable"]) =>
  defineRequestType({
    type,
    flow: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] },
    conditionFields: ["minutes", "days", "kind"],
    bulkApprovable,
    // HR follows the attendance of the people they keep it for.
    canView: (viewer, subject) => !!subject && can(viewer, "attendance:manage", subject),
  });

export const REQUEST_DEFINITIONS: Record<AttendanceRequestType, RequestTypeDefinition> = {
  // Evidence is there to be looked at: a correction that carries a file is opened, not ticked.
  attendance_correction: define("attendance_correction", (request) => !(request.payload as { hasEvidence?: boolean }).hasEvidence),
  remote_work: define("remote_work", () => true),
  overtime: define("overtime", () => true),
  holiday_work: define("holiday_work", () => true),
};

/**
 * Who would be asked to approve one of this person's attendance requests (FR-AI-02: "who approves
 * my overtime?"). The entity's own flow decides; names only, and the caller decides who may ask.
 */
export const whoApprovesAttendance = (type: AttendanceRequestType, subjectPersonId: string): Promise<ApproverStep[]> => previewApprovers(REQUEST_DEFINITIONS[type], subjectPersonId);

export type AttendanceRequestInput = { type: AttendanceRequestType; startDate: IsoDate; endDate: IsoDate; details: AttendanceRequestDetails; reason: string | null; evidenceFileId: string | null; compensation: "pay" | "time_off" | null };
export type AttendancePayload = { attendanceRequestId: string; startDate: IsoDate; endDate: IsoDate; hasEvidence: boolean; minutes: number; days: number; kind: string };

const MAX_REMOTE_DAYS = 31;
const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");

/** A month nobody may change any more: the entity's period is locked, or the person's days are. */
export async function isMonthClosedFor(executor: Executor, personId: string, entityId: string | null, month: string): Promise<boolean> {
  const [period] = entityId ? await executor.select({ id: schema.timesheetPeriod.id }).from(schema.timesheetPeriod).where(and(eq(schema.timesheetPeriod.entityId, entityId), eq(schema.timesheetPeriod.month, month), eq(schema.timesheetPeriod.status, "locked"))).limit(1) : [];
  if (period) return true;
  const [day] = await executor.select({ id: schema.timesheetDay.id }).from(schema.timesheetDay).where(and(eq(schema.timesheetDay.personId, personId), gte(schema.timesheetDay.date, monthStart(month)), lte(schema.timesheetDay.date, monthEnd(month)), isNotNull(schema.timesheetDay.lockedAt))).limit(1);
  return !!day;
}

// The engine's generic withdraw knows nothing of attendance: follow it the next time we look.
async function syncWithdrawn(executor: Executor, personId: string): Promise<void> {
  await executor.execute(sql`
    update attendance_request set status = 'withdrawn', updated_at = now()
    from approval_request
    where approval_request.id = attendance_request.approval_request_id and attendance_request.person_id = ${personId}
      and attendance_request.status = 'pending' and approval_request.status in ('withdrawn', 'cancelled')`);
}

const minutesOfRequest = (details: AttendanceRequestDetails): number => {
  if (details.type === "overtime") return windowOf(details.from, details.to)?.minutes ?? 0;
  if (details.type === "holiday_work" && details.from && details.to) return windowOf(details.from, details.to)?.minutes ?? 0;
  return 0;
};

function summaryOf(input: AttendanceRequestInput): string {
  const { details } = input;
  const range = input.startDate === input.endDate ? formatDay(input.startDate) : `${formatDay(input.startDate)} – ${formatDay(input.endDate)}`;
  // Vietnamese, like every approval summary: it is read in the inbox and the email.
  if (details.type === "attendance_correction") return `Bổ sung công ${range}: ${[details.inTime ? `vào ${details.inTime}` : null, details.outTime ? `ra ${details.outTime}${details.outNextDay ? " (hôm sau)" : ""}` : null].filter(Boolean).join(", ")}`;
  if (details.type === "remote_work") return `${details.kind === "wfh" ? "Làm việc tại nhà" : details.kind === "off_site" ? "Làm việc ngoài văn phòng" : "Công tác"} ${range}${details.locationName ? ` — ${details.locationName}` : ""}`;
  if (details.type === "overtime") return `Làm thêm giờ ${range}, ${details.from}–${details.to}${input.compensation === "time_off" ? " (nghỉ bù)" : ""}`;
  return `Làm việc ngày nghỉ/lễ ${range}${details.from && details.to ? `, ${details.from}–${details.to}` : ""}${input.compensation === "time_off" ? " (nghỉ bù)" : ""}`;
}

/** Overtime already on the books for the person: stored approved overtime plus approved requests still ahead. */
async function overtimeTotals(executor: Executor, personId: string, date: IsoDate, excludeRequestId: string | null): Promise<{ monthMinutes: number; yearMinutes: number }> {
  const year = date.slice(0, 4);
  const today = todayInVietnam();
  const total = sql<number>`coalesce(sum(${schema.timesheetDay.otWeekdayMinutes} + ${schema.timesheetDay.otWeekdayNightMinutes} + ${schema.timesheetDay.otRestDayMinutes} + ${schema.timesheetDay.otRestDayNightMinutes} + ${schema.timesheetDay.otHolidayMinutes} + ${schema.timesheetDay.otHolidayNightMinutes}), 0)::int`;
  const [[monthRow], [yearRow], ahead] = await Promise.all([
    executor.select({ value: total }).from(schema.timesheetDay).where(and(eq(schema.timesheetDay.personId, personId), gte(schema.timesheetDay.date, monthStart(monthOf(date))), lte(schema.timesheetDay.date, monthEnd(monthOf(date))))),
    executor.select({ value: total }).from(schema.timesheetDay).where(and(eq(schema.timesheetDay.personId, personId), gte(schema.timesheetDay.date, `${year}-01-01`), lte(schema.timesheetDay.date, `${year}-12-31`))),
    // What is approved or asked for days that have not happened yet counts as planned.
    executor
      .select()
      .from(schema.attendanceRequest)
      .where(and(eq(schema.attendanceRequest.personId, personId), inArray(schema.attendanceRequest.type, ["overtime", "holiday_work"]), inArray(schema.attendanceRequest.status, ["pending", "approved"]), gte(schema.attendanceRequest.startDate, today), gte(schema.attendanceRequest.startDate, `${year}-01-01`), lte(schema.attendanceRequest.startDate, `${year}-12-31`))),
  ]);
  const planned = ahead.filter((row) => row.id !== excludeRequestId);
  const plannedMinutes = (rows: AttendanceRequestRow[]) => rows.reduce((sum, row) => sum + minutesOfRequest(row.details), 0);
  return { monthMinutes: monthRow.value + plannedMinutes(planned.filter((row) => monthOf(row.startDate) === monthOf(date))), yearMinutes: yearRow.value + plannedMinutes(planned) };
}

async function capsOn(executor: Executor, date: IsoDate) {
  try {
    return await getParameter("overtime.caps", date, executor);
  } catch {
    return null;
  }
}

export async function overtimeWarningsFor(personId: string, date: IsoDate, addMinutes: number, excludeRequestId: string | null = null, executor: Executor = db()): Promise<OvertimeCapWarning[]> {
  const [totals, caps] = await Promise.all([overtimeTotals(executor, personId, date, excludeRequestId), capsOn(executor, date)]);
  return overtimeCapWarnings({ ...totals, addMinutes, caps });
}

/** Corrections of the month that count against the cap: waiting or approved. */
export async function correctionsUsed(executor: Executor, personId: string, month: string, excludeRequestId: string | null = null): Promise<number> {
  await syncWithdrawn(executor, personId);
  const rows = await executor
    .select({ id: schema.attendanceRequest.id })
    .from(schema.attendanceRequest)
    .where(and(eq(schema.attendanceRequest.personId, personId), eq(schema.attendanceRequest.type, "attendance_correction"), inArray(schema.attendanceRequest.status, ["pending", "approved"]), gte(schema.attendanceRequest.startDate, monthStart(month)), lte(schema.attendanceRequest.startDate, monthEnd(month))));
  return rows.filter((row) => row.id !== excludeRequestId).length;
}

/** The uploader's own evidence file that still waits for its check — what the "complete" action may touch. */
export async function isPendingEvidence(fileId: string, uploaderPersonId: string): Promise<boolean> {
  const [file] = await db().select({ id: schema.storedFile.id }).from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.ownerType, "attendance_evidence"), eq(schema.storedFile.uploadedByPersonId, uploaderPersonId), eq(schema.storedFile.status, "pending"))).limit(1);
  return !!file;
}

async function checkEvidence(executor: Executor, fileId: string | null, personId: string): Promise<void> {
  if (!fileId) return;
  const [file] = await executor.select().from(schema.storedFile).where(eq(schema.storedFile.id, fileId)).limit(1);
  if (!file || file.ownerType !== "attendance_evidence" || file.ownerId !== personId || file.status !== "ready" || file.deletedAt) throw new ActionError("file_not_found");
}

/** Everything wrong with a request, first problem thrown. Returns what submit needs. */
async function check(tx: Tx, personId: string, input: AttendanceRequestInput, actor: { personId: string; isHr: boolean }, existingId: string | null): Promise<{ entityId: string; minutes: number; days: number; kind: string; warnings: OvertimeCapWarning[] }> {
  await syncWithdrawn(tx, personId);
  const target = await getPersonTarget(personId, tx);
  if (!target?.entityId) throw new ActionError("no_employment");
  const { details } = input;
  if (details.type !== input.type) throw new ActionError("attendance_request_invalid");
  if (input.endDate < input.startDate) throw new ActionError("attendance_request_dates");
  if (input.type !== "remote_work" && input.startDate !== input.endDate) throw new ActionError("attendance_request_one_day");
  const dates = eachDate(input.startDate, input.endDate);
  if (dates.length > MAX_REMOTE_DAYS) throw new ActionError("attendance_request_too_long");
  const today = todayInVietnam();
  for (const month of new Set(dates.map(monthOf))) if (await isMonthClosedFor(tx, personId, target.entityId, month)) throw new ActionError("attendance_period_locked");

  // One open request of a kind per day: a second one is a mistake, not a wish.
  const clash = await tx
    .select({ id: schema.attendanceRequest.id })
    .from(schema.attendanceRequest)
    .where(and(eq(schema.attendanceRequest.personId, personId), eq(schema.attendanceRequest.type, input.type), inArray(schema.attendanceRequest.status, ["pending", "approved"]), lte(schema.attendanceRequest.startDate, input.endDate), gte(schema.attendanceRequest.endDate, input.startDate), existingId ? ne(schema.attendanceRequest.id, existingId) : undefined))
    .limit(1);
  if (clash.length > 0) throw new ActionError("attendance_request_duplicate");

  const plans = (await getDayPlans([personId], input.startDate, input.endDate, tx)).get(personId)?.days ?? [];
  let minutes = 0;
  let warnings: OvertimeCapWarning[] = [];
  let kind: string = input.type;

  if (details.type === "attendance_correction") {
    if (input.startDate > today) throw new ActionError("correction_future");
    const inAt = clockMinutes(details.inTime);
    const outAt = clockMinutes(details.outTime);
    if (inAt === null && outAt === null) throw new ActionError("correction_needs_time");
    if (inAt !== null && outAt !== null && !details.outNextDay && outAt <= inAt) throw new ActionError("correction_out_before_in");
    await checkEvidence(tx, input.evidenceFileId, personId);
    const policy = await getAttendancePolicy(target.entityId, input.startDate, tx);
    const used = await correctionsUsed(tx, personId, monthOf(input.startDate), existingId);
    // HR filing for someone is the way past the cap (the device really was broken all week).
    if (!correctionAllowed({ usedThisMonth: used, cap: policy.monthlyCorrectionCap, filedByHr: actor.isHr && actor.personId !== personId }).allowed) throw new ActionError("correction_cap_reached", { cap: policy.monthlyCorrectionCap, used });
    kind = details.cause;
  } else if (details.type === "remote_work") {
    if ((details.latitude === null) !== (details.longitude === null)) throw new ActionError("remote_position_incomplete");
    if (details.kind !== "wfh" && !details.locationName?.trim()) throw new ActionError("remote_needs_location");
    if (details.portion !== "full" && dates.length > 1) throw new ActionError("remote_half_day_one_day");
    if (!plans.some((day) => day.kind === "working")) throw new ActionError("remote_no_working_day");
    kind = details.kind;
  } else {
    const window = details.from && details.to ? windowOf(details.from, details.to) : null;
    if (details.type === "overtime" && !window) throw new ActionError("overtime_window_invalid");
    if (details.type === "holiday_work" && (details.from || details.to) && !window) throw new ActionError("overtime_window_invalid");
    if (!input.compensation) throw new ActionError("overtime_compensation_required");
    const plan = plans[0];
    const dayOff = !!plan && ["rest", "holiday", "compensatory_off", "company_off"].includes(plan.kind);
    // The engine files extra time by the kind of day; asking on the wrong form would silently count for nothing.
    if (details.type === "overtime" && dayOff) throw new ActionError("overtime_use_holiday_work");
    if (details.type === "holiday_work" && !dayOff) throw new ActionError("holiday_work_not_day_off");
    minutes = window?.minutes ?? 0;
    if (minutes > 16 * 60) throw new ActionError("overtime_window_invalid");
    warnings = await overtimeWarningsFor(personId, input.startDate, minutes, existingId, tx);
    kind = plan?.kind ?? input.type;
  }
  return { entityId: target.entityId, minutes, days: dates.length, kind, warnings };
}

export async function submitAttendanceRequest(personId: string, input: AttendanceRequestInput, actor: { personId: string; isHr: boolean }) {
  return db().transaction(async (tx) => {
    const checked = await check(tx, personId, input, actor, null);
    const [row] = await tx
      .insert(schema.attendanceRequest)
      .values({ type: input.type, personId, entityId: checked.entityId, filedByPersonId: actor.personId, startDate: input.startDate, endDate: input.endDate, details: input.details, reason: input.reason, evidenceFileId: input.evidenceFileId, compensation: input.type === "overtime" || input.type === "holiday_work" ? input.compensation : null })
      .returning();
    const payload: AttendancePayload = { attendanceRequestId: row.id, startDate: input.startDate, endDate: input.endDate, hasEvidence: !!input.evidenceFileId, minutes: checked.minutes, days: checked.days, kind: checked.kind };
    const { request, outcome } = await submitRequest(tx, REQUEST_DEFINITIONS[input.type], {
      entityId: checked.entityId,
      requesterPersonId: actor.personId,
      subjectPersonId: personId,
      subjectType: "attendance_request",
      subjectId: row.id,
      summary: summaryOf(input),
      payload,
      conditionData: { minutes: checked.minutes, days: checked.days, kind: checked.kind },
      link: (requestId) => `/approvals/attendance/${requestId}`,
    });
    let [saved] = await tx.update(schema.attendanceRequest).set({ approvalRequestId: request.id }).where(eq(schema.attendanceRequest.id, row.id)).returning();
    // A flow with nobody to ask (every step skipped) approves at once.
    if (outcome === "approved") saved = await applyApproval(tx, saved);
    return { attendanceRequest: saved, approvalRequestId: request.id, outcome, warnings: checked.warnings };
  });
}

/** After "return for changes": the corrected request goes round again. */
export async function resubmitAttendanceRequest(approvalRequestId: string, input: AttendanceRequestInput, actor: { personId: string; isHr: boolean }) {
  return db().transaction(async (tx) => {
    const before = await requestByApproval(tx, approvalRequestId);
    if (before.type !== input.type) throw new ActionError("attendance_request_invalid");
    const checked = await check(tx, before.personId, input, actor, before.id);
    const [saved] = await tx
      .update(schema.attendanceRequest)
      .set({ startDate: input.startDate, endDate: input.endDate, details: input.details, reason: input.reason, evidenceFileId: input.evidenceFileId ?? before.evidenceFileId, compensation: input.type === "overtime" || input.type === "holiday_work" ? input.compensation : null, updatedAt: new Date() })
      .where(eq(schema.attendanceRequest.id, before.id))
      .returning();
    const payload: AttendancePayload = { attendanceRequestId: saved.id, startDate: input.startDate, endDate: input.endDate, hasEvidence: !!saved.evidenceFileId, minutes: checked.minutes, days: checked.days, kind: checked.kind };
    const { request } = await resubmitRequest(tx, REQUEST_DEFINITIONS[input.type], approvalRequestId, actor.personId, { summary: summaryOf(input), payload });
    return { attendanceRequest: saved, before, request, warnings: checked.warnings };
  });
}

async function requestByApproval(tx: Tx, approvalRequestId: string): Promise<AttendanceRequestRow> {
  const [row] = await tx.select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.approvalRequestId, approvalRequestId)).limit(1).for("update");
  if (!row) throw new ActionError("attendance_request_not_found");
  return row;
}

const REQUEST_PUNCH_NOTE = "Đơn bổ sung công";

// The effect of an approval. A correction becomes punches (source "request": they count under
// every merge rule); the other three are read by the timesheet engine from their approved rows.
async function applyApproval(tx: Tx, row: AttendanceRequestRow): Promise<AttendanceRequestRow> {
  for (const month of new Set(eachDate(row.startDate, row.endDate).map(monthOf))) if (await isMonthClosedFor(tx, row.personId, row.entityId, month)) throw new ActionError("attendance_period_locked");
  if (row.details.type === "attendance_correction") {
    const inAt = clockMinutes(row.details.inTime);
    const outAt = clockMinutes(row.details.outTime);
    const punches = [inAt === null ? null : { direction: "in" as const, minute: inAt }, outAt === null ? null : { direction: "out" as const, minute: outAt + (row.details.outNextDay ? 1440 : 0) }].filter((value) => value !== null);
    await tx.insert(schema.punch).values(punches.map((punch) => ({ personId: row.personId, entityId: row.entityId, at: new Date(instantOf(row.startDate, punch.minute)), direction: punch.direction, source: "request" as const, flags: [], note: REQUEST_PUNCH_NOTE, deviceInfo: { requestId: row.id } })));
  }
  const [saved] = await tx.update(schema.attendanceRequest).set({ status: "approved", updatedAt: new Date() }).where(eq(schema.attendanceRequest.id, row.id)).returning();
  await requestTimesheetRecompute([row.personId], addDays(row.startDate, -1), addDays(row.endDate, 1), tx);
  return saved;
}

export async function decideAttendanceRequest(actorPersonId: string, approvalRequestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    let row = await requestByApproval(tx, approvalRequestId);
    const { request, before, outcome } = await decideRequest(tx, REQUEST_DEFINITIONS[row.type], approvalRequestId, actorPersonId, decision);
    if (outcome === "approved") row = await applyApproval(tx, row);
    if (outcome === "rejected") [row] = await tx.update(schema.attendanceRequest).set({ status: "rejected", updatedAt: new Date() }).where(eq(schema.attendanceRequest.id, row.id)).returning();
    return { request, before, outcome, attendanceRequest: row };
  });
}

/**
 * Ends a request. Waiting: the requester takes it back (HR may cancel it). Approved: the person
 * until the day comes, HR afterwards — a correction's punches stop counting, the days recompute.
 */
export async function cancelAttendanceRequest(attendanceRequestId: string, actor: { personId: string; isHr: boolean }, reason: string | null) {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.id, attendanceRequestId)).limit(1).for("update");
    if (!before) throw new ActionError("attendance_request_not_found");
    const own = before.personId === actor.personId || before.filedByPersonId === actor.personId;
    if (!own && !actor.isHr) throw new ActionError("attendance_cancel_not_allowed");

    if (before.status === "pending") {
      const [approval] = before.approvalRequestId ? await tx.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, before.approvalRequestId)).limit(1) : [];
      if (approval && approval.requesterPersonId === actor.personId) await withdrawRequest(tx, approval.id, actor.personId);
      else if (approval) {
        await tx.update(schema.approvalRequest).set({ status: "cancelled", decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.approvalRequest.id, approval.id), inArray(schema.approvalRequest.status, ["pending", "returned"])));
        await tx.insert(schema.approvalEvent).values({ requestId: approval.id, type: "cancelled", actorPersonId: actor.personId, stepIndex: approval.currentStep, comment: reason });
      }
      const [after] = await tx.update(schema.attendanceRequest).set({ status: approval?.requesterPersonId === actor.personId ? "withdrawn" : "cancelled", updatedAt: new Date() }).where(eq(schema.attendanceRequest.id, before.id)).returning();
      return { before, after };
    }

    if (before.status !== "approved") throw new ActionError("attendance_request_not_open");
    if (!actor.isHr && before.startDate <= todayInVietnam()) throw new ActionError("attendance_cancel_started");
    for (const month of new Set(eachDate(before.startDate, before.endDate).map(monthOf))) if (await isMonthClosedFor(tx, before.personId, before.entityId, month)) throw new ActionError("attendance_period_locked");
    if (before.type === "attendance_correction") {
      await tx.update(schema.punch).set({ reviewStatus: "rejected", reviewedByPersonId: actor.personId, reviewedAt: new Date(), reviewNote: reason ?? "Huỷ đơn bổ sung công" }).where(and(eq(schema.punch.personId, before.personId), eq(schema.punch.source, "request"), sql`${schema.punch.deviceInfo}->>'requestId' = ${before.id}`));
    }
    const [after] = await tx.update(schema.attendanceRequest).set({ status: "cancelled", updatedAt: new Date() }).where(eq(schema.attendanceRequest.id, before.id)).returning();
    if (before.approvalRequestId) await tx.insert(schema.approvalEvent).values({ requestId: before.approvalRequestId, type: "cancelled", actorPersonId: actor.personId, stepIndex: 0, comment: reason });
    await requestTimesheetRecompute([before.personId], addDays(before.startDate, -1), addDays(before.endDate, 1), tx);
    return { before, after };
  });
}

/**
 * The line manager (or HR) confirms the hours of approved overtime or holiday work that punches
 * cannot show — an untracked Saturday, a shoot off-site (FR-ATT-18). Only once the day has come.
 */
export async function confirmWorkedMinutes(attendanceRequestId: string, actorPersonId: string, minutes: number) {
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.id, attendanceRequestId)).limit(1).for("update");
    if (!before || (before.type !== "overtime" && before.type !== "holiday_work")) throw new ActionError("attendance_request_not_found");
    if (before.status !== "approved") throw new ActionError("attendance_request_not_open");
    if (before.personId === actorPersonId) throw new ActionError("confirm_own_hours");
    if (before.startDate > todayInVietnam()) throw new ActionError("confirm_hours_future");
    if (await isMonthClosedFor(tx, before.personId, before.entityId, monthOf(before.startDate))) throw new ActionError("attendance_period_locked");
    const [after] = await tx.update(schema.attendanceRequest).set({ confirmedMinutes: minutes, confirmedByPersonId: actorPersonId, confirmedAt: new Date(), updatedAt: new Date() }).where(eq(schema.attendanceRequest.id, before.id)).returning();
    await requestTimesheetRecompute([before.personId], before.startDate, before.endDate, tx);
    return { before, after };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export async function findAttendanceRequest(id: string, executor: Executor = db()): Promise<AttendanceRequestRow | null> {
  const [row] = await executor.select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.id, id)).limit(1);
  return row ?? null;
}

export async function findByApproval(approvalRequestId: string, executor: Executor = db()): Promise<AttendanceRequestRow | null> {
  const [row] = await executor.select().from(schema.attendanceRequest).where(eq(schema.attendanceRequest.approvalRequestId, approvalRequestId)).limit(1);
  return row ?? null;
}

export type AttendanceRequestView = RequestView & { attendanceRequest: AttendanceRequestRow; warnings: OvertimeCapWarning[]; correctionsUsed: number | null; correctionCap: number | null };

export async function getAttendanceRequestView(viewer: { personId: string; principal: Principal }, approvalRequestId: string): Promise<AttendanceRequestView | null> {
  const row = await findByApproval(approvalRequestId);
  if (!row) return null;
  const view = await getRequest(viewer, REQUEST_DEFINITIONS[row.type], approvalRequestId);
  if (!view) return null;
  await syncWithdrawn(db(), row.personId);
  const attendanceRequest = (await findAttendanceRequest(row.id)) ?? row;
  const isOvertime = row.type === "overtime" || row.type === "holiday_work";
  const open = attendanceRequest.status === "pending";
  const warnings = isOvertime && open ? await overtimeWarningsFor(row.personId, row.startDate, minutesOfRequest(row.details), row.id) : [];
  const policy = row.type === "attendance_correction" && row.entityId ? await getAttendancePolicy(row.entityId, row.startDate) : null;
  return { ...view, attendanceRequest, warnings, correctionsUsed: policy ? await correctionsUsed(db(), row.personId, monthOf(row.startDate)) : null, correctionCap: policy?.monthlyCorrectionCap ?? null };
}

export type MyAttendanceRequest = AttendanceRequestRow & { approvalStatus: string | null };

export async function listAttendanceRequestsOf(personId: string, options: { from?: IsoDate; to?: IsoDate; limit?: number } = {}): Promise<MyAttendanceRequest[]> {
  await syncWithdrawn(db(), personId);
  const rows = await db()
    .select({ row: schema.attendanceRequest, approvalStatus: schema.approvalRequest.status })
    .from(schema.attendanceRequest)
    .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.attendanceRequest.approvalRequestId))
    .where(and(eq(schema.attendanceRequest.personId, personId), options.from ? gte(schema.attendanceRequest.endDate, options.from) : undefined, options.to ? lte(schema.attendanceRequest.startDate, options.to) : undefined))
    .orderBy(desc(schema.attendanceRequest.startDate), desc(schema.attendanceRequest.createdAt))
    .limit(options.limit ?? 50);
  return rows.map(({ row, approvalStatus }) => ({ ...row, approvalStatus }));
}

/** Approved overtime / holiday work whose hours nobody knows yet: the day is here, punches show no overtime, and the manager has not confirmed any. */
export async function listHoursToConfirm(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<AttendanceRequestRow[]> {
  if (personIds.length === 0 || to < from) return [];
  const rows = await executor
    .select({ row: schema.attendanceRequest, day: schema.timesheetDay })
    .from(schema.attendanceRequest)
    .leftJoin(schema.timesheetDay, and(eq(schema.timesheetDay.personId, schema.attendanceRequest.personId), eq(schema.timesheetDay.date, schema.attendanceRequest.startDate)))
    .where(and(inArray(schema.attendanceRequest.personId, [...personIds]), inArray(schema.attendanceRequest.type, ["overtime", "holiday_work"]), eq(schema.attendanceRequest.status, "approved"), gte(schema.attendanceRequest.startDate, from), lte(schema.attendanceRequest.startDate, to)))
    .orderBy(schema.attendanceRequest.startDate);
  return rows.filter(({ row, day }) => row.confirmedMinutes === null && !day?.lockedAt && (!day || day.otWeekdayMinutes + day.otWeekdayNightMinutes + day.otRestDayMinutes + day.otRestDayNightMinutes + day.otHolidayMinutes + day.otHolidayNightMinutes === 0)).map(({ row }) => row);
}
