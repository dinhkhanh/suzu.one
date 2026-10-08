// Work (FR-AGT-13): a task's detail, a project's status, the portfolio's health, a lead's board, a
// team's workload, who is in today, and timesheets waiting for the asker's approval. Each tool calls
// the door its page calls, with the asker: `getTaskDetail` (`canViewTask`, audits a private read),
// `openProject` (`canViewPlan`, audits), `listPortfolio` (`canViewProject`), `getLeaderView` (what
// the asker leads), `getWorkload` (teams they lead or administer, null otherwise), `getWhoIsIn`
// (their own scope, punch times only where the module allows), `listApprovals` (weeks they approve).
// The project's fee is never read here: `openProject` strips it for most readers, and this tool
// takes nothing from the plan but its health.
import "server-only";
import { z } from "zod";
import { recordHref } from "@/lib/record-routes";
import { getWhoIsIn } from "@/modules/attendance/service";
import { listApprovals, loadTimeReader } from "@/modules/daily/service";
import { listRaid, listStatusUpdates, openProject, type PortfolioRow, type ProjectReader } from "@/modules/projects/service";
import { can } from "@/modules/platform/rbac/policy";
import { getLeaderView, getTaskDetail, getWorkload, resolveTaskKey } from "@/modules/work/service";
import { nameGuess, rankNamed } from "../../engine/name-match";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows, modelText } from "../../engine/views";
import { type AnyAgentTool, defineTool } from "../registry";
import { projectLine, projectsMatching, visiblePortfolio, workViewerOf } from "./lookup";

const CAP = TURN_CEILINGS.rowsPerTool;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const HOURS = (minutes: number) => Math.round(minutes / 6) / 10;
const meta = (key: string, params: Record<string, string | number> = {}) => ({ key, params });

// ── A task ──────────────────────────────────────────────────────────────────────────────────

const taskDetail = defineTool({
  name: "task_detail",
  module: "work",
  description: "One task the asker may see, by key (VID-12) or id: title, state, assignee, requester, due date, priority, project, client, parent, sub-tasks and collaborators.",
  input: z.strictObject({ task: z.string().min(1).max(60).describe("The task's key, e.g. VID-12, or its id.") }),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user }, input) => {
    const id = UUID.test(input.task) ? input.task : await resolveTaskKey(input.task.trim().toUpperCase());
    // The module decides: an unknown key and a task the asker may not see read the same.
    const detail = id ? await getTaskDetail(id, await workViewerOf(user)) : undefined;
    if (!detail) return { outcome: "refused", model: { link: "/work" }, card: null, subject: null };
    const link = recordHref("task", detail.task.id);
    return {
      outcome: "answered",
      model: {
        link,
        key: detail.key,
        title: modelText(detail.task.title),
        state: detail.stateName,
        status: detail.task.status,
        assignee: detail.assigneeName,
        requester: detail.requesterName,
        dueDate: detail.task.dueDate,
        priority: detail.task.priority,
        project: detail.project ? { name: detail.project.name, link: recordHref("project", detail.project.id) } : null,
        client: detail.clientName,
        parent: detail.parent ? { key: detail.parent.key, title: modelText(detail.parent.title) } : null,
        subtasks: modelRows(detail.subtasks, { key: "value", title: "text", status: "value", assigneeName: "text", dueDate: "value" }, CAP),
        collaborators: detail.collaborators.map((person) => person.name),
      },
      card: { tool: "task_detail", href: link, items: [{ label: `${detail.key} · ${detail.task.title}`, href: link, meta: detail.task.dueDate ? meta("due", { date: detail.task.dueDate }) : null }], more: 0 },
      subject: { type: "task", id: detail.task.id },
    };
  },
});

// ── A project ───────────────────────────────────────────────────────────────────────────────

