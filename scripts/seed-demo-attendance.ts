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

// ── A full month of punches (Phase 2 week 4) ────────────────────────────────────────────────
//
// Every demo employee, 1 August – 18 September 2026, consistent with the seeded leave, holidays,
// rosters and untracked Saturdays, with a deliberate set of anomalies for the correction / overtime
// requests and the anomaly console. Deterministic (the "dice" are a hash of name + date), so a
// reseed gives the same month and the fixture files below never change. The clocks' punches stop
// on 16 September: `scripts/fixtures/` holds the exports of 14–18 September, so importing them
// shows both halves of idempotency (three days skipped, two days new) and an unmapped ID.
const DEMO_FROM = "2026-08-01";
const DEMO_TO = "2026-09-18";
const DEVICE_TO = "2026-09-16";
const FIXTURE_FROM = "2026-09-14";

const hash = (text: string) => {
  let value = 2166136261;
  for (let index = 0; index < text.length; index++) value = Math.imul(value ^ text.charCodeAt(index), 16777619);
  return value >>> 0;
};
/** A whole number in [low, high], fixed by the key. */
const dice = (key: string, low: number, high: number) => low + (hash(key) % (high - low + 1));
const instant = (date: string, minute: number, second = 0) => new Date(Date.parse(`${date}T00:00:00+07:00`) + minute * 60_000 + second * 1000);
const localStamp = (at: Date) => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");

type Scripted = { in?: number | null; out?: number | null; none?: boolean; flag?: boolean; source?: "app" | "device" };
const clock = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
// name → date → what happened instead of an ordinary day.
const SCRIPT: Record<string, Record<string, Scripted>> = {
  "Hồ Gia Huy": { "2026-08-06": { in: clock("09:10") }, "2026-08-20": { out: null }, "2026-08-27": { out: clock("19:45") }, "2026-09-16": { in: clock("08:40"), flag: true, source: "app" } },
  "Trần Quỳnh Như": { "2026-08-27": { in: clock("08:55") }, "2026-09-08": { out: clock("16:40") } },
  "Phan Văn Đức": { "2026-08-24": { none: true }, "2026-09-08": { in: clock("09:20") } },
  "Võ Minh Tuấn": { "2026-08-19": { out: clock("16:20") }, "2026-08-16": { in: clock("09:00"), out: clock("13:00") } },
  "Lý Minh Khôi": { "2026-08-12": { out: null } },
  "Vũ Hải Nam": { "2026-09-03": { out: null }, "2026-09-09": { out: clock("19:30") } },
  "Đặng Hoàng Long": { "2026-08-13": { out: clock("20:15") }, "2026-09-02": { in: clock("09:00"), out: clock("15:00") } },
  "Đỗ Khánh Linh": { "2026-09-15": { in: clock("08:20"), flag: true, source: "app" }, "2026-08-31": { in: null } },
  "Lê Thị Mai": { "2026-09-10": { out: clock("19:05") } },
};

