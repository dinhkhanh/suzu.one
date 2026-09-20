// Starter rows for the working calendar and the default schedule, written by `pnpm db:seed`.
// Data, not rules: the government announces Tết, the Hùng Kings day (lunar 10/3) and the swap days
// year by year, so every row is seeded **unconfirmed** and HR confirms or corrects it on
// Attendance → Settings → Working calendar. Nothing in the code reads these constants at run time.
import type { CalendarDayKind, SchedulePattern } from "./engine/calendar";

type SeedDay = { date: string; kind: CalendarDayKind; name: string };
const holiday = (date: string, name: string): SeedDay => ({ date, kind: "public_holiday", name });
const compensatory = (date: string, name: string): SeedDay => ({ date, kind: "compensatory_off", name });

export const CALENDAR_SEED: SeedDay[] = [
  // 2026
  holiday("2026-01-01", "Tết Dương lịch"),
  holiday("2026-02-16", "Tết Nguyên đán (29 tháng Chạp)"),
  holiday("2026-02-17", "Tết Nguyên đán (mùng 1)"),
  holiday("2026-02-18", "Tết Nguyên đán (mùng 2)"),
  holiday("2026-02-19", "Tết Nguyên đán (mùng 3)"),
  holiday("2026-02-20", "Tết Nguyên đán (mùng 4)"),
  holiday("2026-04-26", "Giỗ Tổ Hùng Vương (10/3 âm lịch)"),
  compensatory("2026-04-27", "Nghỉ bù Giỗ Tổ Hùng Vương"),
  holiday("2026-04-30", "Ngày Giải phóng miền Nam"),
  holiday("2026-05-01", "Ngày Quốc tế Lao động"),
  holiday("2026-09-01", "Quốc khánh (ngày liền kề)"),
  holiday("2026-09-02", "Quốc khánh"),
  // 2027
  holiday("2027-01-01", "Tết Dương lịch"),
  holiday("2027-02-05", "Tết Nguyên đán (29 tháng Chạp)"),
  holiday("2027-02-06", "Tết Nguyên đán (mùng 1)"),
  holiday("2027-02-07", "Tết Nguyên đán (mùng 2)"),
  holiday("2027-02-08", "Tết Nguyên đán (mùng 3)"),
  holiday("2027-02-09", "Tết Nguyên đán (mùng 4)"),
  compensatory("2027-02-10", "Nghỉ bù Tết Nguyên đán"),
  compensatory("2027-02-11", "Nghỉ bù Tết Nguyên đán"),
  holiday("2027-04-16", "Giỗ Tổ Hùng Vương (10/3 âm lịch)"),
  holiday("2027-04-30", "Ngày Giải phóng miền Nam"),
  holiday("2027-05-01", "Ngày Quốc tế Lao động"),
  compensatory("2027-05-03", "Nghỉ bù Ngày Quốc tế Lao động"),
  holiday("2027-09-02", "Quốc khánh"),
  holiday("2027-09-03", "Quốc khánh (ngày liền kề)"),
];

const OFFICE_DAY = { type: "working" as const, segments: [{ start: "08:30", end: "17:30" }], breakMinutes: 60 };

// SRS D15: Monday to Friday in the office, Saturday is a work-from-home day without attendance
// tracking. HR edits the hours on Attendance → Settings → Schedules.
export const DEFAULT_SCHEDULE_SEED: { name: string; kind: "fixed"; pattern: SchedulePattern } = {
  name: "Giờ hành chính (T2–T6, Thứ Bảy làm việc tại nhà)",
  kind: "fixed",
  pattern: { days: { 1: OFFICE_DAY, 2: OFFICE_DAY, 3: OFFICE_DAY, 4: OFFICE_DAY, 5: OFFICE_DAY, 6: { type: "untracked", creditMinutes: 480 }, 7: { type: "off" } } },
};

/** The group's starting attendance policy (company practice, HR edits it): added by `pnpm db:seed` only when no policy exists. */
export const DEFAULT_POLICY_SEED = { entityId: null, validFrom: "2026-01-01", mergeRule: "first_in_last_out" as const, graceLateMinutes: 5, graceEarlyMinutes: 5, roundingMinutes: 0, otMinMinutes: 30, otRequiresApproval: true, duplicateWindowMinutes: 3, breakStart: "12:00", dayBoundary: "04:00", monthlyCorrectionCap: 3 };
