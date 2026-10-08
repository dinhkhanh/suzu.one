// My own (FR-AGT-11): what the asker can already see about themselves, asked in a sentence. Every
// tool here reads ONE module's service with the asker's own id or principal — there is no input
// that names another person, so there is nobody else to read. Phase 9's four personal tools are
// here again (leave, attendance, who approves, payslip) on the same service doors, so a question
// the pattern router misses still reaches them.
import "server-only";
import { z } from "zod";
import { addDays, type IsoDate } from "@/lib/dates";
import { recordHref } from "@/lib/record-routes";
import { getMonthSummaryFor, whoApprovesAttendance } from "@/modules/attendance/service";
import { commsViewerOf, listAnnouncementsFor } from "@/modules/comms/service";
import { getToday, listMissingReportDays, loggedMinutesOfPerson } from "@/modules/daily/service";
import { getLeaveBalanceFor, whoApprovesLeave } from "@/modules/leave/service";
import { listInstances } from "@/modules/ops/service";
import { getPayslipView, listMyPayslips } from "@/modules/payroll/service";
import { listInbox, listMyRequests } from "@/modules/platform/approvals/service";
import { listMyWorkItems, type MyWorkItem } from "@/modules/work/service";
import { rankNamed } from "../../engine/name-match";
import { APPROVER_KINDS, type ApproverKind } from "../../engine/routing";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows, modelText } from "../../engine/views";
import type { AgentCardItem } from "../../enums";
import { type AnyAgentTool, defineTool, type ToolResult } from "../registry";

const CAP = TURN_CEILINGS.rowsPerTool;
const everyone = () => true;
const DAYS = (centi: number) => Math.round(centi) / 100;
const HOURS = (minutes: number) => Math.round(minutes / 6) / 10;
const meta = (key: string, params: Record<string, string | number> = {}) => ({ key, params });
const self = (personId: string) => ({ type: "person", id: personId });

const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/u);
const DATE = z.iso.date();

/** The empty answer: nothing to read is a fact the model may state, with the screen to check. */
const nothing = (link: string, subjectId: string, extra: Record<string, unknown> = {}): ToolResult => ({ outcome: "empty", model: { link, rows: [], ...extra }, card: null, subject: self(subjectId) });

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────

const myTasks = defineTool({
  name: "my_tasks",
  module: "work",
  description:
    "The asker's own open work tasks (assigned to them): key, title, state, due date, priority (1 urgent … 4 low), project, and whether something blocks it. Use filter to narrow: overdue, due within N days, or blocked; project to match part of a project's name.",
  input: z.strictObject({
    filter: z.enum(["all_open", "overdue", "due_soon", "blocked"]).optional().describe("all_open (default), overdue, due_soon (with dueWithinDays), blocked"),
    dueWithinDays: z.number().int().min(1).max(60).optional().describe("For due_soon: due from today to today + N days. Default 7."),
    project: z.string().max(120).optional().describe("Part of a project name or job number."),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const until = addDays(today, input.dueWithinDays ?? 7);
    const open = (await listMyWorkItems(user.person.id)).filter((task) => task.status === "todo" || task.status === "in_progress");
    // The project as the asker typed it, among the projects of their own work: misspelt or shortened too.
    const projects = input.project?.trim() ? new Set(rankNamed([...new Set(open.map((task) => task.projectName).filter((name): name is string => !!name))], input.project, (name) => [name]).map((match) => match.row)) : null;
    const keep = (task: MyWorkItem) => {
      if (projects && !(task.projectName && projects.has(task.projectName))) return false;
      if (input.filter === "overdue") return task.dueDate !== null && task.dueDate < today;
      if (input.filter === "due_soon") return task.dueDate !== null && task.dueDate >= today && task.dueDate <= until;
      if (input.filter === "blocked") return task.blockedBy > 0 || task.blocker !== null;
      return true;
    };
    const tasks = open.filter(keep);
    tasks.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || (a.priority ?? 9) - (b.priority ?? 9));
    if (tasks.length === 0) return nothing("/work", user.person.id, { filter: input.filter ?? "all_open" });
    const shaped = tasks.map((task) => ({ ...task, link: recordHref("task", task.id), blocked: task.blockedBy > 0 || task.blocker !== null }));
    const view = modelRows(shaped, { key: "value", title: "text", stateName: "text", dueDate: "value", priority: "value", projectName: "text", blocked: "value", blocker: "text", link: "value" }, CAP);
    const items: AgentCardItem[] = shaped.slice(0, 8).map((task) => ({ label: `${task.key} · ${task.title}`, href: task.link, meta: task.dueDate ? meta(task.dueDate < today ? "overdue" : "due", { date: task.dueDate }) : null }));
    return { outcome: "answered", model: { link: "/work", today, filter: input.filter ?? "all_open", ...view }, card: { tool: "my_tasks", href: "/work", items, more: Math.max(0, shaped.length - items.length) }, subject: self(user.person.id) };
  },
});

