// The shapes the project forms post, parsed once for every action file of the module. Plain
// module (no "use server"): an actions file may export only its async actions.
import { z } from "zod";

export const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
export const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
export const checkbox = z.preprocess((value) => value === "on" || value === true || value === "true", z.boolean());
export const isoDate = z.iso.date();
export const text = (max: number) => optional(z.string().trim().max(max));
/** "2026-10": a month picker's value. */
export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
/** Hours on screen, minutes in the database: "12.5" → 750. */
export const hours = z.preprocess(blankToNull, z.coerce.number().min(0).max(100_000).nullable().default(null)).transform((value) => (value === null ? null : Math.round(value * 60)));
/** A change of hours, either way: "-4" → -240. */
export const hoursDelta = z.preprocess(blankToNull, z.coerce.number().min(-100_000).max(100_000).nullable().default(null)).transform((value) => (value === null ? null : Math.round(value * 60)));
/** Rows of a repeated group: the form posts "lines.0.title", "lines.1.title"… which arrive as an object keyed by position. Blank rows are dropped. */
export const rows = <Schema extends z.ZodType>(schema: Schema, max: number) =>
  z.preprocess((value) => {
    const list = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value).sort(([a], [b]) => Number(a) - Number(b)).map(([, row]) => row) : (value ?? []);
    return (list as unknown[]).filter((row) => !row || typeof row !== "object" || Object.values(row).some((cell) => (typeof cell === "string" ? cell.trim() !== "" : cell !== undefined && cell !== null && cell !== false)));
  }, z.array(schema).max(max));
/** Integer VND; "12.000.000" and "12,000,000" are what people type. */
export const vnd = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? null : value.replace(/[.,\s]/g, "")) : value), z.coerce.number().int().min(0).max(1_000_000_000_000).nullable().default(null));
/** A change of VND, either way: "-5.000.000". */
export const vndDelta = z.preprocess((value) => (typeof value === "string" ? (value.trim() === "" ? null : value.replace(/[.,\s]/g, "")) : value), z.coerce.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).nullable().default(null));
/** Checkbox groups post one value or several under one name. */
export const idList = z.preprocess((value) => (value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value : [value]), z.array(z.uuid()).max(200));
