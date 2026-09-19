// Phase 2 week 5 demo data, called from seed-demo.ts after the punches: attendance requests and
// the August 2026 monthly timesheets. After it (and `pnpm db:recompute`):
//   · SZM's August is approved throughout — HR can lock it with one click (Long's overtime taken
//     as time off reaches the leave ledger at that moment);
//   · SZC's August still has blockers: Khôi's missing check-out waits on a pending correction,
//     Đức's month is confirmed but not approved, Khôi's is open;
//   · SZG is half-way; September is open with fresh anomalies and the 2/9 holiday-work requests.
// Skipped once any attendance request exists.
import { randomUUID } from "node:crypto";
import { and, eq, gte, lt } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { approvalAssignee, approvalEvent, approvalRequest, approvalStep, attendanceRequest, person, punch, timesheetMonth } from "../src/lib/db/schema";
import type { AttendanceRequestDetails } from "../src/modules/attendance/schema";

type Db = ReturnType<typeof drizzle>;
type Status = "pending" | "approved" | "rejected";
type Demo = { who: string; from: string; to?: string; details: AttendanceRequestDetails; reason: string; status: Status; filed: string; decided?: string; comment?: string; compensation?: "pay" | "time_off"; confirmedMinutes?: number; /** WFH without punches: the clock rows of those days are removed. */ clearPunches?: boolean };

const correction = (inTime: string | null, outTime: string | null, cause: "forgot" | "device_error" = "forgot"): AttendanceRequestDetails => ({ type: "attendance_correction", cause, inTime, outTime, outNextDay: false });
const formatDay = (date: string) => date.split("-").reverse().join("/");

const REQUESTS: Demo[] = [
  // August — what repairs the scripted anomalies.
  { who: "Hồ Gia Huy", from: "2026-08-20", details: correction(null, "17:35"), reason: "Quên chấm công khi về, có họp với khách đến 17:30", status: "approved", filed: "2026-08-21", decided: "2026-08-21" },
  { who: "Đỗ Khánh Linh", from: "2026-08-31", details: correction("08:28", null, "device_error"), reason: "Máy chấm công không nhận vân tay buổi sáng", status: "approved", filed: "2026-09-01", decided: "2026-09-01" },
  { who: "Lý Minh Khôi", from: "2026-08-12", details: correction(null, "18:05"), reason: "Quên chấm công khi về", status: "pending", filed: "2026-09-03" },
  { who: "Phan Văn Đức", from: "2026-08-24", details: correction("08:30", "17:30"), reason: "Đi gặp khách cả ngày, không về văn phòng", status: "rejected", filed: "2026-08-25", decided: "2026-08-26", comment: "Không có lịch gặp khách ngày này. Nếu nghỉ, vui lòng tạo đơn nghỉ phép." },
  { who: "Hồ Gia Huy", from: "2026-08-27", details: { type: "overtime", from: "17:30", to: "19:45" }, reason: "Dựng phim kịp hạn giao khách", status: "approved", filed: "2026-08-27", decided: "2026-08-27", compensation: "pay" },
  { who: "Đặng Hoàng Long", from: "2026-08-13", details: { type: "overtime", from: "17:30", to: "20:15" }, reason: "Duyệt bản dựng cuối cùng với khách", status: "approved", filed: "2026-08-12", decided: "2026-08-12", compensation: "time_off" },
  { who: "Võ Minh Tuấn", from: "2026-08-16", details: { type: "holiday_work", from: "09:00", to: "13:00" }, reason: "Hỗ trợ sự kiện ra mắt sản phẩm ngày Chủ nhật", status: "approved", filed: "2026-08-14", decided: "2026-08-14", compensation: "pay", confirmedMinutes: 240 },
  { who: "Trần Quỳnh Như", from: "2026-08-07", details: { type: "remote_work", kind: "wfh", portion: "full", locationName: null, latitude: null, longitude: null, radiusM: null }, reason: "Sửa điện nước tại nhà, làm việc trực tuyến", status: "approved", filed: "2026-08-05", decided: "2026-08-05", clearPunches: true },
  { who: "Nguyễn Văn Đạt", from: "2026-08-10", to: "2026-08-11", details: { type: "remote_work", kind: "off_site", portion: "full", locationName: "Phim trường Thủ Đức", latitude: 10.8494, longitude: 106.7717, radiusM: 400 }, reason: "Quay TVC cho khách hàng", status: "approved", filed: "2026-08-07", decided: "2026-08-07" },
  // September — still moving.
  { who: "Đặng Hoàng Long", from: "2026-09-02", details: { type: "holiday_work", from: "09:00", to: "15:00" }, reason: "Trực sự kiện Quốc khánh của khách hàng", status: "approved", filed: "2026-08-31", decided: "2026-08-31", compensation: "pay" },
  { who: "Bùi Thanh Tâm", from: "2026-09-02", details: { type: "holiday_work", from: "07:00", to: "15:30" }, reason: "Ca quay ngày lễ theo lịch phân ca", status: "pending", filed: "2026-09-01", compensation: "time_off" },
  { who: "Vũ Hải Nam", from: "2026-09-09", details: { type: "overtime", from: "17:30", to: "19:30" }, reason: "Hoàn thiện hậu kỳ", status: "pending", filed: "2026-09-10", compensation: "pay" },
  { who: "Hồ Gia Huy", from: "2026-09-22", to: "2026-09-23", details: { type: "remote_work", kind: "off_site", portion: "full", locationName: "Khách hàng — Quận 7", latitude: 10.7321, longitude: 106.7218, radiusM: 300 }, reason: "Quay phỏng vấn tại văn phòng khách hàng", status: "approved", filed: "2026-09-17", decided: "2026-09-18" },
];

