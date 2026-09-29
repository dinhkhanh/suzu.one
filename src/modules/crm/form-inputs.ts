// The shapes the CRM forms post, parsed once for every action file of the module. Plain module
// (no "use server"): an actions file may export only its async actions. The same helpers as the
// project forms', so a VND amount, a date or a checkbox reads the same everywhere.
import { z } from "zod";
export { blankToNull, checkbox, idList, isoDate, month, optional, rows, text, vnd } from "../projects/form-inputs";
import { blankToNull } from "../projects/form-inputs";

/** Whole percent on screen, basis points in the database: "12.5" → 1250. */
export const percentBp = z.preprocess(blankToNull, z.coerce.number().min(0).max(100).nullable().default(null)).transform((value) => (value === null ? 0 : Math.round(value * 100)));
/** A whole number of days, blank = null. */
export const days = z.preprocess(blankToNull, z.coerce.number().int().min(0).max(3650).nullable().default(null));
/** A probability typed as a whole percent; blank = the stage's default. */
export const probability = z.preprocess(blankToNull, z.coerce.number().int().min(0).max(100).nullable().default(null));
/** Hours on screen, minutes in the database. */
export const hoursToMinutes = z.preprocess(blankToNull, z.coerce.number().min(0).max(100_000).nullable().default(null)).transform((value) => (value === null ? 0 : Math.round(value * 60)));
/** An account code: upper-case letters, digits, "-" and "_" (the work module's client code). */
export const accountCode = z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{1,19}$/);
