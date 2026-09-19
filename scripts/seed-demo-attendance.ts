// Phase 2 demo data (attendance and leave), called from seed-demo.ts. Idempotent: every block
// looks for what it would create. August 2026 is the full demo month, September the running one.
import { and, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { calendarDay, department, entity, person, scheduleAssignment, shift, shiftRoster, workLocation, workSchedule } from "../src/lib/db/schema";
import type { DayRule, SchedulePattern } from "../src/modules/attendance/engine/calendar";
import { DEFAULT_SCHEDULE_SEED } from "../src/modules/attendance/seed-calendar";

type Db = ReturnType<typeof drizzle>;

const OFF: DayRule = { type: "off" };
const ALL_OFF: SchedulePattern = { days: { 1: OFF, 2: OFF, 3: OFF, 4: OFF, 5: OFF, 6: OFF, 7: OFF } };
const HALF_DAY: DayRule = { type: "working", segments: [{ start: "08:30", end: "12:00" }], breakMinutes: 0 };
const FLEXIBLE_DAY: DayRule = { type: "working", segments: [{ start: "10:00", end: "16:00" }], breakMinutes: 60, flexible: true, requiredMinutes: 480 };

const eachDate = (from: string, to: string) => {
  const dates: string[] = [];
  for (let cursor = new Date(`${from}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
  return dates;
};
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();

export async function seedAttendance(db: Db): Promise<string> {
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row]));
  const people = new Map((await db.select().from(person)).map((row) => [row.fullName, row]));
  const media = entities.get("SZM");
  const creative = entities.get("SZC");
  if (!media || !creative) return "attendance: demo entities missing, skipped";

  // Schedules: the default office week (from db:seed), a rostered crew, part-time mornings, flexible designers.
  const schedules = await db.select().from(workSchedule);
  const ensureSchedule = async (values: typeof workSchedule.$inferInsert) => schedules.find((row) => row.name === values.name) ?? (await db.insert(workSchedule).values(values).returning())[0];
  const office = schedules.find((row) => row.isDefault) ?? (await db.insert(workSchedule).values({ ...DEFAULT_SCHEDULE_SEED, entityId: null, isDefault: true }).returning())[0];
  const crew = await ensureSchedule({ entityId: media.id, name: "Ê-kíp quay (theo ca)", kind: "shift", pattern: ALL_OFF });
  const partTime = await ensureSchedule({ entityId: creative.id, name: "Bán thời gian (sáng T2–T4–T6)", kind: "fixed", pattern: { days: { 1: HALF_DAY, 2: OFF, 3: HALF_DAY, 4: OFF, 5: HALF_DAY, 6: OFF, 7: OFF } } });
  const flexible = await ensureSchedule({ entityId: creative.id, name: "Giờ linh hoạt (Thiết kế)", kind: "flexible", pattern: { days: { 1: FLEXIBLE_DAY, 2: FLEXIBLE_DAY, 3: FLEXIBLE_DAY, 4: FLEXIBLE_DAY, 5: FLEXIBLE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: OFF } } });

  // Who follows what: every entity the office week; the design department in Creative flexible
  // hours; the crew and the part-timer by name (person-level overrides).
  let assignments = 0;
  const assign = async (values: typeof scheduleAssignment.$inferInsert) => {
    const [existing] = await db
      .select({ id: scheduleAssignment.id })
      .from(scheduleAssignment)
      .where(and(eq(scheduleAssignment.scope, values.scope), values.personId ? eq(scheduleAssignment.personId, values.personId) : isNull(scheduleAssignment.personId), values.departmentId ? eq(scheduleAssignment.departmentId, values.departmentId) : isNull(scheduleAssignment.departmentId), values.entityId ? eq(scheduleAssignment.entityId, values.entityId) : isNull(scheduleAssignment.entityId)))
      .limit(1);
    if (existing) return;
    await db.insert(scheduleAssignment).values(values);
    assignments++;
  };
  for (const row of entities.values()) await assign({ scope: "entity", entityId: row.id, scheduleId: office.id, validFrom: "2026-01-01" });
  const design = departments.get("DES");
  if (design) await assign({ scope: "department", departmentId: design.id, entityId: creative.id, scheduleId: flexible.id, validFrom: "2026-01-01", note: "Giờ linh hoạt cho nhóm thiết kế" });
  const crewPeople = ["Bùi Thanh Tâm", "Ngô Bảo Anh"].flatMap((name) => (people.get(name) ? [people.get(name)!] : []));
  for (const member of crewPeople) await assign({ scope: "person", personId: member.id, scheduleId: crew.id, validFrom: "2026-01-01", note: "Ê-kíp quay làm theo ca" });
  const partTimer = people.get("Huỳnh Mỹ Duyên");
  if (partTimer) await assign({ scope: "person", personId: partTimer.id, scheduleId: partTime.id, validFrom: "2026-01-01" });

  // Shifts of the crew, one of them overnight, one split.
  const shifts = await db.select().from(shift);
  const ensureShift = async (values: typeof shift.$inferInsert) => shifts.find((row) => row.code === values.code && row.entityId === values.entityId) ?? (await db.insert(shift).values(values).returning())[0];
  const dayShift = await ensureShift({ entityId: media.id, code: "DAY", name: "Ca ngày", segments: [{ start: "07:00", end: "15:30" }], breakMinutes: 30 });
  const nightShift = await ensureShift({ entityId: media.id, code: "NIGHT", name: "Ca đêm (quay đêm)", segments: [{ start: "22:00", end: "06:00" }], breakMinutes: 45 });
  const splitShift = await ensureShift({ entityId: media.id, code: "SPLIT", name: "Ca gãy (bình minh – hoàng hôn)", segments: [{ start: "05:00", end: "09:00" }, { start: "16:00", end: "20:00" }], breakMinutes: 0 });

  // Roster, August and September 2026: day shifts on weekdays, a two-night shoot, a split day,
  // and the director on set on National Day (holiday work for the later slices).
  let rostered = 0;
  for (const member of crewPeople) {
    const [existing] = await db.select({ id: shiftRoster.id }).from(shiftRoster).where(eq(shiftRoster.personId, member.id)).limit(1);
    if (existing) continue;
    const special: Record<string, string | null> = { "2026-08-12": nightShift.id, "2026-08-13": nightShift.id, "2026-08-14": null, "2026-08-25": splitShift.id, "2026-09-10": nightShift.id, "2026-09-11": null };
    if (member.fullName === "Bùi Thanh Tâm") special["2026-09-02"] = dayShift.id;
    const rows = eachDate("2026-08-01", "2026-09-30").flatMap((date) => {
      if (date in special) return [{ personId: member.id, date, shiftId: special[date] }];
      return weekday(date) >= 1 && weekday(date) <= 5 ? [{ personId: member.id, date, shiftId: dayShift.id }] : [];
    });
    await db.insert(shiftRoster).values(rows);
    rostered += rows.length;
  }

  // An entity's own calendar row: Creative's team-building day.
  const [teamDay] = await db.select({ id: calendarDay.id }).from(calendarDay).where(and(eq(calendarDay.entityId, creative.id), eq(calendarDay.date, "2026-08-21"))).limit(1);
  if (!teamDay) await db.insert(calendarDay).values({ entityId: creative.id, date: "2026-08-21", kind: "company_off", name: "Team building Suzu Creative" });

  // Work locations (FR-ATT-04): one office per entity in Ho Chi Minh City. The loopback addresses
  // stand in for the office network so a check-in from this machine passes; Media also has a
  // studio that accepts the position only.
  const offices: { code: string; name: string; address: string; latitude: number; longitude: number; radiusM: number; ipAllowlist: string[]; rule: "gps_or_ip" | "gps" }[] = [
    { code: "SZG", name: "Văn phòng Suzu Group", address: "2 Hải Triều, Bến Nghé, Quận 1, TP.HCM", latitude: 10.771595, longitude: 106.704758, radiusM: 150, ipAllowlist: ["127.0.0.1", "::1"], rule: "gps_or_ip" },
    { code: "SZM", name: "Văn phòng Suzu Media", address: "72 Lê Thánh Tôn, Bến Nghé, Quận 1, TP.HCM", latitude: 10.778203, longitude: 106.702143, radiusM: 120, ipAllowlist: ["127.0.0.1", "::1"], rule: "gps_or_ip" },
    { code: "SZM", name: "Studio Thảo Điền", address: "Xuân Thuỷ, Thảo Điền, TP. Thủ Đức", latitude: 10.803512, longitude: 106.733418, radiusM: 200, ipAllowlist: [], rule: "gps" },
    { code: "SZC", name: "Văn phòng Suzu Creative", address: "Võ Văn Tần, Phường 6, Quận 3, TP.HCM", latitude: 10.776889, longitude: 106.690102, radiusM: 120, ipAllowlist: ["127.0.0.1", "::1"], rule: "gps_or_ip" },
  ];
  let locations = 0;
  for (const office of offices) {
    const owner = entities.get(office.code);
    if (!owner) continue;
    const [existing] = await db.select({ id: workLocation.id }).from(workLocation).where(and(eq(workLocation.entityId, owner.id), eq(workLocation.name, office.name))).limit(1);
    if (existing) continue;
    await db.insert(workLocation).values({ entityId: owner.id, name: office.name, address: office.address, latitude: office.latitude, longitude: office.longitude, radiusM: office.radiusM, ipAllowlist: office.ipAllowlist, rule: office.rule });
    locations++;
  }

  return `attendance: ${assignments} schedule assignments, ${rostered} roster days, ${locations} work locations (existing ones skipped)`;
}
