// Attendance tables, first slice (FR-ATT-01, 02, 17): the working calendar, shifts, work schedules,
// who follows which schedule, and the shift roster. Holidays are rows, never constants: the
// government announces Tết and the swap days year by year.
import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, check, customType, date, doublePrecision, index, integer, jsonb, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { approvalRequest } from "../platform/approvals/schema";
import { entity, orgUnit } from "../platform/org/schema";
import { person } from "../platform/people/schema";
import type { SchedulePattern, Segment } from "./engine/calendar";
import type { DeviceMapping } from "./engine/device-log";
import type { PunchFlag } from "./engine/geofence";

export const calendarDayKind = pgEnum("calendar_day_kind", ["public_holiday", "compensatory_off", "company_off", "working_override"]);

// A date that differs from the weekly pattern. `entity_id` null = every entity; an entity's own
// row for the same date wins (a company day off, a make-up working Saturday).
export const calendarDay = pgTable(
  "calendar_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    date: date("date").notNull(),
    kind: calendarDayKind("kind").notNull(),
    name: text("name").notNull(),
    // Seeded dates (lunar holidays, the yearly swap days) wait for HR to confirm them against the official announcement.
    isConfirmed: boolean("is_confirmed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("calendar_day_entity_date_key").on(t.entityId, t.date).nullsNotDistinct(), index("calendar_day_date_idx").on(t.date)],
).enableRLS();

// A named block of working time for rostered crews. Several segments = a split shift; a segment
// whose end is not after its start runs past midnight and belongs to the day it starts on.
export const shift = pgTable(
  "shift",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
    segments: jsonb("segments").$type<Segment[]>().notNull(),
    breakMinutes: smallint("break_minutes").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("shift_entity_code_key").on(t.entityId, t.code).nullsNotDistinct()],
).enableRLS();

export const workScheduleKind = pgEnum("work_schedule_kind", ["fixed", "flexible", "shift"]);

// The weekly pattern: for every weekday "working" (with hours), "untracked" (working, no punches
// required — Saturday WFH, FR-ATT-17) or "off"; plus alternate-week rules (alternate Saturdays).
export const workSchedule = pgTable(
  "work_schedule",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    kind: workScheduleKind("kind").notNull(),
    pattern: jsonb("pattern").$type<SchedulePattern>().notNull(),
    // The schedule of anyone no assignment covers. At most one (partial unique index in the migration).
    isDefault: boolean("is_default").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_schedule_entity_idx").on(t.entityId)],
).enableRLS();

export const scheduleScope = pgEnum("schedule_scope", ["entity", "department", "person"]);

// Who follows which schedule, effective-dated. The most specific wins: person, then department
// (within an entity, then across entities), then entity, then the default schedule. Rows of one
// scope never overlap (exclusion constraints in the migration).
export const scheduleAssignment = pgTable(
  "schedule_assignment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: scheduleScope("scope").notNull(),
    // entity scope: the entity. department scope: optional, narrows a shared department to one entity.
    entityId: uuid("entity_id").references(() => entity.id),
    departmentId: uuid("department_id").references(() => orgUnit.id),
    personId: uuid("person_id").references(() => person.id),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => workSchedule.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    note: text("note"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("schedule_assignment_person_idx").on(t.personId), index("schedule_assignment_department_idx").on(t.departmentId), index("schedule_assignment_entity_idx").on(t.entityId)],
).enableRLS();

// Which shift a person works on which date. Overrides the weekly pattern for that date.
export const shiftRoster = pgTable(
  "shift_roster",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    date: date("date").notNull(),
    // null = rostered off that day.
    shiftId: uuid("shift_id").references(() => shift.id),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("shift_roster_person_date_key").on(t.personId, t.date)],
).enableRLS();

// ── Check-in (FR-ATT-03, 04) ────────────────────────────────────────────────────────────────

export const locationRule = pgEnum("work_location_rule", ["gps_or_ip", "gps", "ip", "gps_and_ip"]);
export const locationMode = pgEnum("work_location_mode", ["flag", "block"]);

