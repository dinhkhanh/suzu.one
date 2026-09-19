// Leave requests (FR-LVE-04, 05, 08) on the approval engine: preview, file, decide, cancel, amend.
// The approval decision and its effect — the ledger rows, the lifecycle event of a long absence —
// happen in one transaction.
import "server-only";
import { and, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { getDayPlans, requestTimesheetRecompute } from "@/modules/attendance/service";
import { cancelLongLeave, type EmploymentFacts, listEmploymentFacts, recordLongLeave } from "@/modules/core-hr/service";
import { decideRequest, defineRequestType, getRequest, type RequestView, submitRequest, withdrawRequest } from "@/modules/platform/approvals/service";
import { notify } from "@/modules/platform/notifications/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { isOnProbation } from "./engine/entitlement";
import { checkLeaveRequest, type CountResult, countLeaveDays, type Portion, staffingShortfalls } from "./engine/request";
import { balanceOf, getBalances, postEntry } from "./ledger";
import { type LeaveTypeRow, leaveTypesFor, listPolicies, policyOn, staffingRuleFor } from "./types";

type Executor = Tx | ReturnType<typeof db>;
export type LeaveRequestRow = typeof schema.leaveRequest.$inferSelect;

export const leaveRequestType = defineRequestType({
  type: "leave",
  // FR-PLT-21's own example: more than three days also needs the department head. Administrators
  // can replace this per entity on /admin/approval-flows; `days` is what conditions test.
  flow: {
    steps: [
      { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
      { key: "department_head", mode: "any", approvers: [{ rule: "department_head" }], condition: { field: "days", op: "gt", value: 3 } },
    ],
  },
  conditionFields: ["days"],
  bulkApprovable: () => true,
  // HR follows the leave of the people they look after.
  canView: (viewer, subject) => !!subject && can(viewer, "leave:manage", subject),
});

export type LeaveInput = { leaveTypeId: string; startDate: IsoDate; endDate: IsoDate; startPortion: Portion; endPortion: Portion; minutes: number | null; reason: string | null; attachmentFileId: string | null };
export type LeavePayload = { leaveRequestId: string; typeCode: string; typeName: string; startDate: IsoDate; endDate: IsoDate; days: number };

const MAX_SPAN_DAYS = 400;
const formatDay = (date: IsoDate) => date.split("-").reverse().join("/");
const formatDays = (centi: number) => String(centi / 100).replace(".", ",");

// The generic "withdraw" of the approval engine knows nothing of leave: a request it ended is
// marked here the next time the person's leave is touched. Pending days are always read through
// the approval request's status, so nothing is reserved in the meantime.
async function syncWithdrawn(executor: Executor, personId: string): Promise<void> {
  await executor.execute(sql`
    update leave_request set status = 'withdrawn', updated_at = now()
    from approval_request
    where approval_request.id = leave_request.approval_request_id and leave_request.person_id = ${personId}
      and leave_request.status = 'pending' and approval_request.status in ('withdrawn', 'cancelled')`);
}

// ── Preview: what a request would cost, and whom it would leave short ───────────────────────

export type TeamConflicts = { colleaguesAway: { name: string; dates: IsoDate[] }[]; shortfalls: { date: IsoDate; present: number; minPresent: number }[] };
export type LeavePreview = { type: LeaveTypeRow; counted: CountResult; problems: string[]; availableByYear: Record<number, number>; conflicts: TeamConflicts };

async function facts(executor: Executor, personId: string): Promise<EmploymentFacts> {
  const [row] = await listEmploymentFacts({ personIds: [personId] }, executor);
  if (!row) throw new ActionError("person_not_found");
  return row;
}

/** Colleagues of the same group (team, or department within the entity) away on those dates, and minimum staffing. */
// The head count uses pending requests too; names of people whose leave is not approved yet are for the approver only.
async function teamConflicts(executor: Executor, person: EmploymentFacts, dates: readonly IsoDate[], options: { namePending: boolean }): Promise<TeamConflicts> {
  if (dates.length === 0 || (!person.teamId && !person.departmentId)) return { colleaguesAway: [], shortfalls: [] };
  const group = await executor
    .select({ id: schema.person.id, fullName: schema.person.fullName })
    .from(schema.person)
    .where(and(eq(schema.person.status, "active"), ne(schema.person.id, person.personId), person.teamId ? eq(schema.person.teamId, person.teamId) : and(eq(schema.person.departmentId, person.departmentId!), person.entityId ? eq(schema.person.primaryEntityId, person.entityId) : undefined)));
  if (group.length === 0) return { colleaguesAway: [], shortfalls: [] };
  const away = await leaveDayRows(executor, group.map((row) => row.id), dates[0], dates.at(-1)!, { includePending: true });
  const onDates = away.filter((row) => dates.includes(row.date) && row.portion !== "hours");
  const colleaguesAway = group.map((colleague) => ({ name: colleague.fullName, dates: onDates.filter((row) => row.personId === colleague.id && (options.namePending || row.status === "approved")).map((row) => row.date) })).filter((row) => row.dates.length > 0);
  const rule = staffingRuleFor(await executor.select().from(schema.teamStaffingRule), person);
  const awayByDate: Record<IsoDate, number> = {};
  for (const row of onDates) awayByDate[row.date] = (awayByDate[row.date] ?? 0) + 1;
  const shortfalls = rule ? staffingShortfalls({ dates, headcount: group.length + 1, minPresent: rule.minPresent, awayByDate }).map((row) => ({ ...row, minPresent: rule.minPresent })) : [];
  return { colleaguesAway, shortfalls };
}

export async function previewLeave(personId: string, input: LeaveInput, options: { filedByHr?: boolean; ignoreRequestId?: string | null; executor?: Executor } = {}): Promise<LeavePreview> {
  const executor = options.executor ?? db();
  const person = await facts(executor, personId);
  const type = (await leaveTypesFor(person.entityId, executor, { includeInactive: true })).find((row) => row.id === input.leaveTypeId);
  if (!type) throw new ActionError("leave_type_not_found");
  if (input.endDate < input.startDate || (Date.parse(input.endDate) - Date.parse(input.startDate)) / 86_400_000 > MAX_SPAN_DAYS) throw new ActionError("leave_dates_invalid");

  const plans = (await getDayPlans([personId], input.startDate, input.endDate, executor)).get(personId)?.days ?? [];
  const counted = countLeaveDays({ days: plans, startPortion: input.startPortion, endPortion: input.endPortion, minutes: input.minutes, countsUntracked: type.countsUntrackedDays });
  const years = [...new Set([Number(input.startDate.slice(0, 4)), Number(input.endDate.slice(0, 4))])];
  const availableByYear: Record<number, number> = {};
  for (const year of years) availableByYear[year] = (await getBalances([personId], year, executor)).get(personId)?.find((row) => row.leaveTypeId === type.id)?.availableCenti ?? 0;
  const existing = (await leaveDayRows(executor, [personId], input.startDate, input.endDate, { includePending: true })).filter((row) => row.requestId !== options.ignoreRequestId);
  // The request being replaced gives its days back first.
  if (options.ignoreRequestId && type.tracksBalance) {
    const replaced = await executor.select().from(schema.leaveRequestDay).innerJoin(schema.leaveRequest, eq(schema.leaveRequest.id, schema.leaveRequestDay.requestId)).where(and(eq(schema.leaveRequestDay.requestId, options.ignoreRequestId), eq(schema.leaveRequest.leaveTypeId, type.id)));
    for (const row of replaced) {
      const year = Number(row.leave_request_day.date.slice(0, 4));
      if (year in availableByYear) availableByYear[year] += row.leave_request_day.amountCenti;
    }
  }
  const policy = type.tracksBalance ? policyOn(await listPolicies([type.id], executor), type.id, person.entityId, input.startDate) : null;

  const problems = checkLeaveRequest({
    type: { ...type, gender: type.gender },
    policy,
    person: {
      workforceType: person.workforceType,
      gender: person.gender,
      seniorityDate: person.seniorityDate,
      employmentStart: person.startDate,
      employmentEnd: person.endDate,
      onProbationAtStart: person.workforceType === "probation" || (!!person.startDate && isOnProbation({ startDate: person.startDate, seniorityDate: person.seniorityDate ?? person.startDate, endDate: person.endDate, probation: person.probation }, input.startDate)),
    },
    filedOn: todayInVietnam(),
    filedByHr: !!options.filedByHr,
    startDate: input.startDate,
    endDate: input.endDate,
    counted,
    hasAttachment: !!input.attachmentFileId,
    availableByYear,
    existingDays: existing.map((row) => ({ date: row.date, portion: row.portion })),
  });
  const conflicts = await teamConflicts(executor, person, counted.days.map((day) => day.date), { namePending: !!options.filedByHr });
  return { type, counted, problems, availableByYear, conflicts };
}

// ── Filing ──────────────────────────────────────────────────────────────────────────────────

async function checkAttachment(executor: Executor, fileId: string | null, personId: string): Promise<void> {
  if (!fileId) return;
  const [file] = await executor.select().from(schema.storedFile).where(eq(schema.storedFile.id, fileId)).limit(1);
  if (!file || file.ownerType !== "leave_attachment" || file.ownerId !== personId || file.status !== "ready" || file.deletedAt) throw new ActionError("file_not_found");
}

/** The uploader's own leave attachment that still waits for its check — what the "complete" action may touch. */
export async function isPendingLeaveAttachment(fileId: string, uploaderPersonId: string): Promise<boolean> {
  const [file] = await db().select({ id: schema.storedFile.id }).from(schema.storedFile).where(and(eq(schema.storedFile.id, fileId), eq(schema.storedFile.ownerType, "leave_attachment"), eq(schema.storedFile.uploadedByPersonId, uploaderPersonId), eq(schema.storedFile.status, "pending"))).limit(1);
  return !!file;
}

async function submitInTransaction(tx: Tx, personId: string, input: LeaveInput, actor: { personId: string; isHr: boolean }, amendsRequestId: string | null): Promise<{ leaveRequest: LeaveRequestRow; approvalRequestId: string; outcome: string; conflicts: TeamConflicts }> {
  await syncWithdrawn(tx, personId);
  const person = await facts(tx, personId);
  if (!person.entityId) throw new ActionError("no_employment");
  await checkAttachment(tx, input.attachmentFileId, personId);
  const preview = await previewLeave(personId, input, { filedByHr: actor.isHr && actor.personId !== personId, executor: tx });
  if (preview.problems.length > 0) throw new ActionError(preview.problems[0], { problems: preview.problems });
  const { type, counted } = preview;

  const [leaveRequest] = await tx
    .insert(schema.leaveRequest)
    .values({ personId, entityId: person.entityId, leaveTypeId: type.id, startDate: input.startDate, endDate: input.endDate, startPortion: input.startPortion, endPortion: counted.days.length === 1 || input.startDate === input.endDate ? input.startPortion : input.endPortion, minutes: input.startPortion === "hours" ? input.minutes : null, totalCenti: counted.totalCenti, reason: input.reason, attachmentFileId: input.attachmentFileId, amendsRequestId, filedByPersonId: actor.personId })
    .returning();
  await tx.insert(schema.leaveRequestDay).values(counted.days.map((day) => ({ requestId: leaveRequest.id, personId, date: day.date, portion: day.portion, amountCenti: day.amountCenti, minutes: day.minutes })));

  const range = input.startDate === input.endDate ? formatDay(input.startDate) : `${formatDay(input.startDate)} – ${formatDay(input.endDate)}`;
  const payload: LeavePayload = { leaveRequestId: leaveRequest.id, typeCode: type.code, typeName: type.name, startDate: input.startDate, endDate: input.endDate, days: counted.totalCenti / 100 };
  const { request, outcome } = await submitRequest(tx, leaveRequestType, {
    entityId: person.entityId,
    requesterPersonId: actor.personId,
    subjectPersonId: personId,
    subjectType: "leave_request",
    subjectId: leaveRequest.id,
    // Read in the inbox and the notification, in Vietnamese like the other summaries.
    summary: `${type.name}: ${range} (${formatDays(counted.totalCenti)} ngày)`,
    payload,
    conditionData: { days: counted.totalCenti / 100, typeCode: type.code, category: type.category },
    link: (requestId) => `/approvals/leave/${requestId}`,
  });
  const [linked] = await tx.update(schema.leaveRequest).set({ approvalRequestId: request.id }).where(eq(schema.leaveRequest.id, leaveRequest.id)).returning();
  // A flow whose every step was skipped approves at once.
  if (outcome === "approved") await applyApproval(tx, linked, actor.personId);
  return { leaveRequest: linked, approvalRequestId: request.id, outcome, conflicts: preview.conflicts };
}

export async function submitLeave(personId: string, input: LeaveInput, actor: { personId: string; isHr: boolean }) {
  return db().transaction((tx) => submitInTransaction(tx, personId, input, actor, null));
}

// ── Deciding ────────────────────────────────────────────────────────────────────────────────

// Approved: the days leave the balance (one ledger row per leave year), a long absence goes on
// the person's timeline, and attendance is told that those days changed.
async function applyApproval(tx: Tx, request: LeaveRequestRow, actorPersonId: string): Promise<LeaveRequestRow> {
  const [type] = await tx.select().from(schema.leaveType).where(eq(schema.leaveType.id, request.leaveTypeId)).limit(1);
  const days = await tx.select().from(schema.leaveRequestDay).where(eq(schema.leaveRequestDay.requestId, request.id));
  if (type.tracksBalance) {
    const byYear = new Map<number, number>();
    for (const day of days) byYear.set(Number(day.date.slice(0, 4)), (byYear.get(Number(day.date.slice(0, 4))) ?? 0) + day.amountCenti);
    const policy = policyOn(await listPolicies([type.id], tx), type.id, request.entityId, request.startDate);
    for (const [year, amount] of byYear) {
      // The balance may have moved since the request was filed.
      if ((await balanceOf(tx, request.personId, type.id, year)) + (policy?.allowNegativeCenti ?? 0) < amount) throw new ActionError("leave_balance_insufficient");
      await postEntry(tx, { personId: request.personId, entityId: request.entityId, leaveTypeId: type.id, leaveYear: year, kind: "use", amountCenti: -amount, effectiveDate: days.filter((day) => day.date.startsWith(String(year)))[0].date, sourceKey: `use:${request.id}:${year}`, requestId: request.id, reason: `${formatDay(request.startDate)} – ${formatDay(request.endDate)}`, createdByPersonId: actorPersonId });
    }
  }
  let lifecycleEventId: string | null = null;
  if (type.isLongTerm) lifecycleEventId = (await recordLongLeave(tx, { personId: request.personId, from: request.startDate, to: request.endDate, leaveTypeName: type.name, approvalRequestId: request.approvalRequestId }, actorPersonId))?.eventId ?? null;
  const [after] = await tx.update(schema.leaveRequest).set({ status: "approved", decidedAt: new Date(), lifecycleEventId, updatedAt: new Date() }).where(eq(schema.leaveRequest.id, request.id)).returning();
  await requestTimesheetRecompute([request.personId], request.startDate, request.endDate, tx);
  return after;
}

async function requestByApproval(executor: Executor, approvalRequestId: string): Promise<LeaveRequestRow> {
  const [row] = await executor.select().from(schema.leaveRequest).where(eq(schema.leaveRequest.approvalRequestId, approvalRequestId)).limit(1);
  if (!row) throw new ActionError("approval_not_found");
  return row;
}

export async function decideLeave(actorPersonId: string, approvalRequestId: string, decision: { action: "approve" | "reject" | "return"; comment: string | null }) {
  return db().transaction(async (tx) => {
    const { request, before, outcome } = await decideRequest(tx, leaveRequestType, approvalRequestId, actorPersonId, decision);
    let leaveRequest = await requestByApproval(tx, approvalRequestId);
    if (outcome === "approved") leaveRequest = await applyApproval(tx, leaveRequest, actorPersonId);
    if (outcome === "rejected") [leaveRequest] = await tx.update(schema.leaveRequest).set({ status: "rejected", decidedAt: new Date(), updatedAt: new Date() }).where(eq(schema.leaveRequest.id, leaveRequest.id)).returning();
    return { request, before, outcome, leaveRequest };
  });
}

// ── Cancelling and amending ─────────────────────────────────────────────────────────────────

/**
 * Ends a request. Waiting for an answer: the requester takes it back. Approved: the days go back
 * to the balance — the person's own call until the leave starts, HR's afterwards.
 */
async function cancelInTransaction(tx: Tx, leaveRequestId: string, actor: { personId: string; isHr: boolean }, reason: string | null): Promise<{ before: LeaveRequestRow; after: LeaveRequestRow }> {
  const [before] = await tx.select().from(schema.leaveRequest).where(eq(schema.leaveRequest.id, leaveRequestId)).limit(1).for("update");
  if (!before) throw new ActionError("leave_request_not_found");
  const own = before.personId === actor.personId || before.filedByPersonId === actor.personId;

  if (before.status === "pending") {
    if (!before.approvalRequestId) throw new ActionError("leave_request_not_found");
    const [approval] = await tx.select().from(schema.approvalRequest).where(eq(schema.approvalRequest.id, before.approvalRequestId)).limit(1);
    // The engine lets only the requester withdraw; HR ends someone else's pending request by cancelling it outright.
    if (approval.requesterPersonId === actor.personId) await withdrawRequest(tx, before.approvalRequestId, actor.personId);
    else if (actor.isHr) {
      await tx.update(schema.approvalRequest).set({ status: "cancelled", decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(schema.approvalRequest.id, before.approvalRequestId), inArray(schema.approvalRequest.status, ["pending", "returned"])));
      await tx.insert(schema.approvalEvent).values({ requestId: before.approvalRequestId, type: "cancelled", actorPersonId: actor.personId, stepIndex: approval.currentStep, comment: reason });
    } else throw new ActionError("leave_cancel_not_allowed");
    const [after] = await tx.update(schema.leaveRequest).set({ status: approval.requesterPersonId === actor.personId ? "withdrawn" : "cancelled", cancelledByPersonId: actor.personId, cancelReason: reason, updatedAt: new Date() }).where(eq(schema.leaveRequest.id, before.id)).returning();
    return { before, after };
  }

  if (before.status !== "approved") throw new ActionError("leave_request_not_open");
  const started = before.startDate <= todayInVietnam();
  if (!actor.isHr && (!own || started)) throw new ActionError(started ? "leave_cancel_started" : "leave_cancel_not_allowed");
  const uses = await tx.select().from(schema.leaveLedgerEntry).where(and(eq(schema.leaveLedgerEntry.requestId, before.id), eq(schema.leaveLedgerEntry.kind, "use")));
  for (const use of uses) {
    await postEntry(tx, { personId: use.personId, entityId: use.entityId, leaveTypeId: use.leaveTypeId, leaveYear: use.leaveYear, kind: "refund", amountCenti: -use.amountCenti, effectiveDate: use.effectiveDate, sourceKey: `refund:${before.id}:${use.leaveYear}`, requestId: before.id, reason: reason ?? "Huỷ đơn nghỉ phép", createdByPersonId: actor.personId });
  }
  if (before.lifecycleEventId) await cancelLongLeave(tx, before.lifecycleEventId);
  const [after] = await tx.update(schema.leaveRequest).set({ status: "cancelled", cancelledByPersonId: actor.personId, cancelReason: reason, updatedAt: new Date() }).where(eq(schema.leaveRequest.id, before.id)).returning();
  await requestTimesheetRecompute([before.personId], before.startDate, before.endDate, tx);
  if (actor.personId !== before.personId) await notify({ recipients: [before.personId], kind: "approvals.leave_cancelled", params: { range: `${formatDay(before.startDate)} – ${formatDay(before.endDate)}` }, link: "/leave" }, tx);
  return { before, after };
}

export async function cancelLeave(leaveRequestId: string, actor: { personId: string; isHr: boolean }, reason: string | null) {
  return db().transaction((tx) => cancelInTransaction(tx, leaveRequestId, actor, reason));
}

/** Changes a request by ending it and filing the new one in the same transaction: if the new one cannot be filed, the old one stands. */
export async function amendLeave(leaveRequestId: string, input: LeaveInput, actor: { personId: string; isHr: boolean }) {
  return db().transaction(async (tx) => {
    const [current] = await tx.select().from(schema.leaveRequest).where(eq(schema.leaveRequest.id, leaveRequestId)).limit(1);
    if (!current) throw new ActionError("leave_request_not_found");
    // The old request gives its days back first; the new one is then checked against the books as they stand.
    const { before } = await cancelInTransaction(tx, leaveRequestId, actor, "Thay bằng đơn mới");
    const filed = await submitInTransaction(tx, current.personId, input, actor, current.id);
    return { before, ...filed };
  });
}

// ── Reading ─────────────────────────────────────────────────────────────────────────────────

export type LeaveDayRow = { requestId: string; personId: string; date: IsoDate; portion: Portion; amountCenti: number; minutes: number | null; leaveTypeId: string; status: "pending" | "approved" };

async function leaveDayRows(executor: Executor, personIds: readonly string[], from: IsoDate, to: IsoDate, options: { includePending: boolean }): Promise<LeaveDayRow[]> {
  if (personIds.length === 0) return [];
  const rows = await executor
    .select({ day: schema.leaveRequestDay, leaveTypeId: schema.leaveRequest.leaveTypeId, status: schema.leaveRequest.status, approvalStatus: schema.approvalRequest.status })
    .from(schema.leaveRequestDay)
    .innerJoin(schema.leaveRequest, eq(schema.leaveRequest.id, schema.leaveRequestDay.requestId))
    .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.leaveRequest.approvalRequestId))
    .where(and(inArray(schema.leaveRequestDay.personId, [...personIds]), gte(schema.leaveRequestDay.date, from), lte(schema.leaveRequestDay.date, to), inArray(schema.leaveRequest.status, options.includePending ? ["approved", "pending"] : ["approved"])));
  return rows
    .filter((row) => row.status === "approved" || row.approvalStatus === "pending" || row.approvalStatus === "returned")
    .map((row) => ({ requestId: row.day.requestId, personId: row.day.personId, date: row.day.date, portion: row.day.portion, amountCenti: row.day.amountCenti, minutes: row.day.minutes, leaveTypeId: row.leaveTypeId, status: row.status as "pending" | "approved" }));
}

