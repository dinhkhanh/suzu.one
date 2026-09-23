// What a request form *is*, and what a filled-in one means (FR-REQ-01). Pure: no I/O, no database,
// no translation — every problem is a message key the form puts into the reader's language.
//
// An administrator designs a form on /admin/request-types: a list of fields, each with its type,
// its validation and, optionally, a condition that decides whether it is shown at all. The same
// definition then renders the form, validates the submission and tells the approval engine which
// values its flow conditions may test.
//
// The condition shape is deliberately the one the approval engine already uses
// (`approvals/engine/flow.ts`), so a designer learns one idea: field, operator, value.

import type { Condition } from "@/modules/platform/approvals/engine/flow";
import { conditionHolds } from "@/modules/platform/approvals/engine/flow";

export const FIELD_TYPES = ["text", "textarea", "number", "money", "date", "select", "multi_select", "checkbox", "person", "entity", "file"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type FieldOption = { value: string; labelVi: string; labelEn: string };

export type FormField = {
  /** Identifies the value in `values` and in a flow condition. */
  key: string;
  type: FieldType;
  labelVi: string;
  labelEn: string;
  /** One line under the field, in the designer's words. */
  hintVi?: string | null;
  hintEn?: string | null;
  required?: boolean;
  /** select / multi_select only. */
  options?: readonly FieldOption[];
  /** number / money: bounds on the value; multi_select: how many may be chosen. */
  min?: number | null;
  max?: number | null;
  /** date only: the earliest and latest day accepted, as ISO dates. */
  minDate?: string | null;
  maxDate?: string | null;
  /** text / textarea. */
  minLength?: number | null;
  maxLength?: number | null;
  /** text only, anchored when applied; a designer's typo must not become a catastrophic backtrack. */
  pattern?: string | null;
  /** Shown only while this holds of the other answers; hidden fields are never required and never stored. */
  visibleWhen?: Condition | null;
};

export type FormDefinition = { fields: readonly FormField[] };

/** What a filled-in form holds. A `file` field keeps the stored-file ids. */
export type FieldValue = string | number | boolean | string[] | null;
export type FormValues = Record<string, FieldValue>;

export const MAX_FIELDS = 30;
export const MAX_OPTIONS = 40;
export const MAX_TEXT = 4000;
export const MAX_FILES = 10;
/** 999,999,999,999 đồng: more than this company will ever request, and safely an integer. */
export const MAX_MONEY = 999_999_999_999;
const KEY = /^[a-z][a-z0-9_]{0,39}$/;

const isChoice = (type: FieldType) => type === "select" || type === "multi_select";
const isNumeric = (type: FieldType) => type === "number" || type === "money";

// ── What a designer may save ────────────────────────────────────────────────────────────────

export type FormProblem =
  | "too_many_fields"
  | "bad_key"
  | "duplicate_key"
  | "no_label"
  | "options_required"
  | "options_not_allowed"
  | "too_many_options"
  | "duplicate_option"
  | "bad_range"
  | "bad_pattern"
  | "condition_unknown_field"
  | "condition_on_self"
  | "condition_forward_reference";

/**
 * The rules a form must satisfy beyond its shape — the counterpart of `flowProblems`. A form with
 * no fields is fine (a request that is only its summary), but a broken one never reaches a user.
 */
export function formProblems(form: FormDefinition): FormProblem[] {
  const problems = new Set<FormProblem>();
  if (form.fields.length > MAX_FIELDS) problems.add("too_many_fields");
  const seen = new Set<string>();
  for (const [index, field] of form.fields.entries()) {
    if (!KEY.test(field.key)) problems.add("bad_key");
    if (seen.has(field.key)) problems.add("duplicate_key");
    seen.add(field.key);
    if (!field.labelVi?.trim() || !field.labelEn?.trim()) problems.add("no_label");

    if (isChoice(field.type)) {
      const options = field.options ?? [];
      if (options.length === 0) problems.add("options_required");
      if (options.length > MAX_OPTIONS) problems.add("too_many_options");
      if (new Set(options.map((option) => option.value)).size !== options.length) problems.add("duplicate_option");
    } else if (field.options?.length) problems.add("options_not_allowed");

    if (field.min != null && field.max != null && field.min > field.max) problems.add("bad_range");
    if (field.minLength != null && field.maxLength != null && field.minLength > field.maxLength) problems.add("bad_range");
    if (field.minDate && field.maxDate && field.minDate > field.maxDate) problems.add("bad_range");
    if (field.pattern) {
      try {
        new RegExp(field.pattern, "u");
      } catch {
        problems.add("bad_pattern");
      }
    }

    // A condition may only look backwards: the form is filled in from the top, and a field that
    // depends on an answer below it can never settle.
    if (field.visibleWhen) {
      if (field.visibleWhen.field === field.key) problems.add("condition_on_self");
      else {
        const source = form.fields.findIndex((other) => other.key === field.visibleWhen!.field);
        if (source < 0) problems.add("condition_unknown_field");
        else if (source > index) problems.add("condition_forward_reference");
      }
    }
  }
  return [...problems];
}

// ── Filling it in ───────────────────────────────────────────────────────────────────────────

/**
 * The fields shown for these answers, in order. A field whose source field is itself hidden is
 * hidden too: a question nobody was asked cannot decide anything.
 */
export function visibleFields(form: FormDefinition, values: FormValues): FormField[] {
  const shown: FormField[] = [];
  const visible = new Set<string>();
  for (const field of form.fields) {
    const condition = field.visibleWhen;
    if (condition && (!visible.has(condition.field) || !conditionHolds(condition, conditionData(shown, values)))) continue;
    shown.push(field);
    visible.add(field.key);
  }
  return shown;
}

/** The answers a condition is tested against: booleans and numbers as themselves, choices as their value. */
function conditionData(fields: readonly FormField[], values: FormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const value = values[field.key];
    data[field.key] = value ?? (field.type === "checkbox" ? false : null);
  }
  return data;
}