// Where an entity's people may check in: a circle on the map and/or the office's public IP ranges
// (browsers cannot read the Wi-Fi name, so the office network is recognised by the address it
// leaves through). `mode`: out-of-policy check-ins are flagged for review, or refused.
export const workLocation = pgTable(
  "work_location",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    name: text("name").notNull(),
    address: text("address"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    radiusM: integer("radius_m"),
    // A position reading less certain than this proves nothing.
    accuracyLimitM: integer("accuracy_limit_m").notNull().default(100),
    ipAllowlist: jsonb("ip_allowlist").$type<string[]>().notNull().default([]),
    rule: locationRule("rule").notNull().default("gps_or_ip"),
    mode: locationMode("mode").notNull().default("flag"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("work_location_entity_idx").on(t.entityId)],
).enableRLS();

export const punchDirection = pgEnum("punch_direction", ["in", "out"]);
export const punchSource = pgEnum("punch_source", ["app", "device", "manual", "request"]);
export const punchReview = pgEnum("punch_review", ["none", "pending", "accepted", "rejected"]);

// One clock event. `at` is always the server's time, never the phone's. App check-ins carry where
// and how they were made; device imports (week 4) and approved corrections (week 5) write here too
// with their own source. Position, address and device are personal-tier: the person, their line
// manager and HR — never colleagues. A punch whose review ended in "rejected" does not count.
export const punch = pgTable(
  "punch",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    at: timestamp("at", { withTimezone: true }).notNull(),
    direction: punchDirection("direction").notNull(),
    source: punchSource("source").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    accuracyM: integer("accuracy_m"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // What the browser says about itself: platform, language, screen, installed app or tab.
    deviceInfo: jsonb("device_info").$type<Record<string, string | number | boolean>>(),
    locationId: uuid("location_id").references(() => workLocation.id),
    distanceM: integer("distance_m"),
    flags: jsonb("flags").$type<PunchFlag[]>().notNull().default([]),
    reviewStatus: punchReview("review_status").notNull().default("none"),
    reviewedByPersonId: uuid("reviewed_by_person_id").references(() => person.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewNote: text("review_note"),
    // The person's own words ("at the client's office this morning").
    note: text("note"),
    // Device imports (FR-ATT-06): which clock, which ID on that clock, which upload. The three
    // together with `at` make a re-import of an overlapping export add nothing twice.
    deviceId: uuid("device_id").references((): AnyPgColumn => attendanceDevice.id),
    deviceUserId: text("device_user_id"),
    importBatchId: uuid("import_batch_id"),
    // A punch made through a kiosk opened in the app (a face, or its QR code): which tablet's
    // session it came through. A tablet cannot prove the face in front of it was alive, so HR can
    // see what one session did — and take it back — if the tablet's cookie ever got out.
    kioskSessionId: uuid("kiosk_session_id").references((): AnyPgColumn => kioskSession.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("punch_person_at_idx").on(t.personId, t.at),
    index("punch_entity_at_idx").on(t.entityId, t.at),
    index("punch_review_idx").on(t.reviewStatus),
    uniqueIndex("punch_device_key")
      .on(t.deviceId, t.deviceUserId, t.at)
      .where(sql`${t.deviceId} is not null`),
    index("punch_kiosk_session_idx")
      .on(t.kioskSessionId, t.at)
      .where(sql`${t.kioskSessionId} is not null`),
  ],
).enableRLS();

// ── Device logs (FR-ATT-06) ─────────────────────────────────────────────────────────────────

export const deviceFileKind = pgEnum("device_file_kind", ["csv", "xlsx", "dat"]);

export const deviceMappingProfile = pgTable(
  "device_mapping_profile",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // null = usable by every entity.
    entityId: uuid("entity_id").references(() => entity.id),
    name: text("name").notNull(),
    deviceModel: text("device_model"),
    fileKind: deviceFileKind("file_kind").notNull(),
    mapping: jsonb("mapping").$type<DeviceMapping>().notNull(),
    // Device clocks show local time; the export carries no zone.
    timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("device_mapping_profile_name_key").on(t.entityId, t.name).nullsNotDistinct()],
).enableRLS();

export const attendanceDevice = pgTable(
  "attendance_device",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    name: text("name").notNull(),
    model: text("model"),
    serialNumber: text("serial_number"),
    locationId: uuid("location_id").references(() => workLocation.id),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => deviceMappingProfile.id),
    isActive: boolean("is_active").notNull().default(true),
    // A clock that sends its punches itself (the face kiosk, tools/face-kiosk): SHA-256 of the
    // token it presents. The token is shown once when issued and never stored.
    pushTokenHash: text("push_token_hash"),
    pushTokenIssuedAt: timestamp("push_token_issued_at", { withTimezone: true }),
    // The last time the clock called in, punches or not: HR sees a kiosk that has gone quiet.
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("attendance_device_entity_name_key").on(t.entityId, t.name),
    uniqueIndex("attendance_device_push_token_key")
      .on(t.pushTokenHash)
      .where(sql`${t.pushTokenHash} is not null`),
  ],
).enableRLS();

