// The input schemas of the leave actions another module calls by name: the assistant's proposals
// (Phase 13 R4) check a proposed request against the very schema the action parses it with. Here
// and not in `actions.ts` because a `"use server"` file may export nothing but async functions.
import { z } from "zod";
import { PORTIONS } from "./enums";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const text = (max: number) => optional(z.string().trim().max(max));
const day = z.iso.date();
const wholeNumber = (min: number, max: number) => z.preprocess((value) => (typeof value === "string" && /^-?\d+$/.test(value.trim()) ? Number(value) : value), z.number().int().min(min).max(max));
const portion = z.enum(PORTIONS);

/** One request's fields, shared by filing and amending. */
export const leaveFields = {
  leaveTypeId: z.uuid(),
  startDate: day,
  endDate: day,
  startPortion: portion.default("full"),
  endPortion: portion.default("full"),
  minutes: optional(wholeNumber(15, 1440)),
  reason: text(1000),
  attachmentFileId: optional(z.uuid()),
};

/** `leave.request.submit`: without `personId` the request is the signed-in person's own. */
export const submitLeaveInput = z.object({ personId: optional(z.uuid()), ...leaveFields });
