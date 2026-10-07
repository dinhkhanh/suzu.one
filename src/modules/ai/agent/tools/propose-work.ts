// Proposals on work (Phase 13 R4, FR-AGT-21): create a task; change its state, assignee, due date or
// priority; comment on it; raise or clear a blocker. Every one ends in `propose()` — a card for the
// asker, nothing changed — and is checked first exactly as its action will check it when confirmed:
// the place by `canContributeTo…`, the task by `canEditTask` / `canJoinTaskConversation`, a person by
// the task's own assignable list. A name the asker gives becomes an id only among what the module
// itself lists for that field, so the card can never name somebody the action would refuse.
import "server-only";
import { z } from "zod";
import { recordHref } from "@/lib/record-routes";
import { toSearchKey } from "@/lib/text";
import { listPersonNames } from "@/modules/platform/people/service";
import {
  addCommentInput,
  canContributeToProject,
  canContributeToTeam,
  canEditTask,
  canJoinTaskConversation,
  canRaiseBlocker,
  canResolveBlocker,
  canViewTask,
  createTaskInput,
  findProject,
  listAssignable,
  listStates,
  listTaskBlockers,
  listTeamMembers,
  type LoadedTask,
  loadTask,
  projectFacts,
  raiseBlockerInput,
  resolveBlockerInput,
  searchTasks,
  type StateRow,
  taskKey,
  teamFacts,
  updateTaskInput,
  type WorkViewer,
  workDirectory,
} from "@/modules/work/service";
import { modelText } from "../../engine/views";
import { PALETTE_CREATE, type ProposalField } from "../../enums";
import { isUuid, notifyNames, notProposed, pickPerson, propose } from "../propose";
import { type AgentUser, type AnyAgentTool, defineTool, type ToolResult } from "../registry";
import { projectLine, projectsMatching, visiblePortfolio, workViewerOf } from "./lookup";

const everyone = () => true;
const DATE = z.iso.date();
const PRIORITY = z.number().int().min(1).max(4);
const TASK_REF = z.string().min(1).max(120).describe("The task's key (e.g. VID-12), words of its title, or a taskId a tool gave you.");
const PERSON_REF = z.string().min(1).max(80);

const labelOf = (loaded: LoadedTask) => `${taskKey(loaded.team.key, loaded.work.number)} · ${loaded.task.title}`;
const taskField = (loaded: LoadedTask): ProposalField => ({ key: "task", text: labelOf(loaded), href: recordHref("task", loaded.task.id) });
const personField = (key: string, person: { id: string; fullName: string } | null): ProposalField => (person ? { key, text: person.fullName, href: recordHref("person", person.id) } : { key, valueKey: "nobody" });

export type Found = { loaded: LoadedTask; viewer: WorkViewer };

/** A task the asker named, as the work module lets them see it — or why no card can be made. */
export async function taskNamed(user: AgentUser, ref: string): Promise<Found | ToolResult> {
  const viewer = await workViewerOf(user);
  let id: string | null = isUuid(ref) ? ref.trim() : null;
  if (!id) {
    const hits = await searchTasks(viewer, ref, 6);
    const exact = hits.find((hit) => hit.key.toLowerCase() === ref.trim().toLowerCase());
    if (exact) id = exact.id;
    else if (hits.length === 1) id = hits[0].id;
    else if (hits.length > 1) return notProposed("several_tasks", { tasks: hits.map((hit) => ({ taskId: hit.id, key: hit.key, title: modelText(hit.title) })), next: "Ask the asker which task, or call again with its key." });
    else return notProposed("task_not_found");
  }
  const loaded = await loadTask(id);
  if (!loaded || !canViewTask(viewer, loaded.facts)) return notProposed("task_not_found");
  return { loaded, viewer };
}

export const failed = (found: Found | ToolResult): found is ToolResult => "outcome" in found;

/** A person among the people the module accepts for the field, or why no card can be made. */
function personOf<Row extends { id: string; fullName: string }>(candidates: readonly Row[], name: string, askerId: string): Row | ToolResult {
  const picked = pickPerson(candidates, name, askerId);
  if ("one" in picked) return picked.one;
  if ("many" in picked) return notProposed("several_people", { people: picked.many.map((person) => ({ personId: person.id, name: person.fullName })), next: "Ask the asker which one." });
  return notProposed("person_not_assignable", { note: "Only people on this task's team or project can be named here." });
}

const isResult = (value: unknown): value is ToolResult => !!value && typeof value === "object" && "outcome" in value && "model" in value;

// ── Create a task ───────────────────────────────────────────────────────────────────────────