// The other entities a clock serves: one office shared by several entities has one kiosk at its
// door, and their people punch on it alike. The clock's own entity (whose HR administers it) is
// always served and is not listed here. Each punch still belongs to its person's entity.
export const attendanceDeviceEntity = pgTable(
  "attendance_device_entity",
  {
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevice.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.entityId] }), index("attendance_device_entity_entity_idx").on(t.entityId)],
).enableRLS();

// Whose finger is ID 17 on this clock. One person per ID per device.
export const deviceUserMap = pgTable(
  "device_user_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevice.id),
    deviceUserId: text("device_user_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("device_user_map_key").on(t.deviceId, t.deviceUserId), index("device_user_map_person_idx").on(t.personId)],
).enableRLS();

// Log lines of IDs nobody has been mapped to yet. They wait here (never lost, never doubled); the
// moment HR maps the ID they become punches.
export const deviceUnmappedLog = pgTable(
  "device_unmapped_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevice.id),
    deviceUserId: text("device_user_id").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    direction: punchDirection("direction"),
    importBatchId: uuid("import_batch_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("device_unmapped_log_key").on(t.deviceId, t.deviceUserId, t.at)],
).enableRLS();

// ── The face kiosk (FR-ATT-06) ──────────────────────────────────────────────────────────────
//
// A wall tablet that HR opens as a kiosk for one clock: it recognises faces in its own browser and
// punches through the clock, like any other. Faces are biometric data — sensitive personal data
// under Law 91/2025 — so they are restricted-tier, never cached, and kept only as numbers: the
// kiosk sends 128 of them per face and never a picture.

// pgvector in the `extensions` schema (see 0100), of the recognition model's size.
const faceVector = customType<{ data: number[]; driverData: string }>({
  dataType: () => "extensions.vector(128)",
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) => JSON.parse(value) as number[],
});

// One row per person whose face may be recognised: the consent they signed, recorded by whom.
// Deleting the row deletes every template with it.
export const faceEnrolment = pgTable(
  "face_enrolment",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    consentAt: timestamp("consent_at", { withTimezone: true }).notNull(),
    consentRecordedByPersonId: uuid("consent_recorded_by_person_id")
      .notNull()
      .references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("face_enrolment_entity_idx").on(t.entityId)],
).enableRLS();

// One embedding per enrolment photo, never the photo. `model` names what wrote it: a template of
// another model is never compared with this one's (`FACE_MODEL`).
export const faceTemplate = pgTable(
  "face_template",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => faceEnrolment.personId, { onDelete: "cascade" }),
    entityId: uuid("entity_id").references(() => entity.id),
    model: text("model").notNull(),
    embedding: faceVector("embedding").notNull(),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("face_template_person_idx").on(t.personId, t.model)],
).enableRLS();

// A tablet opened as a kiosk for a clock. The tablet holds the token in a cookie (its SHA-256 is
// here); whoever opened it is signed out on that tablet in the same step. Closed from the kiosk
// page, it stops at its next call. `qr_secret` signs the QR codes it shows. It also ends by
// itself (`engine/kiosk-lifetime.ts`): unused for two weeks, or three months after it was opened,
// both read off `last_seen_at` and `opened_at`; the nightly job then closes it with nobody's name.
export const kioskSession = pgTable(
  "kiosk_session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: uuid("device_id")
      .notNull()
      .references(() => attendanceDevice.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    tokenHash: text("token_hash").notNull(),
    qrSecret: text("qr_secret").notNull(),
    openedByPersonId: uuid("opened_by_person_id")
      .notNull()
      .references(() => person.id),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closedByPersonId: uuid("closed_by_person_id").references(() => person.id),
  },
  (t) => [uniqueIndex("kiosk_session_token_key").on(t.tokenHash), index("kiosk_session_device_idx").on(t.deviceId)],
).enableRLS();