// ── The day: plan, report, time ─────────────────────────────────────────────────────────────

const myDay = defineTool({
  name: "my_day",
  module: "daily",
  description:
    "The asker's day: the tasks planned for it, tasks due that day, whether the end-of-day report is written and submitted, minutes logged that day, and the recent working days with no report. Default today; a date within the last 7 days works too.",
  input: z.strictObject({ date: DATE.optional().describe("YYYY-MM-DD; default today.") }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const date: IsoDate = input.date && input.date <= today && input.date >= addDays(today, -7) ? input.date : today;
    const [day, missing, logged] = await Promise.all([getToday(user.person.id, date), listMissingReportDays(user.person.id, today), loggedMinutesOfPerson(user.person.id, { from: date, to: date }, "week")]);
    const task = (row: { taskId: string; key: string; title: string; stateName: string; dueDate: IsoDate | null }) => ({ key: row.key, title: modelText(row.title), state: row.stateName, dueDate: row.dueDate, link: recordHref("task", row.taskId) });
    const minutesLogged = logged[0]?.totalMinutes ?? 0;
    const report = day.report ? { status: day.report.status, submittedAt: day.report.submittedAt?.toISOString() ?? null, late: day.report.late } : null;
    const model = {
      date,
      link: date === today ? "/today" : `/daily/report?date=${date}`,
      planned: day.planned.slice(0, CAP).map(task),
      due: day.due.slice(0, CAP).map(task),
      report,
      reportLink: `/daily/report?date=${date}`,
      hoursLogged: HOURS(minutesLogged),
      daysWithoutReport: missing.slice(0, 10),
    };
    const items: AgentCardItem[] = [
      { label: date, href: `/daily/report?date=${date}`, meta: meta(report ? (report.status === "submitted" ? "reportSubmitted" : "reportDraft") : "reportMissing") },
      ...missing.slice(0, 5).map((missed) => ({ label: missed, href: `/daily/report?date=${missed}`, meta: meta("reportMissing") })),
    ];
    return { outcome: "answered", model, card: { tool: "my_day", href: date === today ? "/today" : `/daily/report?date=${date}`, items, more: 0 }, subject: self(user.person.id) };
  },
});

const myTime = defineTool({
  name: "my_time",
  module: "daily",
  description: "Time the asker logged between two dates (at most 92 days apart), summed per project, per task or per week, most hours first, with the billable share.",
  input: z.strictObject({
    from: DATE.describe("YYYY-MM-DD, inclusive"),
    to: DATE.describe("YYYY-MM-DD, inclusive"),
    groupBy: z.enum(["project", "task", "week"]).optional().describe("Default project."),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user }, input) => {
    const [from, to] = input.from <= input.to ? [input.from, input.to] : [input.to, input.from];
    const clipped = addDays(to, -92) > from ? addDays(to, -92) : from;
    const by = input.groupBy ?? "project";
    const groups = await loggedMinutesOfPerson(user.person.id, { from: clipped, to }, by);
    if (groups.length === 0) return nothing("/daily/time", user.person.id, { from: clipped, to });
    const shaped = groups.map((group) => ({ label: group.label, key: group.key, hours: HOURS(group.minutes), billableHours: HOURS(group.billable), link: group.id ? recordHref(by === "task" ? "task" : "project", group.id) : null }));
    const total = groups[0].totalMinutes;
    const view = modelRows(shaped, { label: "text", key: "value", hours: "value", billableHours: "value", link: "value" }, CAP);
    const items: AgentCardItem[] = shaped.slice(0, 8).map((group) => ({ label: [group.key, group.label].filter(Boolean).join(" · ") || "—", href: by === "week" ? null : group.link, meta: meta("hours", { hours: group.hours }) }));
    return { outcome: "answered", model: { link: "/daily/time", from: clipped, to, groupBy: by, totalHours: HOURS(total), ...view }, card: { tool: "my_time", href: "/daily/time", items, more: Math.max(0, shaped.length - items.length) }, subject: self(user.person.id) };
  },
});