function summaryOf(demo: Demo): string {
  const range = !demo.to || demo.to === demo.from ? formatDay(demo.from) : `${formatDay(demo.from)} – ${formatDay(demo.to)}`;
  const { details } = demo;
  if (details.type === "attendance_correction") return `Bổ sung công ${range}: ${[details.inTime ? `vào ${details.inTime}` : null, details.outTime ? `ra ${details.outTime}` : null].filter(Boolean).join(", ")}`;
  if (details.type === "remote_work") return `${details.kind === "wfh" ? "Làm việc tại nhà" : details.kind === "off_site" ? "Làm việc ngoài văn phòng" : "Công tác"} ${range}${details.locationName ? ` — ${details.locationName}` : ""}`;
  if (details.type === "overtime") return `Làm thêm giờ ${range}, ${details.from}–${details.to}${demo.compensation === "time_off" ? " (nghỉ bù)" : ""}`;
  return `Làm việc ngày nghỉ/lễ ${range}${details.from && details.to ? `, ${details.from}–${details.to}` : ""}${demo.compensation === "time_off" ? " (nghỉ bù)" : ""}`;
}

const minutesOf = (details: AttendanceRequestDetails): number => {
  if ((details.type !== "overtime" && details.type !== "holiday_work") || !details.from || !details.to) return 0;
  const [from, to] = [details.from, details.to].map((value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3)));
  return to > from ? to - from : to + 1440 - from;
};

// August 2026 on its way to the lock. Anyone not listed stays "open".
const MONTH = "2026-08";
const MONTHS: Record<string, { status: "confirmed" | "approved"; byHr?: boolean }> = {
  // SZM — all approved: ready to lock.
  "Bùi Thanh Tâm": { status: "approved" }, "Đặng Hoàng Long": { status: "approved" }, "Đỗ Khánh Linh": { status: "approved" }, "Hồ Gia Huy": { status: "approved" }, "Nguyễn Văn Đạt": { status: "approved" },
  "Phạm Quốc Bảo": { status: "approved" }, "Trần Quỳnh Như": { status: "approved" }, "Vũ Hải Nam": { status: "approved" },
  // No app access: HR approved the month without the person's confirmation.
  "Ngô Bảo Anh": { status: "approved", byHr: true },
  // SZC — blockers remain (Khôi open with a pending correction, Đức not approved yet).
  "Dương Thùy Chi": { status: "approved" }, "Huỳnh Mỹ Duyên": { status: "approved" }, "Trịnh Ngọc Ánh": { status: "approved" }, "Phan Văn Đức": { status: "confirmed" },
  // SZG — half-way.
  "Lê Thị Mai": { status: "approved" }, "Võ Minh Tuấn": { status: "confirmed" },
};