export type LeaveOnDay = { personId: string; date: IsoDate; portion: Portion; amountCenti: number; minutes: number | null; leaveTypeId: string; typeCode: string; category: LeaveTypeRow["category"]; isPaid: boolean; payrollTreatment: LeaveTypeRow["payrollTreatment"]; requestId: string };

/** Approved leave on the given days — what the timesheet engine and payroll read. */
export async function getLeaveOnDays(personIds: readonly string[], from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<LeaveOnDay[]> {
  const rows = await leaveDayRows(executor, personIds, from, to, { includePending: false });
  if (rows.length === 0) return [];
  const types = new Map((await executor.select().from(schema.leaveType).where(inArray(schema.leaveType.id, [...new Set(rows.map((row) => row.leaveTypeId))]))).map((type) => [type.id, type]));
  return rows
    .map((row) => {
      const type = types.get(row.leaveTypeId)!;
      return { personId: row.personId, date: row.date, portion: row.portion, amountCenti: row.amountCenti, minutes: row.minutes, leaveTypeId: type.id, typeCode: type.code, category: type.category, isPaid: type.isPaid, payrollTreatment: type.payrollTreatment, requestId: row.requestId };
    })
    .sort((a, b) => (a.date === b.date ? a.personId.localeCompare(b.personId) : a.date.localeCompare(b.date)));
}

export type LeaveUsage = { personId: string; leaveTypeId: string; typeCode: string; payrollTreatment: LeaveTypeRow["payrollTreatment"]; isPaid: boolean; daysCenti: number };

/** Approved leave taken in a period, per person and type, with how payroll treats it. Scope: some people, or a whole entity. */
export async function getLeaveUsage(scope: { personIds: readonly string[] } | { entityId: string }, from: IsoDate, to: IsoDate, executor: Executor = db()): Promise<LeaveUsage[]> {
  const personIds = "personIds" in scope ? scope.personIds : (await executor.selectDistinct({ personId: schema.leaveRequest.personId }).from(schema.leaveRequest).where(and(eq(schema.leaveRequest.entityId, scope.entityId), eq(schema.leaveRequest.status, "approved"), lte(schema.leaveRequest.startDate, to), gte(schema.leaveRequest.endDate, from)))).map((row) => row.personId);
  const usage = new Map<string, LeaveUsage>();
  for (const day of await getLeaveOnDays(personIds, from, to, executor)) {
    const key = `${day.personId}:${day.leaveTypeId}`;
    const row = usage.get(key) ?? { personId: day.personId, leaveTypeId: day.leaveTypeId, typeCode: day.typeCode, payrollTreatment: day.payrollTreatment, isPaid: day.isPaid, daysCenti: 0 };
    row.daysCenti += day.amountCenti;
    usage.set(key, row);
  }
  return [...usage.values()];
}

export type MyLeaveRequest = LeaveRequestRow & { typeName: string; typeCode: string; approvalStatus: string | null };

export async function listLeaveRequestsOf(personId: string, limit = 50): Promise<MyLeaveRequest[]> {
  await syncWithdrawn(db(), personId);
  const rows = await db()
    .select({ request: schema.leaveRequest, typeName: schema.leaveType.name, typeCode: schema.leaveType.code, approvalStatus: schema.approvalRequest.status })
    .from(schema.leaveRequest)
    .innerJoin(schema.leaveType, eq(schema.leaveType.id, schema.leaveRequest.leaveTypeId))
    .leftJoin(schema.approvalRequest, eq(schema.approvalRequest.id, schema.leaveRequest.approvalRequestId))
    .where(eq(schema.leaveRequest.personId, personId))
    .orderBy(desc(schema.leaveRequest.startDate), desc(schema.leaveRequest.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row.request, typeName: row.typeName, typeCode: row.typeCode, approvalStatus: row.approvalStatus }));
}