export type ValueProblem = { field: string; problem: string };

/**
 * Cleans and checks one submission against its form. The returned `values` hold only visible
 * fields, coerced to the shape the field promises — so the stored payload never carries an answer
 * to a question that was not asked.
 */
export function validateSubmission(form: FormDefinition, raw: FormValues): { values: FormValues; problems: ValueProblem[] } {
  const problems: ValueProblem[] = [];
  const values: FormValues = {};
  const refuse = (field: string, problem: string) => problems.push({ field, problem });

  for (const field of visibleFields(form, raw)) {
    const value = coerce(field, raw[field.key]);
    if (value === null || (Array.isArray(value) && value.length === 0) || value === "") {
      if (field.required) refuse(field.key, "required");
      // A checkbox is never "empty": false is an answer.
      values[field.key] = field.type === "checkbox" ? (value ?? false) : null;
      continue;
    }
    check(field, value, refuse);
    values[field.key] = value;
  }
  return { values, problems };
}

function coerce(field: FormField, raw: FieldValue | undefined): FieldValue {
  if (raw === undefined || raw === null) return field.type === "checkbox" ? false : null;
  switch (field.type) {
    case "checkbox":
      return raw === true || raw === "on" || raw === "true";
    case "number":
    case "money": {
      if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
      if (typeof raw !== "string" || raw.trim() === "") return null;
      const parsed = Number(plainNumber(raw));
      return Number.isFinite(parsed) ? parsed : Number.NaN;
    }
    case "multi_select":
      return (Array.isArray(raw) ? raw : [raw]).map(String).filter((value) => value !== "");
    case "file":
      return (Array.isArray(raw) ? raw : [raw]).map(String).filter((value) => value !== "");
    default:
      return typeof raw === "string" ? raw.trim() : String(raw);
  }
}

/**
 * A figure as it was typed, as a plain number string. Vietnamese writes 20.000.000 and 1,5; people
 * who learned elsewhere type 20,000,000. Both separators group thousands unless the last one can
 * only be a decimal point: the two kinds are mixed, or it stands alone without three digits behind
 * it. "1,500" is therefore fifteen hundred — the reading almost always meant for money in đồng.
 */
