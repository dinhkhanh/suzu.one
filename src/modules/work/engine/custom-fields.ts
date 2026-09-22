// Custom fields (FR-PJM-35). Pure: checking a field's definition and a value against it, and the
// list's filtering, sorting and grouping by a field — the browser and the server run the same code,
// so what the table shows is what a bulk edit will write.
import { toSearchKey } from "@/lib/text";

export const CUSTOM_FIELD_TYPES = ["text", "number", "select", "multi_select", "date", "person", "url", "checkbox", "duration"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];
export type CustomValue = string | number | boolean | string[] | null;
export type FieldOption = { id: string; label: string; color?: string };
/** What the screens get of a field. */
export type FieldView = { id: string; name: string; type: CustomFieldType; options: FieldOption[]; showOnCard: boolean; projectId: string | null; isActive: boolean; sortOrder: number };
export type CustomFieldDef = { id: string; name: string; type: CustomFieldType; options: readonly FieldOption[]; teamId: string | null; projectId: string | null; isActive: boolean };

export const MAX_CUSTOM_FIELDS = 30;
export const MAX_FIELD_OPTIONS = 50;
const TEXT_LIMIT = 500;
const URL_LIMIT = 1000;
/** A duration is whole minutes; 1,000 hours is more than any single task. */
const DURATION_LIMIT = 60_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type FieldProblem = "custom_field_name_required" | "custom_field_type_invalid" | "custom_field_needs_options" | "custom_field_too_many_options" | "custom_field_option_duplicate";

export function fieldDefinitionProblem(field: { name: string; type: string; options: readonly FieldOption[] }): FieldProblem | null {
  if (!field.name.trim()) return "custom_field_name_required";
  if (!(CUSTOM_FIELD_TYPES as readonly string[]).includes(field.type)) return "custom_field_type_invalid";
  if (field.type !== "select" && field.type !== "multi_select") return null;
  const labels = field.options.map((option) => toSearchKey(option.label)).filter(Boolean);
  if (labels.length === 0) return "custom_field_needs_options";
  if (field.options.length > MAX_FIELD_OPTIONS) return "custom_field_too_many_options";
  if (new Set(labels).size !== labels.length || new Set(field.options.map((option) => option.id)).size !== field.options.length) return "custom_field_option_duplicate";
  return null;
}

/** The fields a task has: its team's, plus its project's own. */
export function applicableFields<Field extends Pick<CustomFieldDef, "teamId" | "projectId" | "isActive">>(fields: readonly Field[], task: { teamId: string; projectId: string | null }): Field[] {
  return fields.filter((field) => field.isActive && field.teamId === task.teamId && (field.projectId === null || field.projectId === task.projectId));
}

export type ValueProblem = "not_text" | "too_long" | "not_a_number" | "not_an_option" | "not_a_date" | "not_a_person" | "not_a_url" | "not_a_duration";

const isDate = (value: string) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * A value as the field keeps it. Blank (null, "", [], undefined) clears the field. Numbers may
 * arrive as text from a form; a person is checked for existence by the service, not here.
 */
export function checkCustomValue(field: Pick<CustomFieldDef, "type" | "options">, raw: unknown): { ok: true; value: CustomValue } | { ok: false; problem: ValueProblem } {
  if (raw === null || raw === undefined || raw === "" || (Array.isArray(raw) && raw.length === 0)) return { ok: true, value: null };
  const text = typeof raw === "string" ? raw.trim() : null;
  const optionIds = new Set(field.options.map((option) => option.id));
  switch (field.type) {
    case "text":
      if (text === null) return { ok: false, problem: "not_text" };
      if (text.length > TEXT_LIMIT) return { ok: false, problem: "too_long" };
      return { ok: true, value: text || null };
    case "number": {
      const value = typeof raw === "number" ? raw : text !== null && text !== "" ? Number(text.replace(",", ".")) : Number.NaN;
      return Number.isFinite(value) ? { ok: true, value } : { ok: false, problem: "not_a_number" };
    }
    case "duration": {
      const value = typeof raw === "number" ? raw : text !== null && /^\d+$/.test(text) ? Number(text) : Number.NaN;
      return Number.isInteger(value) && value >= 0 && value <= DURATION_LIMIT ? { ok: true, value } : { ok: false, problem: "not_a_duration" };
    }
    case "select":
      return text !== null && optionIds.has(text) ? { ok: true, value: text } : { ok: false, problem: "not_an_option" };
    case "multi_select": {
      if (!Array.isArray(raw) || raw.some((item) => typeof item !== "string" || !optionIds.has(item))) return { ok: false, problem: "not_an_option" };
      // Kept in the field's option order, so two equal choices look equal.
      const chosen = new Set(raw as string[]);
      return { ok: true, value: field.options.map((option) => option.id).filter((id) => chosen.has(id)) };
    }
    case "date":
      return text !== null && isDate(text) ? { ok: true, value: text } : { ok: false, problem: "not_a_date" };
    case "person":
      return text !== null && UUID.test(text) ? { ok: true, value: text.toLowerCase() } : { ok: false, problem: "not_a_person" };
    case "url":
      if (text === null || !/^https?:\/\/[^\s]+$/i.test(text)) return { ok: false, problem: "not_a_url" };
      return text.length > URL_LIMIT ? { ok: false, problem: "too_long" } : { ok: true, value: text };
    case "checkbox":
      if (typeof raw === "boolean") return { ok: true, value: raw };
      if (text === "1" || text === "true" || text === "on") return { ok: true, value: true };
      if (text === "0" || text === "false") return { ok: true, value: false };
      return { ok: false, problem: "not_text" };
  }
}