// The rate limiter of the endpoints nobody signs in to (NFR-SEC-03): a kiosk tablet's
// `/api/kiosk/*` and a clock's `/api/attendance/device/*`. One row per (bucket, key, window) and
// one atomic upsert — the careers page's mechanism, in this module's own table
// (`endpoint-limit.ts`). `key_hash` is a hash of the kiosk session or the clock, never a token.
export const attendanceEndpointHit = pgTable(
  "attendance_endpoint_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // What was counted: "kiosk_identify", "kiosk_punch", "device_punches"… See `ENDPOINT_LIMITS`.
    bucket: text("bucket").notNull(),
    keyHash: text("key_hash").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("attendance_endpoint_hit_key").on(t.bucket, t.keyHash, t.windowStart), index("attendance_endpoint_hit_window_idx").on(t.windowStart)],
).enableRLS();

// ── Attendance policy and the daily timesheet (FR-ATT-08, 09) ───────────────────────────────

export const mergeRule = pgEnum("attendance_merge_rule", ["first_in_last_out", "prefer_device", "prefer_app"]);

// Company practice, effective-dated (exclusion constraint in the migration). entity null = the
// group's default; an entity's own row wins. Nothing legal lives here: the night window and the
// overtime multipliers and caps are statutory parameters.
export const attendancePolicy = pgTable(
  "attendance_policy",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id").references(() => entity.id),
    validFrom: date("valid_from").notNull(),
    validTo: date("valid_to"),
    mergeRule: mergeRule("merge_rule").notNull().default("first_in_last_out"),
    graceLateMinutes: smallint("grace_late_minutes").notNull().default(0),
    graceEarlyMinutes: smallint("grace_early_minutes").notNull().default(0),
    // 0 = punches count to the minute; N = to the nearest N minutes.
    roundingMinutes: smallint("rounding_minutes").notNull().default(0),
    // Extra time shorter than this is not overtime.
    otMinMinutes: smallint("ot_min_minutes").notNull().default(30),
    otRequiresApproval: boolean("ot_requires_approval").notNull().default(true),
    // Two punches of one person closer together than this are one punch.
    duplicateWindowMinutes: smallint("duplicate_window_minutes").notNull().default(3),
    // Where the unpaid break sits when a day is one block ("12:00"); otherwise the middle of the block.
    breakStart: text("break_start").notNull().default("12:00"),
    // A punch before this hour may close the day before (someone leaving after midnight).
    dayBoundary: text("day_boundary").notNull().default("04:00"),
    // Correction requests a person may file per month (week 5). null = no cap.
    monthlyCorrectionCap: smallint("monthly_correction_cap"),
    createdByPersonId: uuid("created_by_person_id").references(() => person.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attendance_policy_entity_idx").on(t.entityId, t.validFrom)],
).enableRLS();

export const timesheetDayStatus = pgEnum("timesheet_day_status", ["present", "partial", "absent", "leave", "holiday", "day_off", "rest", "untracked", "remote", "unscheduled", "in_progress"]);

// One person-day as the engine computed it. Minutes are integers. Rewritten whenever an input
// changes — until `locked_at` is set (week 5: monthly lock), after which the row is never touched.
export const timesheetDay = pgTable(
  "timesheet_day",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    date: date("date").notNull(),
    planKind: text("plan_kind").notNull(),
    status: timesheetDayStatus("status").notNull(),
    requiredMinutes: integer("required_minutes").notNull().default(0),
    workedMinutes: integer("worked_minutes").notNull().default(0),
    creditedMinutes: integer("credited_minutes").notNull().default(0),
    lateMinutes: integer("late_minutes").notNull().default(0),
    earlyMinutes: integer("early_minutes").notNull().default(0),
    absenceMinutes: integer("absence_minutes").notNull().default(0),
    missingPunch: boolean("missing_punch").notNull().default(false),
    leavePaidMinutes: integer("leave_paid_minutes").notNull().default(0),
    leaveUnpaidMinutes: integer("leave_unpaid_minutes").notNull().default(0),
    holidayMinutes: integer("holiday_minutes").notNull().default(0),
    wfhMinutes: integer("wfh_minutes").notNull().default(0),
    tripMinutes: integer("trip_minutes").notNull().default(0),
    // Ordinary hours that fell in the night window (night premium).
    nightMinutes: integer("night_minutes").notNull().default(0),
    otWeekdayMinutes: integer("ot_weekday_minutes").notNull().default(0),
    otWeekdayNightMinutes: integer("ot_weekday_night_minutes").notNull().default(0),
    otRestDayMinutes: integer("ot_rest_day_minutes").notNull().default(0),
    otRestDayNightMinutes: integer("ot_rest_day_night_minutes").notNull().default(0),
    otHolidayMinutes: integer("ot_holiday_minutes").notNull().default(0),
    otHolidayNightMinutes: integer("ot_holiday_night_minutes").notNull().default(0),
    // Extra time nobody approved: shown, never paid.
    otUnapprovedMinutes: integer("ot_unapproved_minutes").notNull().default(0),
    // Approved overtime the person asked to take as time off instead of pay (subset of the OT columns).
    otTimeOffMinutes: integer("ot_time_off_minutes").notNull().default(0),
    firstIn: timestamp("first_in", { withTimezone: true }),
    lastOut: timestamp("last_out", { withTimezone: true }),
    anomalies: jsonb("anomalies").$type<string[]>().notNull().default([]),
    trace: jsonb("trace").$type<string[]>().notNull().default([]),
    inputsHash: text("inputs_hash").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [unique("timesheet_day_person_date_key").on(t.personId, t.date), index("timesheet_day_entity_date_idx").on(t.entityId, t.date)],
).enableRLS();

// ── Week 5: attendance requests, the monthly timesheet and its lock (FR-ATT-10, 11, 12, 14, 18) ──

export const attendanceRequestType = pgEnum("attendance_request_type", ["attendance_correction", "remote_work", "overtime", "holiday_work"]);
export const attendanceRequestStatus = pgEnum("attendance_request_status", ["pending", "approved", "rejected", "withdrawn", "cancelled"]);

/** What each request type keeps beside its dates. Times are "HH:mm" local clock. */
export type AttendanceRequestDetails =
  | { type: "attendance_correction"; cause: "forgot" | "device_error" | "other"; inTime: string | null; outTime: string | null; /** The departure was after midnight (night shift). */ outNextDay: boolean }
  | { type: "remote_work"; kind: "wfh" | "off_site" | "business_trip"; portion: "full" | "am" | "pm"; locationName: string | null; latitude: number | null; longitude: number | null; radiusM: number | null }
  | { type: "overtime"; from: string; to: string }
  | { type: "holiday_work"; from: string | null; to: string | null };

// One table for the four attendance request types: they share dates, a reason, an approval and —
// for overtime and holiday work — the choice between pay and time off and a manager's confirmation
// of the hours. The approval itself lives in `approval_request`; `status` follows it.
export const attendanceRequest = pgTable(
  "attendance_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: attendanceRequestType("type").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    filedByPersonId: uuid("filed_by_person_id")
      .notNull()
      .references(() => person.id),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequest.id),
    status: attendanceRequestStatus("status").notNull().default("pending"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    details: jsonb("details").$type<AttendanceRequestDetails>().notNull(),
    reason: text("reason"),
    evidenceFileId: uuid("evidence_file_id"),
    // Overtime and holiday work: paid at the statutory multiplier, or taken as time off in lieu.
    compensation: text("compensation").$type<"pay" | "time_off">(),
    // Hours the line manager confirmed where punches cannot (untracked day, off-site work).
    confirmedMinutes: integer("confirmed_minutes"),
    confirmedByPersonId: uuid("confirmed_by_person_id").references(() => person.id),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("attendance_request_person_idx").on(t.personId, t.startDate), index("attendance_request_approval_idx").on(t.approvalRequestId), index("attendance_request_entity_idx").on(t.entityId, t.startDate)],
).enableRLS();