// ── Leave and attendance ────────────────────────────────────────────────────────────────────

const myLeave = defineTool({
  name: "my_leave",
  module: "leave",
  description: "The asker's leave balances for a year, per leave type: days available, used and pending approval.",
  input: z.strictObject({ year: z.number().int().min(2020).max(2100).optional().describe("Default this year.") }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const year = input.year ?? Number(today.slice(0, 4));
    // The owning module's door, with the asker's own principal: null is "not for you".
    const balances = await getLeaveBalanceFor(user.principal, user.person.id, year);
    if (!balances) return { outcome: "refused", model: { link: "/leave" }, card: null, subject: self(user.person.id) };
    const tracked = balances.filter((row) => row.balanceCenti !== 0 || row.usedCenti !== 0 || row.availableCenti !== 0);
    if (tracked.length === 0) return nothing("/leave", user.person.id, { year });
    const shaped = tracked.map((row) => ({ type: row.name, code: row.code, availableDays: DAYS(row.availableCenti), usedDays: DAYS(row.usedCenti), pendingDays: DAYS(row.pendingCenti) }));
    const items: AgentCardItem[] = shaped.map((row) => ({ label: row.type, href: null, meta: meta("leaveDays", { available: row.availableDays, used: row.usedDays }) }));
    return { outcome: "answered", model: { link: "/leave", year, ...modelRows(shaped, { type: "text", code: "value", availableDays: "value", usedDays: "value", pendingDays: "value" }, CAP) }, card: { tool: "my_leave", href: "/leave", items, more: 0 }, subject: self(user.person.id) };
  },
});

const myAttendance = defineTool({
  name: "my_attendance",
  module: "attendance",
  description: "The asker's attendance for a month: days counted, late arrivals and minutes, early leaves, absences, days with a missing punch, hours worked, overtime hours and paid days.",
  input: z.strictObject({ month: MONTH.optional().describe("YYYY-MM; default this month.") }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: 1,
  tags: [],
  run: async ({ user, today }, input) => {
    const month = input.month ?? today.slice(0, 7);
    const summary = await getMonthSummaryFor(user.principal, user.person.id, month);
    if (!summary) return { outcome: "refused", model: { link: "/attendance" }, card: null, subject: self(user.person.id) };
    if (summary.days === 0) return nothing("/attendance", user.person.id, { month });
    const model = { link: "/attendance", month, days: summary.days, lateCount: summary.lateCount, lateMinutes: summary.lateMinutes, earlyCount: summary.earlyCount, absentDays: summary.absentDays, missingPunchDays: summary.missingPunchDays, workedHours: HOURS(summary.workedMinutes), overtimeHours: HOURS(summary.otTotalMinutes), paidDays: DAYS(summary.paidDaysCenti) };
    return { outcome: "answered", model, card: { tool: "my_attendance", href: "/attendance", items: [{ label: month, href: "/attendance", meta: meta("attendance", { late: summary.lateCount, missing: summary.missingPunchDays }) }], more: 0 }, subject: self(user.person.id) };
  },
});

// ── Requests and approvals ──────────────────────────────────────────────────────────────────

const myRequests = defineTool({
  name: "my_requests",
  module: "approvals",
  description: "The asker's own requests of every kind (leave, overtime, remote work, corrections, generic requests) with their status, newest first; and the requests waiting for the asker's own decision as an approver.",
  input: z.strictObject({ which: z.enum(["mine", "waiting_on_me", "both"]).optional().describe("Default both.") }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user }, input) => {
    const which = input.which ?? "both";
    const [mine, waiting] = await Promise.all([which === "waiting_on_me" ? [] : listMyRequests(user.person.id, CAP + 1), which === "mine" ? [] : listInbox(user.person.id)]);
    if (mine.length === 0 && waiting.length === 0) return nothing("/requests", user.person.id);
    const spec = { type: "value", summary: "text", status: "value", createdAt: "value", requesterName: "text", link: "value" } as const;
    const shape = (row: (typeof mine)[number]) => ({ ...row, link: row.link ?? "/approvals" });
    const items: AgentCardItem[] = [...waiting.slice(0, 5).map((row) => ({ label: row.summary, href: row.link ?? "/approvals", meta: meta("waitingOnYou", { name: row.requesterName }) })), ...mine.slice(0, 5).map((row) => ({ label: row.summary, href: row.link ?? "/requests", meta: meta(`status_${row.status}`) }))];
    return {
      outcome: "answered",
      model: { mine: { link: "/requests", ...modelRows(mine.map(shape), spec, CAP) }, waitingOnMe: { link: "/approvals", ...modelRows(waiting.map(shape), spec, CAP) } },
      card: { tool: "my_requests", href: waiting.length ? "/approvals" : "/requests", items, more: Math.max(0, mine.length + waiting.length - items.length) },
      subject: self(user.person.id),
    };
  },
});