const proposeTask = defineTool({
  name: "propose_task",
  module: "work",
  description:
    "Proposes a NEW task for the asker to confirm (nothing is created until they do) — only for work that does not exist yet: to give, move or reschedule an existing task (\"giao việc X cho Y\" when X is already a task), use propose_task_change. Give the title; a project (name or job number) or a team (key or name) to put it in — without either it goes to the asker's team when they have one; the assignee by name as the asker said it (\"me\" for the asker); a due date; priority 1 urgent … 4 low; a short description.",
  input: z.strictObject({
    title: z.string().min(1).max(200),
    project: z.string().min(2).max(120).optional().describe("Project name or job number."),
    team: z.string().min(2).max(80).optional().describe("Team key (e.g. VID) or name, when there is no project."),
    assignee: PERSON_REF.optional().describe("Name as the asker wrote it, \"me\", or a personId."),
    dueDate: DATE.optional().describe("YYYY-MM-DD"),
    priority: PRIORITY.optional(),
    description: z.string().max(2000).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user, today } = context;
    const viewer = await workViewerOf(user);
    const directory = await workDirectory();
    let teamId: string;
    let projectId: string | null = null;
    let place: ProposalField;
    if (input.project) {
      const rows = projectsMatching(await visiblePortfolio(user, today), input.project);
      if (rows.length === 0) return notProposed("project_not_found");
      if (rows.length > 1) return notProposed("several_projects", { projects: rows.slice(0, 8).map(projectLine), next: "Ask the asker which project." });
      const found = await findProject(rows[0].id);
      if (!found || !canContributeToProject(viewer, projectFacts(found.project, found.team))) return notProposed("not_permitted", { note: "The asker cannot add tasks to this project." });
      teamId = found.team.id;
      projectId = found.project.id;
      place = { key: "project", text: [rows[0].jobNumber, rows[0].name].filter(Boolean).join(" · "), href: recordHref("project", projectId) };
    } else {
      const open = directory.teams.filter((team) => !team.archivedAt);
      const mine = open.filter((team) => viewer.teamRoles.has(team.id));
      let team = mine.length === 1 ? mine[0] : undefined;
      if (input.team) {
        const wanted = toSearchKey(input.team);
        const matching = open.filter((candidate) => toSearchKey(candidate.key) === wanted || toSearchKey(candidate.name).includes(wanted));
        if (matching.length !== 1) return notProposed(matching.length ? "several_teams" : "team_not_found", { teams: (matching.length ? matching : mine).slice(0, 8).map((candidate) => ({ key: candidate.key, name: candidate.name })) });
        team = matching[0];
      }
      if (!team) return notProposed("which_team", { teams: mine.slice(0, 8).map((candidate) => ({ key: candidate.key, name: candidate.name })), next: "Ask the asker which team or project the task is for." });
      if (!canContributeToTeam(viewer, teamFacts(team))) return notProposed("not_permitted", { note: "The asker cannot add tasks to this team." });
      teamId = team.id;
      place = { key: "team", text: team.name, href: recordHref("team", team.id) };
    }

    let assignee: { id: string; fullName: string } | null = null;
    if (input.assignee) {
      const picked = personOf(await listAssignable(teamId, projectId), input.assignee, user.person.id);
      if (isResult(picked)) return picked;
      assignee = picked;
    }

    const fields: ProposalField[] = [{ key: "title", text: input.title.trim() }, place, personField("assignee", assignee)];
    if (input.dueDate) fields.push({ key: "dueDate", text: input.dueDate });
    if (input.priority) fields.push({ key: "priority", valueKey: `priority_${input.priority}` });
    if (input.description?.trim()) fields.push({ key: "description", text: input.description.trim() });
    // Sửa: the module's own create form — the palette's — opened on the same title, day and place.
    const edit = new URLSearchParams({ title: input.title.trim(), place: projectId ? `project:${projectId}` : `team:${teamId}`, mine: assignee?.id === user.person.id ? "1" : "0", ...(input.dueDate ? { dueDate: input.dueDate } : {}) });
    return propose(context, "propose_task", {
      action: "work.task.create",
      schema: createTaskInput,
      input: { teamId, projectId, title: input.title.trim(), description: input.description?.trim() || null, assigneePersonId: assignee?.id ?? null, dueDate: input.dueDate ?? null, priority: input.priority ?? null },
      fields,
      notify: notifyNames(assignee && assignee.id !== user.person.id ? [assignee.fullName] : []),
      editHref: `${PALETTE_CREATE}${edit.toString()}`,
      subject: projectId ? { type: "project", id: projectId } : { type: "team", id: teamId },
      summary: { title: input.title, place: place.text ?? null, assignee: assignee?.fullName ?? null, dueDate: input.dueDate ?? null, priority: input.priority ?? null },
    });
  },
});

// ── Change a task ───────────────────────────────────────────────────────────────────────────

