"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { addDays, todayInVietnam } from "@/lib/dates";
import { canAdminTeam, findTeam, loadViewer, teamFacts } from "@/modules/work/service";
import { isoWeekday } from "./engine/rules";
import { REPORT_REACTIONS, RULE_MODES } from "./enums";
import { loadReportReader, loadSubjects } from "./people";
import { addToPlan, savePlan } from "./plans";
import { canCommentOnReport, canOverseeReport } from "./policy";
import { commentOnReport, findReportById, remindMissing, REPORT_BACKFILL_DAYS, submitReport } from "./reports";
import { saveTeamRules } from "./team-rules";
import { findWeekly, generateWeek, saveWeeklySummary } from "./weekly";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const isoDate = z.iso.date();
const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

function refreshDay() {
  revalidatePath("/today");
  revalidatePath("/daily", "layout");
}

// ── The morning plan ────────────────────────────────────────────────────────────────────────

const savePlanPipeline = createAction({
  name: "daily.plan.save",
  input: z.object({
    date: isoDate,
    items: z.array(z.object({ taskId: z.uuid(), minutes: optional(z.coerce.number().int().min(0).max(1440)) })).max(40),
    note: optional(z.string().trim().max(1000)),
  }),
  // One's own plan, for today or tomorrow: the service checks every task is the person's own work.
  authorize: (_user, input) => {
    const today = todayInVietnam();
    return input.date === today || input.date === addDays(today, 1);
  },
  run: async ({ user, input }) => {
    const { before, after } = await savePlan(user.person.id, input.date, input.items, input.note);
    refreshDay();
    return { data: { id: after.id, items: after.items.length }, audit: { resource: { type: "daily_plan", id: after.id }, summary: `${input.date}: ${after.items.length} tasks`, before: before ? { items: before.items, note: before.note } : undefined, after: { items: after.items, note: after.note } } };
  },
});
export async function savePlanAction(input: unknown) {
  return savePlanPipeline(input);
}

const addToPlanPipeline = createAction({
  name: "daily.plan.add",
  input: z.object({ taskId: z.uuid() }),
  authorize: () => true,
  run: async ({ user, input }) => {
    const plan = await addToPlan(user.person.id, todayInVietnam(), input.taskId);
    refreshDay();
    return { data: { id: plan.id }, audit: { resource: { type: "daily_plan", id: plan.id }, summary: `+ ${input.taskId}`, after: { taskId: input.taskId } } };
  },
});
export async function addToPlanAction(input: unknown) {
  return addToPlanPipeline(input);
}

// ── The end-of-day report ───────────────────────────────────────────────────────────────────

const submitReportPipeline = createAction({
  name: "daily.report.submit",
  input: z.object({
    date: isoDate,
    blockers: optional(z.string().trim().max(2000)),
    notes: optional(z.string().trim().max(2000)),
    tomorrow: z.array(z.uuid()).max(40).default([]),
    secondsToSubmit: optional(z.coerce.number().int().min(0).max(86400)),
  }),
  // One's own report, for today or the days of the past week.
  authorize: (_user, input) => {
    const today = todayInVietnam();
    return input.date <= today && input.date >= addDays(today, -REPORT_BACKFILL_DAYS);
  },
  run: async ({ user, input }) => {
    const { before, after } = await submitReport(user.person.id, input.date, input);
    refreshDay();
    revalidatePath(`/daily/reports/${after.id}`);
    return {
      data: { id: after.id, late: after.late },
      audit: { resource: { type: "daily_report", id: after.id }, summary: `${input.date}${after.late ? " (late)" : ""}`, before: before ? { status: before.status, submittedAt: before.submittedAt } : undefined, after: { status: after.status, late: after.late, done: after.done.length, notDone: after.notDone.length, tomorrow: after.tomorrow.length, secondsToSubmit: after.secondsToSubmit } },
    };
  },
});
export async function submitReportAction(input: unknown) {
  return submitReportPipeline(input);
}

const commentPipeline = createAction({
  name: "daily.report.comment",
  input: z.object({ reportId: z.uuid(), body: optional(z.string().trim().max(2000)), reaction: optional(z.enum(REPORT_REACTIONS)) }),
  authorize: async (user, input) => {
    const report = await findReportById(input.reportId);
    if (!report) return false;
    const [reader, subjects] = await Promise.all([loadReportReader(user.person.id), loadSubjects([report.personId])]);
    const subject = subjects.get(report.personId);
    return !!subject && canCommentOnReport(reader, subject);
  },
  run: async ({ user, input }) => {
    const { comment, report } = await commentOnReport(await loadReportReader(user.person.id), input.reportId, input, user.person.fullName);
    revalidatePath(`/daily/reports/${report.id}`);
    revalidatePath("/daily/team");
    return { data: { id: comment.id }, audit: { resource: { type: "daily_report", id: report.id }, summary: input.reaction ? `reaction ${input.reaction}` : `comment ${comment.id}`, after: { commentId: comment.id, reaction: input.reaction } } };
  },
});
export async function commentOnReportAction(input: unknown) {
  return commentPipeline(input);
}

