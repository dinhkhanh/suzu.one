"use server";
// Intake forms (FR-WRK-16): team leads keep the forms; anyone the policy lets in submits a request.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { INTAKE_FIELD_TYPES, MAX_INTAKE_FIELDS } from "./engine/intake";
import { INTAKE_AUDIENCES, type IntakeAudience } from "./enums";
import { findIntakeForm, saveIntakeForm, submitIntake } from "./intake";
import { canAdminTeam, canSubmitIntake } from "./policy";
import { findTeam, teamFacts } from "./teams";
import { loadViewer } from "./viewer";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

const field = z.object({
  label: z.string().trim().min(1).max(120),
  type: z.enum(INTAKE_FIELD_TYPES),
  required: checkbox,
  // One option per line in the form.
  options: z.preprocess((value) => (typeof value === "string" ? value.split("\n").map((line) => line.trim()).filter(Boolean) : value), z.array(z.string().max(120)).max(30).optional()),
});

const savePipeline = createAction({
  name: "work.intake.save",
  input: z.object({
    teamId: z.uuid(),
    formId: optional(z.uuid()),
    name: z.string().trim().min(1).max(120),
    description: optional(z.string().trim().max(1000)),
    projectId: optional(z.uuid()),
    audience: z.enum(INTAKE_AUDIENCES).default("entity"),
    isActive: checkbox,
    // The form posts fields as "fields.0.label" …: an object keyed by index. Rows without a label are blank rows of the editor.
    fields: z.preprocess((value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.values(value as Record<string, unknown>) : value), z.array(z.unknown()).max(MAX_INTAKE_FIELDS * 2)).transform((rows) => rows.filter((row) => typeof (row as { label?: unknown })?.label === "string" && (row as { label: string }).label.trim() !== "")).pipe(z.array(field).max(MAX_INTAKE_FIELDS)),
  }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
  },
  run: async ({ user, input }) => {
    const { teamId, formId, ...values } = input;
    const { before, after } = await saveIntakeForm(teamId, formId, values, user.person.id);
    revalidatePath(`/work/teams/${teamId}`);
    revalidatePath("/work/intake");
    return { data: { id: after.id }, audit: { resource: { type: "work_intake_form", id: after.id }, summary: after.name, before, after } };
  },
});
export async function saveIntakeFormAction(input: unknown) {
  return savePipeline(input);
}

const submitPipeline = createAction({
  name: "work.intake.submit",
  input: z.object({ formId: z.uuid(), title: z.string().trim().min(1).max(200), answers: z.record(z.string(), z.unknown()).default({}) }),
  authorize: async (user, input) => {
    const found = await findIntakeForm(input.formId);
    return !!found && canSubmitIntake(await loadViewer(user), teamFacts(found.team), found.form.audience as IntakeAudience);
  },
  run: async ({ user, input }) => {
    const submission = await submitIntake(input.formId, { title: input.title, answers: input.answers }, { personId: user.person.id, fullName: user.person.fullName });
    revalidatePath("/work/intake");
    revalidatePath("/tasks");
    // The answers are in the task; the audit log records that a request was made, not its words.
    return { data: submission, audit: { resource: { type: "task:work", id: submission.taskId }, summary: `${submission.key} via intake form`, after: { formId: input.formId, taskId: submission.taskId } } };
  },
});
export async function submitIntakeAction(input: unknown) {
  return submitPipeline(input);
}
