// Phase 2 demo data for leave, called from seed-demo.ts. Idempotent: skipped once any leave
// request exists. Written straight into the tables the way the leave use-cases write them, with
// the amounts coming from the same pure engine the nightly job uses — so that job finds nothing
// left to post. August 2026 is the full demo month, September the running one.
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { approvalAssignee, approvalEvent, approvalRequest, approvalStep, calendarDay, contract, employment, leaveLedgerEntry, leavePolicy, leaveRequest, leaveRequestDay, leaveType, lifecycleEvent, person, statutoryParameter, teamStaffingRule } from "../src/lib/db/schema";
import { accrualPostings, type PolicyRules, terminationPayout } from "../src/modules/leave/engine/entitlement";
import { leaveSeedRows } from "../src/modules/leave/seed-types";

type Db = ReturnType<typeof drizzle>;
type Portion = "full" | "am" | "pm";
type Demo = { who: string; type: string; from: string; to: string; startPortion?: Portion; endPortion?: Portion; reason: string; status: "approved" | "pending" | "rejected"; filed: string; decided?: string; comment?: string };

const YEAR = 2026;
const day = (date: string) => new Date(`${date}T00:00:00Z`);
const formatDay = (date: string) => date.split("-").reverse().join("/");
const eachDate = (from: string, to: string) => {
  const dates: string[] = [];
  for (let cursor = day(from); cursor.toISOString().slice(0, 10) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
};

// Carried over from 2025, as an HR spreadsheet would have it (people who were on the books then).
const CARRIED: Record<string, number> = { "Trần Đình Khánh": 500, "Nguyễn Thu Hà": 350, "Lê Thị Mai": 200, "Võ Minh Tuấn": 0, "Đặng Hoàng Long": 450, "Bùi Thanh Tâm": 100, "Hồ Gia Huy": 300, "Trần Quỳnh Như": 150, "Vũ Hải Nam": 50, "Phạm Quốc Bảo": 250, "Dương Thùy Chi": 500, "Lý Minh Khôi": 0, "Phan Văn Đức": 400, "Huỳnh Mỹ Duyên": 100, "Vũ Hải Đăng": 200 };

const REQUESTS: Demo[] = [
  { who: "Lê Thị Mai", type: "ANNUAL", from: "2026-08-05", to: "2026-08-05", startPortion: "am", reason: "Họp phụ huynh", status: "approved", filed: "2026-07-30", decided: "2026-07-31" },
  { who: "Hồ Gia Huy", type: "ANNUAL", from: "2026-08-10", to: "2026-08-11", reason: "Về quê", status: "approved", filed: "2026-08-03", decided: "2026-08-04" },
  { who: "Võ Minh Tuấn", type: "BIRTHDAY", from: "2026-08-14", to: "2026-08-14", reason: "Sinh nhật", status: "approved", filed: "2026-08-10", decided: "2026-08-10" },
  { who: "Trần Quỳnh Như", type: "ANNUAL", from: "2026-08-17", to: "2026-08-21", reason: "Du lịch gia đình", status: "approved", filed: "2026-08-03", decided: "2026-08-05" },
  { who: "Vũ Hải Nam", type: "SICK", from: "2026-08-25", to: "2026-08-26", reason: "Sốt siêu vi, có giấy của bệnh viện", status: "approved", filed: "2026-08-25", decided: "2026-08-27" },
  { who: "Dương Thùy Chi", type: "ANNUAL", from: "2026-08-28", to: "2026-08-28", reason: "Khám thai", status: "approved", filed: "2026-08-20", decided: "2026-08-21" },
  { who: "Hồ Gia Huy", type: "ANNUAL", from: "2026-09-04", to: "2026-09-04", startPortion: "pm", reason: "Việc gia đình", status: "approved", filed: "2026-08-31", decided: "2026-09-01" },
  { who: "Lý Minh Khôi", type: "UNPAID", from: "2026-09-10", to: "2026-09-11", reason: "Việc riêng", status: "approved", filed: "2026-09-03", decided: "2026-09-04" },
  { who: "Dương Thùy Chi", type: "MATERNITY", from: "2026-09-14", to: "2027-03-13", reason: "Nghỉ thai sản 6 tháng", status: "approved", filed: "2026-08-10", decided: "2026-08-12" },
  { who: "Phan Văn Đức", type: "ANNUAL", from: "2026-09-24", to: "2026-09-25", reason: "Nghỉ ngơi", status: "rejected", filed: "2026-09-14", decided: "2026-09-15", comment: "Tuần đó chạy chiến dịch ra mắt, em dời sang đầu tháng 10 nhé." },
  // Approved and still ahead: what the workload view (Phase 3) takes off a person's capacity.
  { who: "Bùi Thanh Tâm", type: "ANNUAL", from: "2026-09-28", to: "2026-09-30", endPortion: "am", reason: "Đưa gia đình đi Đà Lạt", status: "approved", filed: "2026-09-10", decided: "2026-09-11" },
  { who: "Hồ Gia Huy", type: "ANNUAL", from: "2026-10-02", to: "2026-10-02", reason: "Đi đám cưới bạn", status: "pending", filed: "2026-09-18" },
  { who: "Vũ Hải Nam", type: "ANNUAL", from: "2026-10-12", to: "2026-10-16", reason: "Về quê cưới em gái", status: "pending", filed: "2026-09-17" },
];

export async function seedLeave(db: Db, today: string): Promise<string> {
  // Leave types normally come from `pnpm db:seed`; the demo does not depend on the order.
  if ((await db.select({ id: leaveType.id }).from(leaveType).limit(1)).length === 0) {
    for (const seed of leaveSeedRows()) {
      const [created] = await db.insert(leaveType).values(seed.type).returning();
      if (seed.policy) await db.insert(leavePolicy).values({ ...seed.policy, leaveTypeId: created.id });
    }
  }
  if ((await db.select({ id: leaveRequest.id }).from(leaveRequest).limit(1)).length > 0) return "leave: already seeded, skipped";

  const types = new Map((await db.select().from(leaveType).where(isNull(leaveType.entityId))).map((row) => [row.code, row]));
  const policies = await db.select().from(leavePolicy).where(isNull(leavePolicy.entityId));
  const [parameter] = await db.select().from(statutoryParameter).where(and(eq(statutoryParameter.key, "leave.annual"), eq(statutoryParameter.status, "approved"))).limit(1);
  const annual = types.get("ANNUAL");
  if (!annual || !parameter) return "leave: leave types or the leave.annual parameter missing (run pnpm db:seed), skipped";
  const statutory = parameter.value as { baseDays: number; yearsOfServicePerExtraDay: number };

  const people = await db.select().from(person);
  const byName = new Map(people.map((row) => [row.fullName, row]));
  const employments = await db.select().from(employment);
  const probations = await db.select().from(contract).where(eq(contract.type, "probation"));
  const holidays = await db.select().from(calendarDay);

  // 1. Opening balances (carried from 2025) and everything the accrual job would have posted by today.
  let ledgerRows = 0;
  for (const row of people) {
    const latest = employments.filter((candidate) => candidate.personId === row.id).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (!latest || latest.startDate > today) continue;
    const onContract = probations.filter((candidate) => candidate.personId === row.id && candidate.employmentId === latest.id && !candidate.deletedAt).map((candidate) => ({ start: candidate.startDate, end: candidate.terminatedOn ?? candidate.endDate }));
    const facts = { startDate: latest.startDate, seniorityDate: latest.seniorityDate, endDate: latest.endDate, probation: onContract.length === 0 && row.workforceType === "probation" ? [{ start: latest.startDate, end: null }] : onContract };

    for (const type of types.values()) {
      if (!type.tracksBalance || (type.eligibleWorkforceTypes && !type.eligibleWorkforceTypes.includes(row.workforceType))) continue;
      const policy = policies.find((candidate) => candidate.leaveTypeId === type.id);
      if (!policy) continue;
      const rules: PolicyRules = { ...policy };
      const base = { personId: row.id, entityId: row.primaryEntityId, leaveTypeId: type.id, leaveYear: YEAR };
      let balance = 0;
      const carried = type.code === "ANNUAL" ? (CARRIED[row.fullName] ?? 0) : 0;
      if (carried > 0 && latest.startDate < `${YEAR}-01-01`) {
        await db.insert(leaveLedgerEntry).values({ ...base, kind: "opening", amountCenti: carried, effectiveDate: `${YEAR}-01-01`, sourceKey: `opening:${row.id}:${type.id}:${YEAR}`, reason: "Số dư chuyển từ năm 2025 (bảng theo dõi phép)" });
        balance += carried;
        ledgerRows++;
      }
      for (const posting of accrualPostings({ year: YEAR, asOf: today, statutory, employment: facts, openingDate: carried > 0 ? `${YEAR}-01-01` : null, policyAt: (date) => (date >= policy.validFrom ? rules : null), given: [] })) {
        await db.insert(leaveLedgerEntry).values({ ...base, kind: posting.kind, amountCenti: posting.amountCenti, effectiveDate: posting.effectiveDate, sourceKey: [posting.kind, row.id, type.id, YEAR, posting.effectiveDate].join(":"), reason: posting.trace.join("; ") });
        balance += posting.amountCenti;
        ledgerRows++;
      }
      // Someone who has left is paid their unused days (the former employee of the demo).
      const payout = latest.endDate && latest.endDate < today ? terminationPayout(balance, rules) : 0;
      if (payout > 0) {
        await db.insert(leaveLedgerEntry).values({ ...base, kind: "payout", amountCenti: -payout, effectiveDate: latest.endDate!, sourceKey: ["payout", row.id, type.id, latest.id].join(":"), reason: "Thanh toán ngày phép chưa nghỉ khi nghỉ việc" });
        ledgerRows++;
      }
    }
  }

  // 2. Requests: a realistic August and September, two waiting, one rejected, a maternity leave under way.
  const owners = people.filter((row) => row.workEmail === "owner@suzu.vn");
  let requests = 0;
  for (const demo of REQUESTS) {
    const requester = byName.get(demo.who);
    const type = types.get(demo.type);
    if (!requester || !type) continue;
    const manager = people.find((row) => row.id === requester.managerId) ?? owners[0];
    if (!manager) continue;
    const off = new Set(holidays.filter((row) => row.kind !== "working_override" && (row.entityId === null || row.entityId === requester.primaryEntityId)).map((row) => row.date));
    const dates = eachDate(demo.from, demo.to).filter((date) => {
      const weekday = day(date).getUTCDay();
      return !off.has(date) && (weekday >= 1 && weekday <= 5 ? true : weekday === 6 && type.countsUntrackedDays);
    });
    const single = demo.from === demo.to;
    const days = dates.map((date, index) => {
      const portion: Portion = single ? (demo.startPortion ?? "full") : index === 0 ? (demo.startPortion ?? "full") : index === dates.length - 1 ? (demo.endPortion ?? "full") : "full";
      return { date, portion, amountCenti: portion === "full" ? 100 : 50 };
    });
    const totalCenti = days.reduce((sum, row) => sum + row.amountCenti, 0);

    // The default flow: line manager, then the department head for more than three days —
    // skipped when that is the same person, as the engine does.
    const head = requester.fullName === "Vũ Hải Nam" ? byName.get("Đặng Hoàng Long") : undefined;
    const twoSteps = totalCenti > 300 && !!head && head.id !== manager.id;
    const flow = { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }, { key: "department_head", mode: "any", approvers: [{ rule: "department_head" }], condition: { field: "days", op: "gt", value: 3 } }] };
    const leaveRequestId = randomUUID();
    const approvalId = randomUUID();
    const range = single ? formatDay(demo.from) : `${formatDay(demo.from)} – ${formatDay(demo.to)}`;
    const decidedAt = demo.decided ? new Date(`${demo.decided}T03:00:00Z`) : null;

    let lifecycleEventId: string | null = null;
    if (type.isLongTerm && demo.status === "approved") {
      const latest = employments.filter((candidate) => candidate.personId === requester.id).sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
      if (latest) {
        const [event] = await db.insert(lifecycleEvent).values({ personId: requester.id, employmentId: latest.id, entityId: latest.entityId, type: "long_leave", effectiveDate: demo.from, status: "applied", reason: type.name, details: { from: demo.from, to: demo.to, source: "leave_request" }, createdByPersonId: manager.id }).returning();
        lifecycleEventId = event.id;
      }
    }

    await db.insert(approvalRequest).values({
      id: approvalId,
      type: "leave",
      entityId: requester.primaryEntityId,
      requesterPersonId: requester.id,
      subjectPersonId: requester.id,
      subjectType: "leave_request",
      subjectId: leaveRequestId,
      summary: `${type.name}: ${range} (${String(totalCenti / 100).replace(".", ",")} ngày)`,
      payload: { leaveRequestId, typeCode: type.code, typeName: type.name, startDate: demo.from, endDate: demo.to, days: totalCenti / 100 },
      status: demo.status,
      currentStep: 0,
      flowSnapshot: { definition: flow, source: "default", resolved: [{ key: "manager", mode: "any", applies: true, approverIds: [manager.id] }, { key: "department_head", mode: "any", applies: twoSteps, approverIds: twoSteps ? [head!.id] : [] }] },
      link: `/approvals/leave/${approvalId}`,
      decidedAt,
      createdAt: new Date(`${demo.filed}T02:00:00Z`),
    });
    const answered = demo.status === "approved" ? "approved" : demo.status === "rejected" ? "rejected" : "pending";
    const [first] = await db.insert(approvalStep).values({ requestId: approvalId, stepIndex: 0, key: "manager", mode: "any", status: answered }).returning();
    await db.insert(approvalAssignee).values({ stepId: first.id, requestId: approvalId, approverPersonId: manager.id, status: answered, comment: demo.comment ?? null, decidedAt });
    const [second] = await db.insert(approvalStep).values({ requestId: approvalId, stepIndex: 1, key: "department_head", mode: "any", status: twoSteps ? "waiting" : "skipped" }).returning();
    if (twoSteps) await db.insert(approvalAssignee).values({ stepId: second.id, requestId: approvalId, approverPersonId: head!.id });
    await db.insert(approvalEvent).values({ requestId: approvalId, type: "submitted", actorPersonId: requester.id, stepIndex: 0, at: new Date(`${demo.filed}T02:00:00Z`) });
    if (decidedAt) await db.insert(approvalEvent).values({ requestId: approvalId, type: demo.status === "approved" ? "approved" : "rejected", actorPersonId: manager.id, stepIndex: 0, comment: demo.comment ?? null, at: decidedAt });

    await db.insert(leaveRequest).values({ id: leaveRequestId, personId: requester.id, entityId: requester.primaryEntityId, leaveTypeId: type.id, startDate: demo.from, endDate: demo.to, startPortion: demo.startPortion ?? "full", endPortion: single ? (demo.startPortion ?? "full") : (demo.endPortion ?? "full"), totalCenti, reason: demo.reason, status: demo.status, approvalRequestId: approvalId, filedByPersonId: requester.id, lifecycleEventId, decidedAt, createdAt: new Date(`${demo.filed}T02:00:00Z`) });
    await db.insert(leaveRequestDay).values(days.map((row) => ({ requestId: leaveRequestId, personId: requester.id, date: row.date, portion: row.portion, amountCenti: row.amountCenti })));

    if (demo.status === "approved" && type.tracksBalance) {
      const byYear = new Map<number, typeof days>();
      for (const row of days) byYear.set(Number(row.date.slice(0, 4)), [...(byYear.get(Number(row.date.slice(0, 4))) ?? []), row]);
      for (const [year, rows] of byYear) {
        await db.insert(leaveLedgerEntry).values({ personId: requester.id, entityId: requester.primaryEntityId, leaveTypeId: type.id, leaveYear: year, kind: "use", amountCenti: -rows.reduce((sum, row) => sum + row.amountCenti, 0), effectiveDate: rows[0].date, sourceKey: `use:${leaveRequestId}:${year}`, requestId: leaveRequestId, reason: `${formatDay(demo.from)} – ${formatDay(demo.to)}`, createdByPersonId: manager.id });
        ledgerRows++;
      }
    }
    requests++;
  }

  // 3. Minimum staffing for the video department at Media: the pending five-day request shows the warning.
  const long = byName.get("Đặng Hoàng Long");
  if (long?.departmentId && long.primaryEntityId) await db.insert(teamStaffingRule).values({ entityId: long.primaryEntityId, departmentId: long.departmentId, teamId: null, minPresent: 7 }).onConflictDoNothing();

  return `leave: ${ledgerRows} ledger rows (opening balances, accruals to ${today}, uses, a payout), ${requests} requests`;
}