/** Words a person uses for a workflow category, accent-free. */
const CATEGORY_WORDS: Record<string, readonly string[]> = {
  backlog: ["backlog", "ton dong"],
  todo: ["todo", "to do", "can lam", "chua lam", "mo lai", "reopen"],
  in_progress: ["in progress", "doing", "dang lam", "bat dau", "start", "started"],
  in_review: ["review", "in review", "duyet", "cho duyet", "dang duyet", "kiem tra"],
  done: ["done", "xong", "hoan thanh", "complete", "completed", "finished", "da xong"],
  cancelled: ["cancel", "cancelled", "canceled", "huy", "da huy"],
};

/** A team's state the asker named: its own name first, then the category's words. Pure. */
export function stateNamed<State extends Pick<StateRow, "id" | "name" | "category" | "isActive">>(states: readonly State[], name: string): State | null {
  const wanted = toSearchKey(name).trim();
  const active = states.filter((state) => state.isActive);
  const exact = active.find((state) => toSearchKey(state.name) === wanted);
  if (exact) return exact;
  const category = Object.entries(CATEGORY_WORDS).find(([key, words]) => key === wanted.replace(/\s+/gu, "_") || words.includes(wanted))?.[0];
  if (category) return active.find((state) => state.category === category) ?? null;
  const partial = active.filter((state) => toSearchKey(state.name).includes(wanted));
  return partial.length === 1 ? partial[0] : null;
}

const proposeTaskChange = defineTool({
  name: "propose_task_change",
  module: "work",
  description:
    "Proposes a change to one task for the asker to confirm: its state (the team's state name, or done / in progress / review / to do / cancelled), its assignee (a name, \"me\", or \"none\" to unassign), its due date (YYYY-MM-DD, or \"none\" to clear), its priority (1 urgent … 4 low, or 0 for none). Name the task by key or title.",
  input: z.strictObject({
    task: TASK_REF,
    state: z.string().min(2).max(40).optional(),
    assignee: PERSON_REF.optional(),
    dueDate: z.union([DATE, z.literal("none")]).optional(),
    priority: z.number().int().min(0).max(4).optional(),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user } = context;
    if (input.state === undefined && input.assignee === undefined && input.dueDate === undefined && input.priority === undefined) return notProposed("nothing_to_change");
    const found = await taskNamed(user, input.task);
    if (failed(found)) return found;
    const { loaded, viewer } = found;
    if (!canEditTask(viewer, loaded.facts)) return notProposed("not_permitted", { note: "The asker cannot change this task." });

    const patch: Record<string, unknown> = { taskId: loaded.task.id };
    const fields: ProposalField[] = [taskField(loaded)];
    const notify: string[] = [];
    const summary: Record<string, string | number | null> = { task: labelOf(loaded) };

    if (input.state !== undefined) {
      const states = await listStates([loaded.team.id]);
      const state = stateNamed(states, input.state);
      if (!state) return notProposed("state_not_found", { states: states.filter((row) => row.isActive).map((row) => row.name) });
      patch.stateId = state.id;
      fields.push({ key: "state", text: state.name });
      summary.state = state.name;
      // A move reaches the task's followers (FR-WRK-17).
      const names = new Map((await listPersonNames()).map((person) => [person.id, person.fullName]));
      notify.push(...loaded.followerIds.filter((id) => id !== user.person.id).map((id) => names.get(id) ?? ""));
    }
    if (input.assignee !== undefined) {
      if (toSearchKey(input.assignee).trim() === "none") {
        patch.assigneePersonId = null;
        fields.push(personField("assignee", null));
        summary.assignee = "none";
      } else {
        const picked = personOf(await listAssignable(loaded.team.id, loaded.work.projectId), input.assignee, user.person.id);
        if (isResult(picked)) return picked;
        patch.assigneePersonId = picked.id;
        fields.push(personField("assignee", picked));
        summary.assignee = picked.fullName;
        if (picked.id !== user.person.id) notify.unshift(picked.fullName);
      }
    }
    if (input.dueDate !== undefined) {
      patch.dueDate = input.dueDate === "none" ? null : input.dueDate;
      fields.push(input.dueDate === "none" ? { key: "dueDate", valueKey: "none" } : { key: "dueDate", text: input.dueDate });
      summary.dueDate = input.dueDate;
    }
    if (input.priority !== undefined) {
      patch.priority = input.priority === 0 ? null : input.priority;
      fields.push({ key: "priority", valueKey: input.priority === 0 ? "none" : `priority_${input.priority}` });
      summary.priority = input.priority;
    }
    return propose(context, "propose_task_change", {
      action: "work.task.update",
      schema: updateTaskInput,
      input: patch,
      fields,
      notify: notifyNames(notify),
      // The task's own page is its form: every field is edited in place there.
      editHref: recordHref("task", loaded.task.id),
      subject: { type: "task", id: loaded.task.id },
      summary,
    });
  },
});

// ── Comment ─────────────────────────────────────────────────────────────────────────────────

