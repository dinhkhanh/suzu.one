// The input schemas of the attendance actions another module calls by name: the assistant's
// proposals (Phase 13 R4) check a proposed request against the very schema the action parses it
// with. Here and not in `request-actions.ts` because a `"use server"` file may export nothing but
// async functions. (`request-inputs.ts` is something else: approved requests for the timesheet.)
import { z } from "zod";
import { ATTENDANCE_REQUEST_TYPES } from "./requests";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
const text = (max: number) => optional(z.string().trim().max(max));
const day = z.iso.date();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const decimal = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && value.trim() !== "" ? Number(value.replace(",", ".")) : value), z.number().min(min).max(max));
const wholeNumber = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value), z.number().int().min(min).max(max));

/** One flat form for the four types; which fields matter depends on `type`. */
export const attendanceRequestFields = {
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

/** `attendance.request.submit`: without `personId` the request is the signed-in person's own. */
export const submitAttendanceRequestInput = z.object({ personId: optional(z.uuid()), ...attendanceRequestFields });