function plainNumber(raw: string): string {
  const text = raw.replaceAll(/[\s ]/g, "");
  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");
  const decimalAt = Math.max(lastDot, lastComma);
  if (decimalAt < 0) return text;
  const mixed = lastDot >= 0 && lastComma >= 0;
  const onlyOne = (text.match(/[.,]/g) ?? []).length === 1;
  const isDecimal = mixed || (onlyOne && !/^\d{3}$/.test(text.slice(decimalAt + 1)));
  const whole = (isDecimal ? text.slice(0, decimalAt) : text).replaceAll(/[.,]/g, "");
  return isDecimal ? `${whole}.${text.slice(decimalAt + 1)}` : whole;
}

function check(field: FormField, value: FieldValue, refuse: (field: string, problem: string) => void): void {
  switch (field.type) {
    case "number":
    case "money": {
      if (typeof value !== "number" || Number.isNaN(value)) return refuse(field.key, "not_a_number");
      if (field.type === "money" && !Number.isInteger(value)) return refuse(field.key, "not_whole_dong");
      if (field.type === "money" && (value < 0 || value > MAX_MONEY)) return refuse(field.key, "out_of_range");
      if (field.min != null && value < field.min) refuse(field.key, "below_min");
      if (field.max != null && value > field.max) refuse(field.key, "above_max");
      return;
    }
    case "date": {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) return refuse(field.key, "not_a_date");
      if (field.minDate && value < field.minDate) refuse(field.key, "below_min");
      if (field.maxDate && value > field.maxDate) refuse(field.key, "above_max");
      return;
    }
    case "select": {
      if (!(field.options ?? []).some((option) => option.value === value)) refuse(field.key, "not_an_option");
      return;
    }
    case "multi_select": {
      const allowed = new Set((field.options ?? []).map((option) => option.value));
      if (!Array.isArray(value) || value.some((entry) => !allowed.has(entry))) refuse(field.key, "not_an_option");
      else if (field.max != null && value.length > field.max) refuse(field.key, "above_max");
      else if (field.min != null && value.length < field.min) refuse(field.key, "below_min");
      return;
    }
    case "person":
    case "entity": {
      if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) refuse(field.key, "not_an_id");
      return;
    }
    case "file": {
      // Stored-file ids; whose files they are is the service's question (it needs the database).
      if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry))) return refuse(field.key, "not_a_file");
      if (value.length > MAX_FILES) refuse(field.key, "too_many_files");
      return;
    }
    case "checkbox":
      return;
    default: {
      if (typeof value !== "string") return refuse(field.key, "invalid");
      if (value.length > Math.min(field.maxLength ?? MAX_TEXT, MAX_TEXT)) refuse(field.key, "too_long");
      else if (field.minLength != null && value.length < field.minLength) refuse(field.key, "too_short");
      else if (field.pattern && !anchored(field.pattern).test(value)) refuse(field.key, "bad_format");
    }
  }
}

/** A designer's pattern always matches the whole answer — "\d{4}" must not pass "x1234y". */
function anchored(pattern: string): RegExp {
  const body = pattern.replace(/^\^/, "").replace(/\$$/, "");
  return new RegExp(`^(?:${body})$`, "u");
}

/**
 * The field keys a flow condition may test (FR-PLT-21): the answers that are a single comparable
 * value. "Above 20 million also needs the CEO" is exactly this.
 */
export function conditionFieldsOf(form: FormDefinition): string[] {
  return form.fields.filter((field) => isNumeric(field.type) || field.type === "select" || field.type === "checkbox").map((field) => field.key);
}

/** The values a flow's conditions are tested against, for a submission that already validated. */
export function flowConditionData(form: FormDefinition, values: FormValues): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const key of conditionFieldsOf(form)) {
    const value = values[key];
    if (value !== undefined && value !== null && !Array.isArray(value)) data[key] = value;
  }
  return data;
}