const APPROVERS: Record<ApproverKind, (personId: string) => Promise<{ key: string; names: string[] }[]>> = {
  leave: (personId) => whoApprovesLeave(personId),
  overtime: (personId) => whoApprovesAttendance("overtime", personId),
  remote_work: (personId) => whoApprovesAttendance("remote_work", personId),
  attendance_correction: (personId) => whoApprovesAttendance("attendance_correction", personId),
  holiday_work: (personId) => whoApprovesAttendance("holiday_work", personId),
};

const whoApproves = defineTool({
  name: "who_approves_my_request",
  module: "approvals",
  description: "Who approves a request of the asker's, step by step: leave, overtime, remote work, attendance correction or work on a holiday.",
  input: z.strictObject({ kind: z.enum(APPROVER_KINDS) }),
  offeredTo: everyone,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: 10,
  tags: [],
  run: async ({ user }, input) => {
    const steps = await APPROVERS[input.kind](user.person.id);
    const link = input.kind === "leave" ? "/leave/new" : "/attendance";
    if (steps.length === 0) return nothing(link, user.person.id, { kind: input.kind });
    return {
      outcome: "answered",
      model: { kind: input.kind, link, steps: steps.slice(0, 10).map((step, index) => ({ order: index + 1, names: step.names })) },
      card: { tool: "who_approves_my_request", href: link, items: steps.slice(0, 10).map((step, index) => ({ label: step.names.join(", "), href: null, meta: meta("step", { order: index + 1 }) })), more: 0 },
      subject: self(user.person.id),
    };
  },
});

// ── Pay (D36: read on step-up, never stored) ────────────────────────────────────────────────