/** One project by name, number or id among those the asker may open; several = the candidates. */
async function pickProject(user: Parameters<typeof visiblePortfolio>[0], today: string, query: string): Promise<{ one: PortfolioRow | null; candidates: PortfolioRow[]; guessed: boolean }> {
  const rows = await visiblePortfolio(user, today, true);
  if (UUID.test(query)) {
    const row = rows.find((candidate) => candidate.id === query) ?? null;
    return { one: row, candidates: row ? [row] : [], guessed: false };
  }
  const found = projectsMatching(rows, query);
  return { one: found.rows.length === 1 ? found.rows[0] : null, candidates: found.rows.slice(0, 10), guessed: found.guessed };
}

const projectStatus = defineTool({
  name: "project_status",
  module: "projects",
  description:
    "One project's status as the asker may see it: health, phase, next milestone, due date and slip, deliverables accepted, budget burn, the latest status update, and the open high risks and issues. Give a name, job number or projectId.",
  input: z.strictObject({ project: z.string().min(2).max(80).describe("Project name, job number or projectId.") }),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const { one, candidates, guessed } = await pickProject(user, today, input.project);
    if (!one) {
      if (candidates.length === 0) return { outcome: "empty", model: { projects: [], link: "/projects" }, card: null, subject: null };
      return { outcome: "answered", model: { note: "Several projects match: ask which one.", projects: candidates.map(projectLine), ...nameGuess({ guessed }) }, card: null, subject: null };
    }
    // Opened as its page opens it: the module checks again and leaves the private-read trail.
    const opened = await openProject(user as unknown as ProjectReader, one.id);
    if (!opened) return { outcome: "refused", model: { link: "/projects" }, card: null, subject: null };
    const [[latest], raid] = await Promise.all([listStatusUpdates(one.id, 1), listRaid(one.id)]);
    const open = raid.filter((item) => item.status === "open" && (item.kind === "issue" || (item.kind === "risk" && item.severity === "high")));
    const link = recordHref("project", one.id);
    return {
      outcome: "answered",
      model: {
        ...projectLine(one),
        stale: one.stale,
        phase: one.phaseName,
        nextMilestone: one.nextMilestone,
        startDate: one.startDate,
        dueSlipDays: one.dueSlipDays,
        deliverables: one.register,
        burnPercent: one.burn.percent,
        latestUpdate: latest ? { health: latest.health, summary: modelText(latest.summary), nextSteps: modelText(latest.nextSteps), postedAt: latest.createdAt.toISOString(), by: latest.authorName } : null,
        openRisksAndIssues: modelRows(open, { kind: "value", title: "text", severity: "value", dueDate: "value", ownerName: "text" }, CAP),
        risksLink: `${link}/risks`,
        ...nameGuess({ guessed }),
      },
      card: { tool: "project_status", href: link, items: [{ label: [one.jobNumber, one.name].filter(Boolean).join(" · "), href: link, meta: one.health ? meta(`health_${one.health}`) : null }], more: 0 },
      subject: { type: "project", id: one.id },
    };
  },
});

const HEALTH_ORDER: Record<string, number> = { off_track: 0, at_risk: 1, on_track: 2 };

