// The input schemas of the daily actions another module calls by name: the assistant's proposals
// (Phase 13 R4) check a proposed change against the very schema the action parses it with. Here and
// not in `actions.ts` / `time-actions.ts` because a `"use server"` file may export nothing but async
// functions.
import { z } from "zod";
import { TIME_CATEGORIES } from "./enums";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const isoDate = z.iso.date();

export const logTimeInput = z
  .object({
    date: isoDate,
    taskId: optional(z.uuid()),
    category: optional(z.enum(TIME_CATEGORIES)),
    // "1h30", "90", "1.5h" are parsed by the form; the server takes minutes.
    minutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60),
    note: optional(z.string().trim().max(500)),
    // "default" = the project's kind decides.
    billable: z.enum(["default", "yes", "no"]).default("default"),
  })
  .refine((input) => !!input.taskId !== !!input.category, { path: ["taskId"] });

export const addToPlanInput = z.object({ taskId: z.uuid() });

export const submitReportInput = z.object({
  date: isoDate,
  blockers: optional(z.string().trim().max(2000)),
  notes: optional(z.string().trim().max(2000)),
  tomorrow: z.array(z.uuid()).max(40).default([]),
  secondsToSubmit: optional(z.coerce.number().int().min(0).max(86400)),
});