const myPayslip = defineTool({
  name: "my_payslip",
  module: "payroll",
  description: "The asker's own released payslip for a month (default the latest): gross, insurance, union dues, personal income tax, other deductions, net, paid days, and the largest earning and deduction lines. Needs a recent identity confirmation (step-up).",
  input: z.strictObject({ month: MONTH.optional().describe("YYYY-MM; default the latest released payslip.") }),
  offeredTo: everyone,
  tier: "compensation",
  stepUp: true,
  kind: "read",
  rowCap: 12,
  tags: [],
  run: async ({ user }, input) => {
    // Own payslips only: there is no call in payroll that lists somebody else's.
    const mine = await listMyPayslips(user.person.id);
    const wanted = input.month ? mine.find((row) => row.month === input.month) : mine[0];
    if (!wanted) return nothing("/payslips", user.person.id, input.month ? { month: input.month } : {});
    // Authorised again inside payroll: self, C&B over the entity, or the owner.
    const view = await getPayslipView(user.principal, wanted.id);
    if (!view || view.person.id !== user.person.id) return { outcome: "refused", model: { link: "/payslips" }, card: null, subject: self(user.person.id) };
    const { totals } = view.result;
    const name = (code: string) => view.componentNames.get(code) ?? code;
    const top = (kind: "earning" | "deduction") =>
      view.result.lines
        .filter((line) => line.kind === kind && line.amount !== 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 6)
        .map((line) => ({ kind, name: name(line.code), amountVnd: line.amount }));
    const link = recordHref("payslip", wanted.id);
    return {
      outcome: "answered",
      model: { link, month: view.run.month, entity: view.entity.shortName, grossVnd: totals.grossEarnings, insuranceVnd: totals.employeeInsurance, unionDuesVnd: totals.unionDues, incomeTaxVnd: totals.pit, otherDeductionsVnd: totals.otherDeductions, totalDeductionsVnd: totals.totalDeductions, netVnd: totals.net, paidDays: DAYS(view.result.proration.paidDaysCenti), standardDays: view.result.proration.standardDays, lines: [...top("earning"), ...top("deduction")] },
      // The card names the payslip and links it; the figures stay on the payslip's own page.
      card: { tool: "my_payslip", href: link, items: [{ label: view.run.month, href: link, meta: null }], more: 0 },
      subject: { type: "payslip", id: wanted.id },
    };
  },
});

// ── Announcements and obligations ───────────────────────────────────────────────────────────

const myAnnouncements = defineTool({
  name: "my_unacknowledged_announcements",
  module: "comms",
  description: "Announcements addressed to the asker that ask for an acknowledgement they have not given yet, newest first.",
  input: z.strictObject({}),
  offeredTo: everyone,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }) => {
    const rows = await listAnnouncementsFor(await commsViewerOf(user, today), { onlyPendingAck: true, limit: CAP + 1 });
    if (rows.length === 0) return nothing("/announcements", user.person.id);
    const shaped = rows.map((row) => ({ title: row.title, excerpt: row.excerpt, publishedAt: row.publishAt, link: recordHref("announcement", row.id) }));
    return {
      outcome: "answered",
      model: { link: "/announcements", ...modelRows(shaped, { title: "text", excerpt: "text", publishedAt: "value", link: "value" }, CAP) },
      card: { tool: "my_unacknowledged_announcements", href: "/announcements", items: shaped.slice(0, 8).map((row) => ({ label: row.title, href: row.link, meta: null })), more: Math.max(0, shaped.length - 8) },
      subject: self(user.person.id),
    };
  },
});

const myObligations = defineTool({
  name: "my_obligations",
  module: "ops",
  description: "The company obligations (filings, payments, renewals) assigned to the asker that are still open, with their due dates and entity.",
  input: z.strictObject({ dueWithinDays: z.number().int().min(1).max(366).optional().describe("Only those due within N days from today.") }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const rows = await listInstances({ principal: user.principal, personId: user.person.id }, { open: true, ownerId: user.person.id, limit: CAP + 1, ...(input.dueWithinDays ? { dueTo: addDays(today, input.dueWithinDays) } : {}) }, today);
    if (rows.length === 0) return nothing("/ops", user.person.id);
    const shaped = rows.map((row) => ({ title: row.title, template: row.templateName, entity: row.entityCode, period: row.periodKey, dueDate: row.dueDate, status: row.status, link: recordHref("obligation", row.taskId) }));
    return {
      outcome: "answered",
      model: { link: "/ops", today, ...modelRows(shaped, { title: "text", template: "text", entity: "value", period: "value", dueDate: "value", status: "value", link: "value" }, CAP) },
      card: { tool: "my_obligations", href: "/ops", items: shaped.slice(0, 8).map((row) => ({ label: row.title, href: row.link, meta: row.dueDate ? meta(row.dueDate < today ? "overdue" : "due", { date: row.dueDate }) : null })), more: Math.max(0, shaped.length - 8) },
      subject: self(user.person.id),
    };
  },
});

export const SELF_TOOLS: readonly AnyAgentTool[] = [myTasks, myDay, myTime, myLeave, myAttendance, myRequests, whoApproves, myPayslip, myAnnouncements, myObligations];