const portfolioHealth = defineTool({
  name: "portfolio_health",
  module: "projects",
  description: "The projects the asker may open with their health (on_track, at_risk, off_track), stale status, due slip, burn and open high risks; filter by health or by a team, client or lead name. Worst first.",
  input: z.strictObject({
    health: z.enum(["on_track", "at_risk", "off_track", "stale", "none"]).optional(),
    who: z.string().max(80).optional().describe("Part of a team, client or lead name."),
  }),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const inHealth = (await visiblePortfolio(user, today)).filter((row) => !input.health || (input.health === "stale" ? row.stale : input.health === "none" ? row.health === null : row.health === input.health));
    const who = input.who?.trim() ? rankNamed(inHealth, input.who, (row) => [row.teamName, row.clientName, row.leadName]) : null;
    const rows = (who ? who.map((match) => match.row) : inHealth).sort((a, b) => (HEALTH_ORDER[a.health ?? ""] ?? 3) - (HEALTH_ORDER[b.health ?? ""] ?? 3) || (b.dueSlipDays ?? 0) - (a.dueSlipDays ?? 0));
    if (rows.length === 0) return { outcome: "empty", model: { projects: [], link: "/projects" }, card: null, subject: null };
    const shaped = rows.map((row) => ({ ...projectLine(row), stale: row.stale, dueSlipDays: row.dueSlipDays, burnPercent: row.burn.percent, highRisks: row.raid.highRisks, openIssues: row.raid.openIssues }));
    const counts = { total: rows.length, offTrack: rows.filter((row) => row.health === "off_track").length, atRisk: rows.filter((row) => row.health === "at_risk").length, stale: rows.filter((row) => row.stale).length };
    return {
      outcome: "answered",
      model: { link: "/projects", counts, ...modelRows(shaped, { name: "text", jobNumber: "value", team: "text", client: "text", lead: "text", health: "value", stale: "value", dueDate: "value", dueSlipDays: "value", burnPercent: "value", highRisks: "value", openIssues: "value", link: "value" }, CAP) },
      card: { tool: "portfolio_health", href: "/projects", items: rows.slice(0, 8).map((row) => ({ label: row.name, href: recordHref("project", row.id), meta: row.health ? meta(`health_${row.health}`) : null })), more: Math.max(0, rows.length - 8) },
      subject: null,
    };
  },
});

// ── A lead's view ───────────────────────────────────────────────────────────────────────────

const teamBoard = defineTool({
  name: "team_board",
  module: "work",
  description: "For a lead: the open tasks of the teams and projects the asker leads, per person — open, overdue, at risk and blocked — and the riskiest tasks. Filter by a person's name.",
  input: z.strictObject({ person: z.string().max(80).optional().describe("Only this person's tasks.") }),
  offeredTo: (_principal, facts) => facts.leadsWork,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const view = await getLeaderView(await workViewerOf(user), today);
    const wanted = input.person?.trim().toLowerCase();
    const people = view.people.filter((person) => !wanted || (person.name ?? "").toLowerCase().includes(wanted));
    if (people.length === 0) return { outcome: "empty", model: { people: [], link: "/work/leader" }, card: null, subject: null };
    const risky = people
      .flatMap((person) => person.tasks)
      .filter((task) => task.risk !== null || task.blockedBy > 0)
      .map((task) => ({ key: task.key, title: task.title, assignee: task.assigneeName, state: task.stateName, dueDate: task.dueDate, risk: task.risk, blocked: task.blockedBy > 0, project: task.projectName, link: recordHref("task", task.id) }));
    return {
      outcome: "answered",
      model: {
        link: "/work/leader",
        people: people.slice(0, CAP).map((person) => ({ name: person.name ?? "—", open: person.counts.todo + person.counts.in_progress + person.counts.in_review, overdue: person.overdue, atRisk: person.atRisk, blocked: person.blocked })),
        riskiest: modelRows(risky, { key: "value", title: "text", assignee: "text", state: "text", dueDate: "value", risk: "value", blocked: "value", project: "text", link: "value" }, CAP),
      },
      card: { tool: "team_board", href: "/work/leader", items: people.slice(0, 8).map((person) => ({ label: person.name ?? "—", href: null, meta: meta("board", { overdue: person.overdue, blocked: person.blocked }) })), more: Math.max(0, people.length - 8) },
      subject: null,
    };
  },
});