export async function findLeaveRequest(id: string): Promise<LeaveRequestRow | undefined> {
  const [row] = await db().select().from(schema.leaveRequest).where(eq(schema.leaveRequest.id, id)).limit(1);
  return row;
}

export type LeaveRequestView = RequestView & { leaveRequest: LeaveRequestRow; type: LeaveTypeRow; days: { date: IsoDate; portion: Portion; amountCenti: number }[]; balance: { balanceCenti: number; pendingCenti: number } | null; conflicts: TeamConflicts };

/** The request page: the engine's view plus the leave itself, the balance it draws on and who else is away. null = not the viewer's business. */
export async function getLeaveRequestView(viewer: { personId: string; principal: Principal }, approvalRequestId: string): Promise<LeaveRequestView | null> {
  const view = await getRequest(viewer, leaveRequestType, approvalRequestId);
  if (!view) return null;
  const leaveRequest = await requestByApproval(db(), approvalRequestId).catch(() => null);
  if (!leaveRequest) return null;
  const [[type], days, person] = await Promise.all([
    db().select().from(schema.leaveType).where(eq(schema.leaveType.id, leaveRequest.leaveTypeId)).limit(1),
    db().select().from(schema.leaveRequestDay).where(eq(schema.leaveRequestDay.requestId, leaveRequest.id)).orderBy(schema.leaveRequestDay.date),
    facts(db(), leaveRequest.personId),
  ]);
  const balances = type.tracksBalance ? (await getBalances([leaveRequest.personId], Number(leaveRequest.startDate.slice(0, 4)))).get(leaveRequest.personId) : undefined;
  const balance = balances?.find((row) => row.leaveTypeId === type.id) ?? null;
  const conflicts = await teamConflicts(db(), person, days.map((day) => day.date), { namePending: !view.isRequester || view.canDecide });
  return { ...view, leaveRequest, type, days: days.map((day) => ({ date: day.date, portion: day.portion, amountCenti: day.amountCenti })), balance: balance ? { balanceCenti: balance.balanceCenti, pendingCenti: balance.pendingCenti } : null, conflicts };
}