export async function seedPunches(db: Db): Promise<string> {
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { assignmentFor, dayPlan } = await import("../src/modules/attendance/engine/calendar");
  const schema = await import("../src/lib/db/schema");
  const { punch, attendanceDevice, deviceMappingProfile, deviceUserMap, deviceUnmappedLog, employment, leaveRequest, leaveRequestDay, workLocation: locationTable } = schema;

  const [anyDevicePunch] = await db.select({ id: punch.id }).from(punch).where(eq(punch.source, "device")).limit(1);
  const entities = await db.select().from(entity);
  const entityOf = new Map(entities.map((row) => [row.id, row]));
  const jobs = await db.select({ person, job: employment }).from(person).innerJoin(employment, eq(employment.personId, person.id));
  // One line per person: the employment that covers the demo period.
  const staff = jobs.filter((row) => row.job.startDate <= DEMO_TO && (!row.job.endDate || row.job.endDate >= DEMO_FROM) && row.person.status !== "preboarding").sort((a, b) => a.job.employeeCode.localeCompare(b.job.employeeCode));

  // Clocks: a ZKTeco at Media's front door, a CSV-exporting clock at the Group's reception. Creative uses the app only.
  const profiles = await db.select().from(deviceMappingProfile);
  const devices: { code: string; name: string; model: string; profile: string; file: string }[] = [
    { code: "SZM", name: "Cửa chính Suzu Media", model: "ZKTeco K40", profile: "ZKTeco attlog.dat", file: "attlog-szm.dat" },
    { code: "SZG", name: "Lễ tân Suzu Group", model: "Ronald Jack X628", profile: "CSV chung (có dòng tiêu đề)", file: "device-log-szg.csv" },
  ];
  const deviceOf = new Map<string, { id: string; ids: Map<string, string>; file: string; kind: "dat" | "csv"; lines: string[] }>();
  for (const spec of devices) {
    const owner = entities.find((row) => row.code === spec.code);
    const profile = profiles.find((row) => row.name === spec.profile);
    if (!owner || !profile) continue;
    const [existing] = await db.select().from(attendanceDevice).where(and(eq(attendanceDevice.entityId, owner.id), eq(attendanceDevice.name, spec.name))).limit(1);
    const [location] = await db.select({ id: locationTable.id }).from(locationTable).where(eq(locationTable.entityId, owner.id)).limit(1);
    const device = existing ?? (await db.insert(attendanceDevice).values({ entityId: owner.id, name: spec.name, model: spec.model, profileId: profile.id, locationId: location?.id ?? null }).returning())[0];
    const ids = new Map<string, string>();
    staff.filter((row) => row.person.primaryEntityId === owner.id).forEach((row, index) => ids.set(row.person.id, String(101 + index)));
    if (!existing) await db.insert(deviceUserMap).values([...ids].map(([personId, deviceUserId]) => ({ deviceId: device.id, deviceUserId, personId })));
    deviceOf.set(owner.id, { id: device.id, ids, file: spec.file, kind: profile.fileKind === "dat" ? "dat" : "csv", lines: [] });
  }

  // What each person is expected to do each day: the same pure engine the app uses.
  const [assignments, schedules, calendar, roster, leaveDays, locations] = await Promise.all([
    db.select().from(scheduleAssignment),
    db.select().from(workSchedule),
    db.select().from(calendarDay),
    db.select({ personId: shiftRoster.personId, date: shiftRoster.date, shiftId: shiftRoster.shiftId, segments: shift.segments, breakMinutes: shift.breakMinutes }).from(shiftRoster).leftJoin(shift, eq(shift.id, shiftRoster.shiftId)),
    db.select({ personId: leaveRequestDay.personId, date: leaveRequestDay.date, portion: leaveRequestDay.portion }).from(leaveRequestDay).innerJoin(leaveRequest, eq(leaveRequest.id, leaveRequestDay.requestId)).where(eq(leaveRequest.status, "approved")),
    db.select().from(locationTable),
  ]);
  const patternOf = new Map(schedules.map((row) => [row.id, row.pattern]));
  const fallback = schedules.find((row) => row.isDefault);
  const calendarRows = calendar.map((row) => ({ date: row.date, entityId: row.entityId, kind: row.kind, name: row.name }));

  const rows: (typeof punch.$inferInsert)[] = [];
  for (const { person: member, job } of staff) {
    const home = member.primaryEntityId ? entityOf.get(member.primaryEntityId) : null;
    if (!home) continue;
    const device = deviceOf.get(home.id);
    const office = locations.find((row) => row.entityId === home.id && row.ipAllowlist.length > 0);
    for (const date of eachDate(DEMO_FROM, DEMO_TO)) {
      if (date < job.startDate || (job.endDate && date > job.endDate)) continue;
      const rostered = roster.find((row) => row.personId === member.id && row.date === date);
      const assignment = assignmentFor(assignments, { personId: member.id, entityId: member.primaryEntityId, departmentId: member.departmentId }, date);
      const plan = dayPlan({ date, entityId: member.primaryEntityId, pattern: assignment ? (patternOf.get(assignment.scheduleId) ?? null) : (fallback?.pattern ?? null), calendar: calendarRows, roster: rostered ? { date, shift: rostered.shiftId && rostered.segments ? { id: rostered.shiftId, segments: rostered.segments, breakMinutes: rostered.breakMinutes ?? 0 } : null } : null });
      const scripted = SCRIPT[member.fullName]?.[date];
      const away = leaveDays.filter((row) => row.personId === member.id && row.date === date);
      if (away.some((row) => row.portion === "full") || scripted?.none) continue;
      // Rest days and holidays: only those the script sends to work (or the roster puts on set).
      const workedAnyway = plan.kind !== "working" && scripted?.in !== undefined && scripted.out !== undefined;
      if (plan.kind !== "working" && !workedAnyway && !(plan.kind === "holiday" && plan.baseline.kind === "working" && rostered?.shiftId)) continue;
      const segments = plan.kind === "working" ? plan.segments : plan.baseline.segments;

      const key = `${member.fullName}:${date}`;
      const blocks = workedAnyway ? [{ start: scripted!.in!, end: scripted!.out! }] : segments.map((segment) => ({ ...segment }));
      if (!workedAnyway && blocks.length === 1) {
        // Half days of leave: the other half is worked. Flexible hours: in between nine and ten, nine hours later out.
        if (away.some((row) => row.portion === "am")) blocks[0].start = clock("13:00");
        if (away.some((row) => row.portion === "pm")) blocks[0].end = clock("12:00");
        if (plan.flexible) Object.assign(blocks[0], { start: clock("09:00") + dice(`${key}:flex`, 0, 60), end: clock("18:00") + dice(`${key}:flex`, 0, 60) });
      }
      // The day's source: clock, phone, or both (the phone on the way in, the clock at the door).
      const roll = dice(`${key}:source`, 1, 10);
      const source = scripted?.source ?? (!device || blocks.length > 1 ? "app" : roll <= 7 ? "device" : roll <= 9 ? "both" : "app");
      blocks.forEach((block, index) => {
        // Flexible hours were drawn above; everyone else comes a little early and leaves a little late — one day in twenty, late.
        const ordinaryIn = plan.flexible ? block.start : block.start - dice(`${key}:in:${index}`, 1, 18) + (dice(`${key}:late`, 1, 20) === 1 ? dice(`${key}:lateBy`, 20, 40) : 0);
        const ordinaryOut = block.end + dice(`${key}:out:${index}`, 1, plan.flexible ? 12 : 25);
        const inAt = workedAnyway ? block.start : scripted?.in === undefined || index > 0 ? ordinaryIn : scripted.in;
        const outAt = workedAnyway ? block.end : scripted?.out === undefined || index < blocks.length - 1 ? ordinaryOut : scripted.out;
        const add = (minute: number, direction: "in" | "out") => {
          const at = instant(date, minute, dice(`${key}:${direction}:second`, 0, 59));
          const viaApp = source === "app" || (source === "both" && direction === "in");
          if (viaApp || !device || date > DEVICE_TO) {
            const flagged = !!scripted?.flag && direction === "in";
            if (viaApp || !device) rows.push({ personId: member.id, entityId: home.id, at, direction, source: "app", latitude: office ? office.latitude! + (flagged ? 0.031 : 0.0002) : null, longitude: office?.longitude ?? null, accuracyM: dice(`${key}:accuracy`, 8, 35), ipAddress: flagged ? "113.161.72.10" : "127.0.0.1", userAgent: "Mozilla/5.0 (demo seed)", locationId: flagged ? null : (office?.id ?? null), distanceM: flagged ? 3450 : 22, flags: flagged ? ["outside_geofence", "ip_not_allowed"] : [], reviewStatus: flagged ? "pending" : "none", note: flagged ? "Đi quay ngoại cảnh, chấm công tại điểm quay" : null });
          }
          if ((!viaApp || source === "both") && device) {
            const deviceUserId = device.ids.get(member.id)!;
            if (date <= DEVICE_TO) rows.push({ personId: member.id, entityId: home.id, at, direction, source: "device", deviceId: device.id, deviceUserId });
            if (date >= FIXTURE_FROM) device.lines.push(device.kind === "dat" ? `${deviceUserId.padStart(9)}\t${localStamp(at)}\t1\t${direction === "in" ? 0 : 1}\t1\t0` : `${deviceUserId},${member.fullName},${localStamp(at)},${direction === "in" ? "C/In" : "C/Out"}`);
          }
        };
        if (inAt !== null) add(inAt, "in");
        if (outAt !== null) add(outAt, "out");
      });
    }
  }

  // The exports of 14–18 September, as the clocks would write them — plus a visitor card (ID 250) nobody is mapped to.
  mkdirSync("scripts/fixtures", { recursive: true });
  for (const device of deviceOf.values()) {
    const visitor = device.kind === "dat" ? ["      250\t2026-09-17 09:02:11\t1\t0\t1\t0", "      250\t2026-09-17 11:40:53\t1\t1\t1\t0"] : ["250,Khách,2026-09-17 09:02:11,C/In", "250,Khách,2026-09-17 11:40:53,C/Out"];
    const sortKey = (line: string) => (device.kind === "dat" ? line.split("\t")[1] : line.split(",")[2]);
    const lines = [...device.lines, ...visitor].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
    writeFileSync(`scripts/fixtures/${device.file}`, `${device.kind === "dat" ? "" : "User ID,Name,Time,Status\n"}${lines.join("\n")}\n`);
  }

  if (anyDevicePunch) return "punches: already seeded, fixtures rewritten";
  for (let index = 0; index < rows.length; index += 500) await db.insert(punch).values(rows.slice(index, index + 500));
  const media = deviceOf.get(entities.find((row) => row.code === "SZM")?.id ?? "");
  if (media) await db.insert(deviceUnmappedLog).values([{ deviceId: media.id, deviceUserId: "250", at: instant("2026-08-11", clock("09:15"), 4), direction: "in" }, { deviceId: media.id, deviceUserId: "250", at: instant("2026-08-11", clock("10:48"), 40), direction: "out" }]).onConflictDoNothing();
  return `punches: ${rows.length} for ${staff.length} people (${DEMO_FROM} → ${DEMO_TO}; clocks until ${DEVICE_TO}), ${deviceOf.size} clocks — run \`pnpm db:recompute\` with the dev server up to fill the timesheets`;
}