const proposeComment = defineTool({
  name: "propose_comment",
  module: "work",
  description: "Proposes a comment on a task, in the asker's words, for them to confirm. Name the task by key or title; write the comment as the asker asked for it.",
  input: z.strictObject({ task: TASK_REF, body: z.string().min(1).max(2000) }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const found = await taskNamed(context.user, input.task);
    if (failed(found)) return found;
    const { loaded, viewer } = found;
    if (!canJoinTaskConversation(viewer, loaded.facts)) return notProposed("not_permitted", { note: "The asker cannot comment on this task." });
    const body = input.body.trim();
    return propose(context, "propose_comment", {
      action: "work.comment.add",
      schema: addCommentInput,
      input: { taskId: loaded.task.id, body, parentId: null },
      fields: [taskField(loaded), { key: "comment", text: body }],
      notify: [],
      editHref: `${recordHref("task", loaded.task.id)}?proposal={id}`,
      subject: { type: "task", id: loaded.task.id },
      summary: { task: labelOf(loaded), comment: body },
    });
  },
});

// ── Blockers ────────────────────────────────────────────────────────────────────────────────

const proposeBlocker = defineTool({
  name: "propose_blocker",
  module: "work",
  description:
    "Proposes marking a task blocked (action raise: the reason, and who it waits on by name if the asker said) or clearing its open blocker (action resolve: an optional note on how it was solved), for the asker to confirm.",
  input: z.strictObject({
    task: TASK_REF,
    action: z.enum(["raise", "resolve"]),
    reason: z.string().min(1).max(500).optional().describe("For raise: what blocks it."),
    waitingOn: PERSON_REF.optional().describe("For raise: the person it waits on, by name."),
    resolution: z.string().max(500).optional().describe("For resolve: how it was solved."),
  }),
  offeredTo: everyone,
  tier: "personal",
  stepUp: false,
  kind: "propose",
  rowCap: 10,
  tags: [],
  run: async (context, input) => {
    const { user } = context;
    const found = await taskNamed(user, input.task);
    if (failed(found)) return found;
    const { loaded, viewer } = found;
    const taskId = loaded.task.id;
    const open = (await listTaskBlockers(taskId)).find((blocker) => !blocker.resolvedAt) ?? null;

    if (input.action === "resolve") {
      if (!open) return notProposed("no_open_blocker");
      if (!canResolveBlocker(viewer, loaded.facts, open)) return notProposed("not_permitted", { note: "The asker cannot clear this blocker." });
      const resolution = input.resolution?.trim() || null;
      return propose(context, "propose_blocker", {
        action: "work.blocker.resolve",
        schema: resolveBlockerInput,
        input: { taskId, resolution },
        fields: [taskField(loaded), { key: "blocker", text: open.reason }, ...(resolution ? [{ key: "resolution", text: resolution }] : [])],
        notify: notifyNames(open.raisedByPersonId !== user.person.id && open.raisedByName ? [open.raisedByName] : []),
        editHref: recordHref("task", taskId),
        subject: { type: "task", id: taskId },
        summary: { task: labelOf(loaded), action: "resolve", blocker: open.reason, resolution },
      });
    }

    if (!input.reason?.trim()) return notProposed("reason_required", { next: "Ask the asker what blocks the task." });
    if (open) return notProposed("blocker_already_open", { blocker: modelText(open.reason) });
    if (!canRaiseBlocker(viewer, loaded.facts)) return notProposed("not_permitted", { note: "The asker cannot mark this task blocked." });
    let needed: { id: string; fullName: string } | null = null;
    if (input.waitingOn) {
      const picked = personOf(await listAssignable(loaded.team.id, loaded.work.projectId), input.waitingOn, user.person.id);
      if (isResult(picked)) return picked;
      needed = picked;
    }
    // The person it waits on and the team's leads are told (work/blockers.ts).
    const leads = (await listTeamMembers(loaded.team.id)).filter((member) => member.role === "lead" && member.personId !== user.person.id).map((member) => member.fullName);
    const reason = input.reason.trim();
    return propose(context, "propose_blocker", {
      action: "work.blocker.raise",
      schema: raiseBlockerInput,
      input: { taskId, reason, neededPersonId: needed?.id ?? null },
      fields: [taskField(loaded), { key: "reason", text: reason }, ...(needed ? [personField("waitingOn", needed)] : [])],
      notify: notifyNames([...(needed && needed.id !== user.person.id ? [needed.fullName] : []), ...leads]),
      editHref: `${recordHref("task", taskId)}?proposal={id}`,
      subject: { type: "task", id: taskId },
      summary: { task: labelOf(loaded), action: "raise", reason, waitingOn: needed?.fullName ?? null },
    });
  },
});

export const PROPOSE_WORK_TOOLS: readonly AnyAgentTool[] = [proposeTask, proposeTaskChange, proposeComment, proposeBlocker];
