// Proposals on the asker's own day (Phase 13 R4, FR-AGT-21): log time, put a task on today's plan,
// send the end-of-day report. Every one ends in `propose()` — a card for the asker, nothing changed —
// and is checked first as its action and service will check it when confirmed: the day by
// `withinTimeWindow` / `withinReportWindow`, a task to log on by `canViewTask`, a task to plan or to
// carry into tomorrow among the asker's own open work — the very list the service accepts.
import "server-only";
import { z } from "zod";
import { recordHref } from "@/lib/record-routes";
import { addToPlanInput, firstReadersOf, getPlanPage, getReportForm, logTimeInput, submitReportInput, TIME_CATEGORIES, weekStartOf, withinReportWindow, withinTimeWindow } from "@/modules/daily/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { countOpenBlockersRaisedBy, type LoadedTask, taskKey } from "@/modules/work/service";
import { draftEodNotes } from "../../drafts";
import { pickNamedRow } from "../../engine/name-match";
import { modelText } from "../../engine/views";
import type { ProposalField } from "../../enums";
import { isUuid, notifyNames, notProposed, propose } from "../propose";
import { type AnyAgentTool, defineTool } from "../registry";
import { failed, taskNamed } from "./propose-work";

const everyone = () => true;
const DATE = z.iso.date();
const TASK_REF = z.string().min(1).max(120).describe("The task's key (e.g. VID-12), words of its title, or a taskId a tool gave you.");
const NOTES_MAX = 2000;

const hoursOf = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

type OwnTask = { taskId: string; key: string; title: string };

/** One task among the asker's own work (a list the daily module gave), by id, key or words of its title. */
function ownTaskNamed<Row extends OwnTask>(tasks: readonly Row[], ref: string): { one: Row } | { many: Row[] } | { none: true } {
  const wanted = ref.trim();
  const byId = isUuid(wanted) ? tasks.find((task) => task.taskId === wanted) : undefined;
  if (byId) return { one: byId };
  const byKey = tasks.find((task) => task.key.toLowerCase() === wanted.toLowerCase());
  if (byKey) return { one: byKey };
  const picked = pickNamedRow(tasks, wanted, (task) => [task.title]);
  return "one" in picked ? { one: picked.one } : "many" in picked ? { many: picked.many.slice(0, 8) } : picked;
}

const ownLine = (task: OwnTask) => `${task.key} · ${task.title}`;
const NOT_OWN = "Only open tasks assigned to the asker, or that they collaborate on, can go on their plan.";

// ── Log time ────────────────────────────────────────────────────────────────────────────────

const proposeTimeLog = defineTool({
  name: "propose_time_log",
  module: "daily",
  description:
    "Proposes logging the asker's own time for them to confirm (nothing is logged until they do). Give the minutes, and EITHER the task (key, title or taskId) OR a category for time on no task (internal, admin, pitch, training, idle); the date (YYYY-MM-DD, default today; a recent day only); an optional short note.",
  input: z.strictObject({
    task: TASK_REF.optional(),
    category: z.enum(TIME_CATEGORIES).optional(),
    minutes: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .describe("Whole minutes: 1h30 is 90."),
    date: DATE.optional().describe("YYYY-MM-DD; today when left out."),
    note: z.string().max(500).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today } = context;
    if (!input.task === !input.category) return notProposed("task_or_category", { next: "Ask the asker which task the time was on, or which kind of time on no task." });
    const date = input.date ?? today;
    if (!(await withinTimeWindow(user.person.id, date, today))) return notProposed("outside_time_window", { note: "Time can be logged for today and recent days only, not ahead and not in a week already sent for approval." });
    let loaded: LoadedTask | null = null;
    if (input.task) {
      // The check `daily.time.log` makes: a task the asker may see.
      const found = await taskNamed(user, input.task);
      if (failed(found)) return found;
      loaded = found.loaded;
    }
    const label = loaded ? `${taskKey(loaded.team.key, loaded.work.number)} · ${loaded.task.title}` : null;
    const note = input.note?.trim() || null;
    const fields: ProposalField[] = [
      loaded ? { key: "task", text: label!, href: recordHref("task", loaded.task.id) } : { key: "category", valueKey: `category_${input.category}` },
      { key: "date", text: date },
      { key: "duration", valueKey: "duration", params: { hours: hoursOf(input.minutes), minutes: input.minutes } },
      ...(note ? [{ key: "note", text: note }] : []),
    ];
    return propose(context, "propose_time_log", {
      action: "daily.time.log",
      schema: logTimeInput,
      input: { date, taskId: loaded?.task.id ?? null, category: loaded ? null : input.category!, minutes: input.minutes, note, billable: "default" },
      fields,
      notify: [],
      editHref: loaded ? recordHref("task", loaded.task.id) : `/daily/time?week=${weekStartOf(date)}`,
      subject: loaded ? { type: "task", id: loaded.task.id } : null,
      summary: { task: label, category: input.category ?? null, date, minutes: input.minutes, note },
    });
  },
});

// ── Today's plan ────────────────────────────────────────────────────────────────────────────