/**
 * A stored value as it reads today: an option that was deleted since is gone, a value of the wrong
 * shape (the field's type never changes, but data outlives code) is treated as empty.
 */
export function currentValue(field: Pick<CustomFieldDef, "type" | "options">, stored: unknown): CustomValue {
  if (stored === null || stored === undefined) return null;
  if (field.type === "multi_select") {
    if (!Array.isArray(stored)) return null;
    const kept = stored.filter((id) => field.options.some((option) => option.id === id));
    return kept.length ? kept : null;
  }
  const checked = checkCustomValue(field, stored);
  return checked.ok ? checked.value : null;
}

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours && rest ? `${hours}h${String(rest).padStart(2, "0")}` : hours ? `${hours}h` : `${rest}m`;
};

/** Plain text for the activity log and exports; people's names come from the caller. */
export function displayCustomValue(field: Pick<CustomFieldDef, "type" | "options">, stored: unknown, names: ReadonlyMap<string, string> = new Map()): string | null {
  const value = currentValue(field, stored);
  if (value === null) return null;
  const label = (id: string) => field.options.find((option) => option.id === id)?.label ?? id;
  switch (field.type) {
    case "select":
      return label(value as string);
    case "multi_select":
      return (value as string[]).map(label).join(", ");
    case "person":
      return names.get(value as string) ?? (value as string);
    case "duration":
      return formatDuration(value as number);
    case "date":
      return (value as string).split("-").reverse().join("/");
    case "checkbox":
      return value ? "✓" : "✗";
    default:
      return String(value);
  }
}

// ── The list: filter, sort, group ───────────────────────────────────────────────────────────

/** URL parameters of a field: `cf.<fieldId>`. Grouping and sorting name a field as `cf.<fieldId>` too. */
export const CUSTOM_PREFIX = "cf.";
export const customKey = (fieldId: string) => `${CUSTOM_PREFIX}${fieldId}`;
export const fieldIdOf = (key: string): string | null => (key.startsWith(CUSTOM_PREFIX) && UUID.test(key.slice(CUSTOM_PREFIX.length)) ? key.slice(CUSTOM_PREFIX.length) : null);

/** The special filter values every type understands. */
export const EMPTY = "~empty";
export const SET = "~set";

function compareNumbers(value: number, filter: string): boolean {
  const match = /^([<>=])?\s*(-?\d+(?:[.,]\d+)?)$/.exec(filter);
  if (!match) return false;
  const limit = Number(match[2].replace(",", "."));
  return match[1] === ">" ? value > limit : match[1] === "<" ? value < limit : value === limit;
}

/**
 * One field's filter: `~empty` / `~set` for any type; otherwise an option id (select: equals,
 * multi-select: contains), a person id or "me", "1"/"0" for a checkbox, words for text and URLs,
 * `>n` / `<n` / `n` for numbers and durations (minutes), `>date` / `<date` / `date` for dates.
 */
export function matchesCustomFilter(field: Pick<CustomFieldDef, "type" | "options">, stored: unknown, filter: string, context: { selfId: string | null }): boolean {
  const value = currentValue(field, stored);
  if (filter === EMPTY) return value === null || value === false;
  if (filter === SET) return value !== null && value !== false;
  switch (field.type) {
    case "checkbox":
      return filter === "1" ? value === true : value !== true;
    case "select":
      return value === filter;
    case "multi_select":
      return Array.isArray(value) && value.includes(filter);
    case "person":
      return value !== null && value === (filter === "me" ? context.selfId : filter.toLowerCase());
    case "number":
    case "duration":
      return typeof value === "number" && compareNumbers(value, filter.trim());
    case "date": {
      if (typeof value !== "string") return false;
      const match = /^([<>])?(\d{4}-\d{2}-\d{2})$/.exec(filter.trim());
      if (!match) return false;
      return match[1] === "<" ? value < match[2] : match[1] === ">" ? value > match[2] : value === match[2];
    }
    default: {
      if (typeof value !== "string") return false;
      const haystack = toSearchKey(value);
      return toSearchKey(filter)
        .split(" ")
        .filter(Boolean)
        .every((word) => haystack.includes(word));
    }
  }
}

/** Ascending order of two values; empty values go last whichever way the list is sorted (the caller flips the rest). */
export function compareCustomValues(field: Pick<CustomFieldDef, "type" | "options">, a: unknown, b: unknown, names: ReadonlyMap<string, string> = new Map()): number {
  const [left, right] = [currentValue(field, a), currentValue(field, b)];
  if (left === null || right === null) return left === right ? 0 : left === null ? 1 : -1;
  const optionIndex = (id: string) => field.options.findIndex((option) => option.id === id);
  switch (field.type) {
    case "number":
    case "duration":
      return (left as number) - (right as number);
    case "checkbox":
      return Number(right) - Number(left);
    case "select":
      return optionIndex(left as string) - optionIndex(right as string);
    case "multi_select":
      return optionIndex((left as string[])[0]) - optionIndex((right as string[])[0]) || (left as string[]).length - (right as string[]).length;
    case "person":
      return (names.get(left as string) ?? (left as string)).localeCompare(names.get(right as string) ?? (right as string), "vi");
    default:
      return String(left).localeCompare(String(right), "vi");
  }
}

/** Which groups a task falls in: a multi-select puts it under each of its choices; an empty value under "none". */
export function customGroupKeys(field: Pick<CustomFieldDef, "type" | "options">, stored: unknown): string[] {
  const value = currentValue(field, stored);
  if (value === null) return ["none"];
  if (Array.isArray(value)) return value;
  if (typeof value === "boolean") return [value ? "1" : "0"];
  return [String(value)];
}
