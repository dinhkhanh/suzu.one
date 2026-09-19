// Intake forms (FR-WRK-16). Pure: checking a form's definition, checking a submission against it,
// and turning the answers into the task's description.
export const INTAKE_FIELD_TYPES = ["text", "long_text", "select", "date", "url"] as const;
export type IntakeFieldType = (typeof INTAKE_FIELD_TYPES)[number];
export type IntakeField = { key: string; label: string; type: IntakeFieldType; required: boolean; options?: string[] };

export const MAX_INTAKE_FIELDS = 12;
const LIMITS: Record<IntakeFieldType, number> = { text: 200, long_text: 4000, select: 200, date: 10, url: 500 };

export type FormProblem = "intake_fields_required" | "intake_too_many_fields" | "intake_field_label_required" | "intake_field_key_duplicate" | "intake_field_type_invalid" | "intake_select_needs_options";

/** `key` is derived from the position so labels can change without orphaning anything. */
export function fieldKey(index: number): string {
  return `f${index + 1}`;
}

export function formProblem(fields: readonly IntakeField[]): FormProblem | null {
  if (fields.length === 0) return "intake_fields_required";
  if (fields.length > MAX_INTAKE_FIELDS) return "intake_too_many_fields";
  if (new Set(fields.map((field) => field.key)).size !== fields.length) return "intake_field_key_duplicate";
  for (const field of fields) {
    if (!field.label.trim()) return "intake_field_label_required";
    if (!(INTAKE_FIELD_TYPES as readonly string[]).includes(field.type)) return "intake_field_type_invalid";
    if (field.type === "select" && (field.options ?? []).filter((option) => option.trim()).length < 2) return "intake_select_needs_options";
  }
  return null;
}

export type AnswerProblem = { key: string; problem: "required" | "too_long" | "not_an_option" | "not_a_date" | "not_a_url" };

/** Unknown keys are dropped; blank answers are fine unless the field is required. */
export function checkAnswers(fields: readonly IntakeField[], raw: Record<string, unknown>): { answers: Record<string, string>; problems: AnswerProblem[] } {
  const answers: Record<string, string> = {};
  const problems: AnswerProblem[] = [];
  for (const field of fields) {
    const value = typeof raw[field.key] === "string" ? (raw[field.key] as string).trim() : "";
    if (!value) {
      if (field.required) problems.push({ key: field.key, problem: "required" });
      continue;
    }
    if (value.length > LIMITS[field.type]) problems.push({ key: field.key, problem: "too_long" });
    else if (field.type === "select" && !(field.options ?? []).includes(value)) problems.push({ key: field.key, problem: "not_an_option" });
    else if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`)))) problems.push({ key: field.key, problem: "not_a_date" });
    else if (field.type === "url" && !/^https:\/\/[^\s]+$/i.test(value)) problems.push({ key: field.key, problem: "not_a_url" });
    else answers[field.key] = value;
  }
  return { answers, problems };
}

/** The answers as the task's description: one "Label: value" block per answered field, in the form's order. */
export function describeAnswers(formName: string, fields: readonly IntakeField[], answers: Record<string, string>): string {
  const blocks = fields.filter((field) => answers[field.key]).map((field) => (field.type === "long_text" ? `${field.label}:\n${answers[field.key]}` : `${field.label}: ${field.type === "date" ? answers[field.key].split("-").reverse().join("/") : answers[field.key]}`));
  return [`[${formName}]`, ...blocks].join("\n\n");
}

/** The first date answer, if any, becomes the task's due date ("needed by"). */
export function dueDateFrom(fields: readonly IntakeField[], answers: Record<string, string>): string | null {
  const field = fields.find((candidate) => candidate.type === "date" && answers[candidate.key]);
  return field ? answers[field.key] : null;
}
