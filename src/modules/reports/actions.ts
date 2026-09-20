"use server";
// Scheduled reports and report exports (FR-RPT-05). Every mutation goes through `createAction`, so
// each one is parsed, authenticated, authorized and audited.
//
// Authorization here is two questions, never one: may this person *touch this schedule* (its
// creator, or `org:manage`), and may they *read this report* (the catalogue's own `canSee`). The
// second is asked again inside `createSchedule`, and a third time — per recipient — when the job
// runs. Recipients are people, and naming somebody grants them nothing.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { todayInVietnam } from "@/lib/dates";
import { buildReportFor, findReport, isSchedulable, needsStepUp, REPORT_KEYS, reportToCsv } from "./catalogue";
import { canEditSchedule, canManageSchedules } from "./policy";
import { createSchedule, deleteSchedule, findSchedule, setScheduleActive, updateSchedule } from "./schedules";

const locale = z.enum(["vi", "en"]).default("vi");
const parameters = z.record(z.string(), z.unknown()).default({});

const scheduleInput = z.object({
  reportKey: z.enum(REPORT_KEYS as [string, ...string[]]),
  name: z.string().trim().min(1).max(120),
  parameters,
  cadence: z.enum(["daily", "weekly", "monthly"]),
  dayOfWeek: z.coerce.number().int().min(1).max(7).nullable().default(null),
  dayOfMonth: z.coerce.number().int().min(1).max(31).nullable().default(null),
  locale,
  recipientPersonIds: z.array(z.uuid()).max(50).default([]),
});

const describe = (input: z.output<typeof scheduleInput>) => `${input.reportKey} ${input.cadence} → ${input.recipientPersonIds.length} recipients`;

const createPipeline = createAction({
  name: "report.schedule.create",
  input: scheduleInput,
  authorize: async (user, input) => {
    if (!canManageSchedules(user.principal) || !isSchedulable(input.reportKey)) return false;
    const definition = findReport(input.reportKey);
    return !!definition && (await definition.canSee(user));
  },
  run: async ({ user, input }) => {
    const row = await createSchedule(user, { ...input, locale: input.locale }, todayInVietnam());
    revalidatePath("/reports/schedules");
    return { data: { id: row.id }, audit: { resource: { type: "report_schedule", id: row.id }, summary: describe(input), after: { ...input } } };
  },
});

export async function createScheduleAction(input: unknown) {
  return createPipeline(input);
}

const updatePipeline = createAction({
  name: "report.schedule.update",
  input: scheduleInput.extend({ id: z.uuid() }),
  authorize: async (user, input) => {
    const schedule = await findSchedule(input.id);
    if (!schedule || !canEditSchedule({ personId: user.person.id, principal: user.principal }, schedule)) return false;
    if (!isSchedulable(input.reportKey)) return false;
    const definition = findReport(input.reportKey);
    return !!definition && (await definition.canSee(user));
  },
  run: async ({ input }) => {
    const { id, ...rest } = input;
    const { before, after } = await updateSchedule(id, rest, todayInVietnam());
    revalidatePath("/reports/schedules");
    return { data: { id: after.id }, audit: { resource: { type: "report_schedule", id }, summary: describe(input), before, after } };
  },
});

export async function updateScheduleAction(input: unknown) {
  return updatePipeline(input);
}

const pausePipeline = createAction({
  name: "report.schedule.set_active",
  input: z.object({ id: z.uuid(), isActive: z.boolean() }),
  authorize: async (user, input) => {
    const schedule = await findSchedule(input.id);
    return !!schedule && canEditSchedule({ personId: user.person.id, principal: user.principal }, schedule);
  },
  run: async ({ input }) => {
    const { before, after } = await setScheduleActive(input.id, input.isActive, todayInVietnam());
    revalidatePath("/reports/schedules");
    return { data: { isActive: after.isActive }, audit: { resource: { type: "report_schedule", id: input.id }, summary: input.isActive ? "resumed" : "paused", before, after } };
  },
});

export async function setScheduleActiveAction(input: unknown) {
  return pausePipeline(input);
}

const deletePipeline = createAction({
  name: "report.schedule.delete",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const schedule = await findSchedule(input.id);
    return !!schedule && canEditSchedule({ personId: user.person.id, principal: user.principal }, schedule);
  },
  run: async ({ input }) => {
    const after = await deleteSchedule(input.id);
    revalidatePath("/reports/schedules");
    return { data: { id: after.id }, audit: { resource: { type: "report_schedule", id: input.id }, summary: `deleted ${after.reportKey}`, after } };
  },
});

export async function deleteScheduleAction(input: unknown) {
  return deletePipeline(input);
}

// ── Exporting a catalogue report on demand (FR-RPT-05: every report is exportable) ───────────

const day = z.iso.date();

const exportPipeline = createAction({
  name: "report.export",
  input: z.object({ reportKey: z.enum(REPORT_KEYS as [string, ...string[]]), parameters, from: day, to: day, locale }),
  // The catalogue entry's own `canSee` — the same predicate its screen checks. `buildReportFor`
  // asks it a second time, so an export can never outrun the permission it was started with.
  // A compensation report also wants a fresh proof of identity, exactly as its screen does: an
  // export must not be the quiet way past step-up (FR-PLT-06).
  authorize: async (user, input) => {
    if (needsStepUp(input.reportKey) && !isStepUpFresh(user.reauthAt)) return false;
    const definition = findReport(input.reportKey);
    return !!definition && (await definition.canSee(user));
  },
  run: async ({ user, input }) => {
    const period = { from: input.from, to: input.to };
    const table = await buildReportFor(user, input.reportKey, input.parameters, period, input.locale);
    if (!table) return { data: { fileName: "", csv: "", rowCount: 0, truncated: false }, audit: { resource: { type: `export:report:${input.reportKey}` }, summary: "refused" } };
    const file = reportToCsv(table, `${input.reportKey}-${input.from}_${input.to}.csv`);
    return { data: file, audit: { resource: { type: `export:report:${input.reportKey}` }, summary: `${file.rowCount} rows`, after: { parameters: input.parameters, period, rowCount: file.rowCount } } };
  },
});

export async function exportReportAction(input: unknown) {
  return exportPipeline(input);
}