export const timesheetMonthStatus = pgEnum("timesheet_month_status", ["open", "confirmed", "approved", "locked"]);

// One person's month on its way to payroll: the employee confirms, the line manager approves, HR
// locks (FR-ATT-14). `summary` is the month's totals as they stood at the last step taken; after
// the lock it is the frozen snapshot payroll reads.
export const timesheetMonth = pgTable(
  "timesheet_month",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id").references(() => entity.id),
    month: text("month").notNull(),
    status: timesheetMonthStatus("status").notNull().default("open"),
    summary: jsonb("summary").$type<Record<string, unknown>>(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    confirmedByPersonId: uuid("confirmed_by_person_id").references(() => person.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByPersonId: uuid("approved_by_person_id").references(() => person.id),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByPersonId: uuid("locked_by_person_id").references(() => person.id),
    // Why it was sent back to the person, by whom.
    reopenedComment: text("reopened_comment"),
    reopenedByPersonId: uuid("reopened_by_person_id").references(() => person.id),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("timesheet_month_person_month_key").on(t.personId, t.month), index("timesheet_month_entity_idx").on(t.entityId, t.month), check("timesheet_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
).enableRLS();

export const timesheetPeriodStatus = pgEnum("timesheet_period_status", ["open", "locked"]);

// An entity's month. Locked by HR; from then on its days are payroll's input and never recomputed.
export const timesheetPeriod = pgTable(
  "timesheet_period",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    month: text("month").notNull(),
    status: timesheetPeriodStatus("status").notNull().default("open"),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedByPersonId: uuid("locked_by_person_id").references(() => person.id),
    // Locked although blockers remained: HR's reason and what the blockers were.
    overrideReason: text("override_reason"),
    exceptions: jsonb("exceptions").$type<{ personId: string; code: string; count: number }[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("timesheet_period_entity_month_key").on(t.entityId, t.month), check("timesheet_period_month_format", sql`${t.month} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
).enableRLS();

export const timesheetAdjustmentStatus = pgEnum("timesheet_adjustment_status", ["active", "voided"]);

/** Signed minutes per timesheet column an adjustment corrects. */
export type AdjustmentDeltas = Partial<
  Record<
    | "workedMinutes"
    | "leavePaidMinutes"
    | "leaveUnpaidMinutes"
    | "absenceMinutes"
    | "lateMinutes"
    | "earlyMinutes"
    | "otWeekdayMinutes"
    | "otWeekdayNightMinutes"
    | "otRestDayMinutes"
    | "otRestDayNightMinutes"
    | "otHolidayMinutes"
    | "otHolidayNightMinutes"
    | "nightMinutes",
    number
  >
> & { paidDaysCenti?: number };

// A correction to a month that is already locked (FR-ATT-14). The locked days are never edited:
// the difference is written here and payroll picks it up as a retro item in its next open month.
export const timesheetAdjustment = pgTable(
  "timesheet_adjustment",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id),
    /** The locked month being corrected. */
    month: text("month").notNull(),
    date: date("date"),
    deltas: jsonb("deltas").$type<AdjustmentDeltas>().notNull(),
    reason: text("reason").notNull(),
    status: timesheetAdjustmentStatus("status").notNull().default("active"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => person.id),
    voidedByPersonId: uuid("voided_by_person_id").references(() => person.id),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    /** Set by payroll (Phase 5) when a payroll month has taken the adjustment in. */
    payrollMonth: text("payroll_month"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("timesheet_adjustment_entity_idx").on(t.entityId, t.month), index("timesheet_adjustment_person_idx").on(t.personId, t.month)],
).enableRLS();

// Time off in lieu posted at the lock, so a second lock attempt (or a re-run) posts nothing twice.
export const attendanceToilPosting = pgTable(
  "attendance_toil_posting",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id),
    month: text("month").notNull(),
    minutes: integer("minutes").notNull(),
    amountCenti: integer("amount_centi").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("attendance_toil_posting_person_month_key").on(t.personId, t.month)],
).enableRLS();