const remindPipeline = createAction({
  name: "daily.report.remind",
  input: z.object({ date: isoDate, personIds: z.array(z.uuid()).min(1).max(300) }),
  // Only people the reader oversees; the service also skips whoever is not missing.
  authorize: async (user, input) => {
    if (input.date !== todayInVietnam()) return false;
    const [reader, subjects] = await Promise.all([loadReportReader(user.person.id), loadSubjects(input.personIds)]);
    return input.personIds.every((personId) => {
      const subject = subjects.get(personId);
      return !!subject && canOverseeReport(reader, subject);
    });
  },
  run: async ({ user, input }) => {
    const told = await remindMissing(await loadReportReader(user.person.id), input.personIds, input.date, user.person.fullName);
    revalidatePath("/daily/team");
    return { data: { reminded: told.length }, audit: { resource: { type: "daily_report", id: null }, summary: `${input.date}: reminded ${told.length} of ${input.personIds.length}`, after: { told } } };
  },
});
export async function remindAction(input: unknown) {
  return remindPipeline(input);
}

// ── A team's rules ──────────────────────────────────────────────────────────────────────────

const teamRulesPipeline = createAction({
  name: "daily.team_rules.save",
  input: z
    .object({
      teamId: z.uuid(),
      planMode: z.enum(RULE_MODES),
      reportMode: z.enum(RULE_MODES),
      reportDays: z.array(z.coerce.number().int().min(1).max(7)).max(7).default([]),
      planCutoff: timeOfDay,
      reportDeadline: timeOfDay,
      timeMode: z.enum(RULE_MODES),
      timesheetApproval: checkbox,
      coverMinDays: z.coerce.number().int().min(1).max(30),
      cycleWeeks: optional(z.coerce.number().int().min(1).max(4)),
      cycleStart: optional(isoDate),
    })
    // Cycles start on a Monday, and a length needs a start.
    .refine((input) => !input.cycleWeeks || (!!input.cycleStart && isoWeekday(input.cycleStart) === 1), { path: ["cycleStart"] }),
  authorize: async (user, input) => {
    const team = await findTeam(input.teamId);
    return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
  },
  run: async ({ input }) => {
    const { teamId, ...rules } = input;
    const { before, after } = await saveTeamRules(teamId, { ...rules, reportDays: [...new Set(rules.reportDays)], cycleStart: rules.cycleWeeks ? rules.cycleStart : null });
    revalidatePath(`/work/teams/${teamId}`);
    refreshDay();
    return { data: { teamId }, audit: { resource: { type: "work_team", id: teamId }, summary: `daily rules: report ${after.reportMode}, plan ${after.planMode}, time ${after.timeMode}`, before, after } };
  },
});
export async function saveTeamRulesAction(input: unknown) {
  return teamRulesPipeline(input);
}

// ── Weekly reports ──────────────────────────────────────────────────────────────────────────

const weeklySummaryPipeline = createAction({
  name: "daily.weekly.summary",
  input: z.object({ id: z.uuid(), summary: optional(z.string().trim().max(5000)) }),
  // A team's summary is its lead's (or whoever runs the team); a person's, the people above them.
  authorize: async (user, input) => {
    const row = await findWeekly(input.id);
    if (!row) return false;
    if (row.subjectType === "team") {
      const team = await findTeam(row.subjectId);
      return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
    }
    const [reader, subjects] = await Promise.all([loadReportReader(user.person.id), loadSubjects([row.subjectId])]);
    const subject = subjects.get(row.subjectId);
    return !!subject && canOverseeReport(reader, subject);
  },
  run: async ({ user, input }) => {
    const { before, after } = await saveWeeklySummary(input.id, input.summary, user.person.id);
    revalidatePath("/daily/weekly");
    return { data: { id: after.id }, audit: { resource: { type: "daily_weekly_report", id: after.id }, summary: `${after.subjectType} ${after.weekStart}`, before: { summary: before.summary }, after: { summary: after.summary } } };
  },
});
export async function saveWeeklySummaryAction(input: unknown) {
  return weeklySummaryPipeline(input);
}

const refreshWeekPipeline = createAction({
  name: "daily.weekly.generate",
  input: z.object({ teamId: z.uuid(), weekStart: isoDate.refine((date) => isoWeekday(date) === 1) }),
  authorize: async (user, input) => {
    if (input.weekStart > todayInVietnam()) return false;
    const team = await findTeam(input.teamId);
    return !!team && canAdminTeam(await loadViewer(user), teamFacts(team));
  },
  run: async ({ input }) => {
    const result = await generateWeek(input.weekStart, { teamIds: [input.teamId], notify: false });
    revalidatePath("/daily/weekly");
    return { data: result, audit: { resource: { type: "work_team", id: input.teamId }, summary: `weekly report ${input.weekStart}`, after: result } };
  },
});
export async function generateTeamWeekAction(input: unknown) {
  return refreshWeekPipeline(input);
}