const proposePlanToday = defineTool({
  name: "propose_plan_today",
  module: "daily",
  description: "Proposes adding one of the asker's own open tasks to today's plan, for them to confirm (nothing changes until they do). Name the task by key, title or taskId.",
  input: z.strictObject({ task: TASK_REF }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today } = context;
    // The plan page's own lists: the asker's open work, and what today's plan already holds (saved, or carried over from yesterday's report).
    const page = await getPlanPage(user.person.id, today);
    const picked = ownTaskNamed(page.candidates, input.task);
    if ("many" in picked) return notProposed("several_tasks", { tasks: picked.many.map((task) => ({ taskId: task.taskId, key: task.key, title: modelText(task.title) })), next: "Ask the asker which task." });
    if ("none" in picked) return notProposed("not_your_open_work", { note: NOT_OWN });
    const task = picked.one;
    if (page.selected.some((item) => item.taskId === task.taskId)) return notProposed("already_in_plan", { task: task.key });
    return propose(context, "propose_plan_today", {
      action: "daily.plan.add",
      schema: addToPlanInput,
      input: { taskId: task.taskId },
      fields: [
        { key: "task", text: ownLine(task), href: recordHref("task", task.taskId) },
        { key: "date", text: today },
      ],
      notify: [],
      editHref: "/daily/plan",
      subject: { type: "task", id: task.taskId },
      summary: { task: ownLine(task), date: today },
    });
  },
});

// ── The end-of-day report ───────────────────────────────────────────────────────────────────

const proposeEodReport = defineTool({
  name: "propose_eod_report",
  module: "daily",
  description:
    "Proposes sending the asker's end-of-day report for them to confirm (nothing is sent until they do). What was done and not done is filled in from the record by the app. Give the date (YYYY-MM-DD, default today; the past week at most); notes only in the asker's own words if they gave some — leave them out and the app drafts them from the day's activity; blockers if the asker named any; tomorrow: the tasks (keys or titles) they mean to work on next — leave it out to carry over what is not done.",
  input: z.strictObject({
    date: DATE.optional().describe("YYYY-MM-DD; today when left out."),
    notes: z.string().max(NOTES_MAX).optional(),
    blockers: z.string().max(NOTES_MAX).optional(),
    tomorrow: z.array(TASK_REF).max(40).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today, locale } = context;
    const personId = user.person.id;
    const date = input.date ?? today;
    if (!withinReportWindow(date, today)) return notProposed("outside_report_window", { note: "A report can be sent for today or the past seven days." });
    const form = await getReportForm(personId, date);
    // A sent report is edited on its own form, by the person: a card would put words over theirs.
    if (form.report?.status === "submitted") return notProposed("report_already_submitted", { note: "The asker already sent this day's report; they can change it on the report page.", link: `/daily/report?date=${date}` });

    // Tomorrow: among the open work the service accepts (`listOpenWorkOf`, as the form lists it).
    let tomorrow: OwnTask[];
    // What the asker said of tomorrow that is no task of theirs ("subtitles", in other words than the
    // title): kept as their words in the notes rather than refusing the whole report over it.
    const unmatched: string[] = [];
    if (input.tomorrow) {
      tomorrow = [];
      for (const ref of input.tomorrow) {
        const picked = ownTaskNamed(form.candidates, ref);
        if ("many" in picked) return notProposed("several_tasks", { named: modelText(ref), tasks: picked.many.map((task) => ({ taskId: task.taskId, key: task.key, title: modelText(task.title) })), next: "Ask the asker which task." });
        if ("none" in picked) unmatched.push(ref.trim());
        else if (!tomorrow.some((task) => task.taskId === picked.one.taskId)) tomorrow.push(picked.one);
      }
    } else {
      const ids = new Set(form.tomorrow);
      tomorrow = form.candidates.filter((task) => ids.has(task.taskId));
    }

    const blockers = input.blockers?.trim() || null;
    let notes = input.notes?.trim() || null;
    const drafted = !notes;
    if (drafted) notes = (await draftEodNotes(user, date, locale, today))?.draft.trim().slice(0, NOTES_MAX) || null;
    if (unmatched.length) notes = [notes, `${locale === "en" ? "Tomorrow" : "Ngày mai"}: ${unmatched.join(", ")}`].filter(Boolean).join("\n").slice(0, NOTES_MAX);

    // Whom the report tells (daily/reports.ts `blockerReaders`): the first readers, when it carries blockers.
    let notify: string[] = [];
    if (blockers || (await countOpenBlockersRaisedBy([personId])).get(personId)) {
      const told = (await firstReadersOf([personId])).get(personId)?.told ?? [];
      if (told.length > 0) {
        const names = new Map((await listPersonNames()).map((person) => [person.id, person.fullName]));
        notify = notifyNames(told.map((id) => names.get(id) ?? ""));
      }
    }

    const fields: ProposalField[] = [
      { key: "date", text: date },
      notes ? { key: "notes", text: notes } : { key: "notes", valueKey: "none" },
      ...(notes && drafted ? [{ key: "source", valueKey: "drafted_from_activity" }] : []),
      ...(blockers ? [{ key: "blockers", text: blockers }] : []),
      tomorrow.length > 0 ? { key: "tomorrow", text: tomorrow.map(ownLine).join("; ") } : { key: "tomorrow", valueKey: "none" },
    ];
    return propose(context, "propose_eod_report", {
      action: "daily.report.submit",
      schema: submitReportInput,
      input: { date, blockers, notes, tomorrow: tomorrow.map((task) => task.taskId), secondsToSubmit: null },
      fields,
      notify,
      editHref: `/daily/report?date=${date}&proposal={id}`,
      subject: null,
      summary: { date, notes, notesDrafted: drafted && !!notes, blockers, tomorrow: tomorrow.map((task) => task.key).join(", ") || null },
    });
  },
});

export const PROPOSE_DAILY_TOOLS: readonly AnyAgentTool[] = [proposeTimeLog, proposePlanToday, proposeEodReport];