export async function seedAttendanceRequests(db: Db): Promise<string> {
  const [existing] = await db.select({ id: attendanceRequest.id }).from(attendanceRequest).limit(1);
  if (existing) return "0 attendance requests (already there)";
  const people = await db.select().from(person);
  const byName = (name: string) => people.find((row) => row.fullName === name);
  const hr = byName("Phạm Quốc Bảo");

  let created = 0;
  for (const demo of REQUESTS) {
    const requester = byName(demo.who);
    const manager = requester?.managerId ? people.find((row) => row.id === requester.managerId) : undefined;
    if (!requester || !manager) continue;
    const to = demo.to ?? demo.from;
    const requestId = randomUUID();
    const approvalId = randomUUID();
    const filedAt = new Date(`${demo.filed}T02:00:00Z`);
    const decidedAt = demo.decided ? new Date(`${demo.decided}T03:00:00Z`) : null;
    const flow = { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] };
    const days = Math.round((Date.parse(to) - Date.parse(demo.from)) / 86_400_000) + 1;

    await db.insert(approvalRequest).values({
      id: approvalId,
      type: demo.details.type,
      entityId: requester.primaryEntityId,
      requesterPersonId: requester.id,
      subjectPersonId: requester.id,
      subjectType: "attendance_request",
      subjectId: requestId,
      summary: summaryOf(demo),
      payload: { attendanceRequestId: requestId, startDate: demo.from, endDate: to, hasEvidence: false, minutes: minutesOf(demo.details), days, kind: demo.details.type === "remote_work" ? demo.details.kind : demo.details.type === "attendance_correction" ? demo.details.cause : demo.details.type },
      status: demo.status,
      currentStep: 0,
      flowSnapshot: { definition: flow, source: "default", resolved: [{ key: "manager", mode: "any", applies: true, approverIds: [manager.id] }] },
      link: `/approvals/attendance/${approvalId}`,
      decidedAt,
      createdAt: filedAt,
    });
    const [step] = await db.insert(approvalStep).values({ requestId: approvalId, stepIndex: 0, key: "manager", mode: "any", status: demo.status }).returning();
    await db.insert(approvalAssignee).values({ stepId: step.id, requestId: approvalId, approverPersonId: manager.id, status: demo.status, comment: demo.comment ?? null, decidedAt });
    await db.insert(approvalEvent).values({ requestId: approvalId, type: "submitted", actorPersonId: requester.id, stepIndex: 0, at: filedAt });
    if (decidedAt) await db.insert(approvalEvent).values({ requestId: approvalId, type: demo.status === "approved" ? "approved" : "rejected", actorPersonId: manager.id, stepIndex: 0, comment: demo.comment ?? null, at: decidedAt });

    await db.insert(attendanceRequest).values({
      id: requestId,
      type: demo.details.type,
      personId: requester.id,
      entityId: requester.primaryEntityId,
      filedByPersonId: requester.id,
      approvalRequestId: approvalId,
      status: demo.status,
      startDate: demo.from,
      endDate: to,
      details: demo.details,
      reason: demo.reason,
      compensation: demo.compensation ?? null,
      confirmedMinutes: demo.confirmedMinutes ?? null,
      confirmedByPersonId: demo.confirmedMinutes === undefined ? null : manager.id,
      confirmedAt: demo.confirmedMinutes === undefined ? null : decidedAt,
      createdAt: filedAt,
    });

    // The effect of an approved correction, as the app writes it: punches with source "request".
    if (demo.status === "approved" && demo.details.type === "attendance_correction") {
      const rows = [demo.details.inTime ? { direction: "in" as const, time: demo.details.inTime } : null, demo.details.outTime ? { direction: "out" as const, time: demo.details.outTime } : null].filter((row) => row !== null);
      await db.insert(punch).values(rows.map((row) => ({ personId: requester.id, entityId: requester.primaryEntityId, at: new Date(`${demo.from}T${row.time}:00+07:00`), direction: row.direction, source: "request" as const, flags: [], note: "Đơn bổ sung công", deviceInfo: { requestId } })));
    }
    if (demo.status === "approved" && demo.clearPunches) {
      await db.delete(punch).where(and(eq(punch.personId, requester.id), gte(punch.at, new Date(`${demo.from}T00:00:00+07:00`)), lt(punch.at, new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86_400_000))));
    }
    created++;
  }

  let months = 0;
  for (const [name, plan] of Object.entries(MONTHS)) {
    const row = byName(name);
    if (!row) continue;
    const approver = plan.byHr ? hr : people.find((candidate) => candidate.id === row.managerId);
    const confirmedAt = plan.byHr ? null : new Date("2026-09-02T02:30:00Z");
    await db
      .insert(timesheetMonth)
      .values({ personId: row.id, entityId: row.primaryEntityId, month: MONTH, status: plan.status, confirmedAt, confirmedByPersonId: plan.byHr ? null : row.id, approvedAt: plan.status === "approved" ? new Date("2026-09-04T03:00:00Z") : null, approvedByPersonId: plan.status === "approved" ? (approver?.id ?? null) : null })
      .onConflictDoNothing();
    months++;
  }
  return `${created} attendance requests and ${months} monthly timesheets for ${MONTH} (run \`pnpm db:recompute\` with the dev server up to refresh the days)`;
}