const teamWorkload = defineTool({
  name: "team_workload",
  module: "work",
  description: "For a lead: planned hours against capacity per person and week for the next six weeks, in the teams the asker leads — who is over, who has free hours. Filter by team name.",
  input: z.strictObject({ team: z.string().max(80).optional() }),
  offeredTo: (principal, facts) => facts.leadsWork || can(principal, "work:manage"),
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const viewer = await workViewerOf(user);
    const all = await getWorkload(viewer, today);
    if (!all) return { outcome: "refused", model: { link: "/work/workload" }, card: null, subject: null };
    const wanted = input.team?.trim().toLowerCase();
    const team = wanted ? all.teams.find((candidate) => candidate.name.toLowerCase().includes(wanted) || candidate.key.toLowerCase() === wanted) : undefined;
    const view = team ? await getWorkload(viewer, today, { teamId: team.id }) : all;
    if (!view || view.rows.length === 0) return { outcome: "empty", model: { link: "/work/workload" }, card: null, subject: null };
    const rows = view.rows.map((row) => ({
      name: row.person.fullName,
      weeks: row.cells.map((cell) => ({ week: cell.week.start, plannedHours: HOURS(cell.minutes), capacityHours: HOURS(cell.capacityMinutes), freeHours: HOURS(Math.max(0, cell.capacityMinutes - cell.minutes)), over: cell.over, awayDays: cell.awayDays })),
      unscheduledTasks: row.unscheduled.tasks,
    }));
    return {
      outcome: "answered",
      model: { link: "/work/workload", teams: view.teams.map((candidate) => candidate.name), rows: rows.slice(0, CAP), more: Math.max(0, rows.length - CAP) },
      card: { tool: "team_workload", href: "/work/workload", items: rows.slice(0, 8).map((row) => ({ label: row.name, href: null, meta: meta("hours", { hours: row.weeks[0]?.freeHours ?? 0 }) })), more: Math.max(0, rows.length - 8) },
      subject: team ? { type: "team", id: team.id } : null,
    };
  },
});

const whoIsIn = defineTool({
  name: "who_is_in",
  module: "attendance",
  description: "Who is in, out, on leave or off-site today among the people the asker may see (their team or department, their reports, and for HR their scope), with counts.",
  input: z.strictObject({}),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user }) => {
    const presence = await getWhoIsIn({ personId: user.person.id, principal: user.principal });
    // Status only: punch times stay on the screen that may show them.
    const rows = presence.rows.filter((row) => !row.isSelf).map((row) => ({ name: row.fullName, department: row.departmentName, status: row.status, partLeave: row.partLeave }));
    return {
      outcome: "answered",
      model: { link: "/attendance/today", date: presence.date, counts: presence.counts, ...modelRows(rows, { name: "text", department: "text", status: "value", partLeave: "value" }, CAP) },
      card: { tool: "who_is_in", href: "/attendance/today", items: [], more: 0 },
      subject: null,
    };
  },
});

const timesheetsToApprove = defineTool({
  name: "timesheets_to_approve",
  module: "daily",
  description: "Weekly timesheets submitted and waiting for the asker's approval: whose, which week, how many hours.",
  input: z.strictObject({}),
  offeredTo: (_principal, facts) => facts.leadsWork || facts.managesPeople,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }) => {
    const { waiting } = await listApprovals(await loadTimeReader(user.person.id, user.principal), today);
    if (waiting.length === 0) return { outcome: "empty", model: { weeks: [], link: "/daily/timesheets" }, card: null, subject: null };
    const shaped = waiting.map((week) => ({ name: week.name, weekStart: week.weekStart, hours: HOURS(week.minutes), submittedAt: week.submittedAt }));
    return {
      outcome: "answered",
      model: { link: "/daily/timesheets", ...modelRows(shaped, { name: "text", weekStart: "value", hours: "value", submittedAt: "value" }, CAP) },
      card: { tool: "timesheets_to_approve", href: "/daily/timesheets", items: shaped.slice(0, 8).map((week) => ({ label: week.name, href: "/daily/timesheets", meta: meta("week", { date: week.weekStart, hours: week.hours }) })), more: Math.max(0, shaped.length - 8) },
      subject: null,
    };
  },
});

export const WORK_TOOLS: readonly AnyAgentTool[] = [taskDetail, projectStatus, portfolioHealth, teamBoard, teamWorkload, whoIsIn, timesheetsToApprove];
