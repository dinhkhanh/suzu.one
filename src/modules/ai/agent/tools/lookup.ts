// Look-ups (FR-AGT-12, D33): a person, a project or a task, found by name within what the asker's
// own screens show. A name becomes a person only through the directory as the asker sees it
// (`listPeople` with their principal); a project only among the projects they may open
// (`listPortfolio`, built on `canViewProject`); a task only through `searchTasks`, whose WHERE
// clause is the work module's own visibility. Every fact about what is found is read again by the
// tool that reads it — a look-up hands over an id, never a right.
//
// A name may be typed loosely — misspelt, shortened, in another order, as initials — and is weighed
// by `engine/name-match.ts` against the same rows; a guess is flagged to the model, which says so.
import "server-only";
import { z } from "zod";
import { recordHref } from "@/lib/record-routes";
import { toSearchKey } from "@/lib/text";
import { canBrowsePeople, listPeople, type PeopleListRow } from "@/modules/core-hr/service";
import { listPortfolio, type PortfolioRow } from "@/modules/projects/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { loadViewer, searchTasks, searchTasksLoosely, type TaskSearchHit, type WorkViewer } from "@/modules/work/service";
import { type Named, nameGuess, namedRows } from "../../engine/name-match";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows } from "../../engine/views";
import { type AgentUser, type AnyAgentTool, defineTool } from "../registry";

const CAP = TURN_CEILINGS.rowsPerTool;

/** The work module's viewer for the asker — cached per person by the work module. */
export const workViewerOf = (user: AgentUser) => loadViewer(user);

// ── People ──────────────────────────────────────────────────────────────────────────────────

/** As many of the asker's directory as a guess at a name is weighed against. */
const DIRECTORY_SCAN = 2000;

/**
 * People the asker's directory shows for a name, at most ten, active only. The /people search first;
 * when it holds nothing for what was typed (a typo, the words in another order, initials), the
 * asker's whole directory is weighed for the name — still only the people their /people shows.
 */
export async function peopleNamed(principal: Principal, name: string): Promise<Named<PeopleListRow>> {
  if (!canBrowsePeople(principal)) return { rows: [], guessed: false };
  const searched = peopleMatching((await listPeople(principal, { q: name.trim(), status: "active" }, { pageSize: 10 })).rows, name);
  if (searched.rows.length) return searched;
  const everyone = peopleMatching((await listPeople(principal, { status: "active" }, { pageSize: DIRECTORY_SCAN })).rows, name);
  return { rows: everyone.rows.slice(0, 10), guessed: everyone.guessed };
}

/**
 * The directory's search matches inside words with the accents taken off, so "Huy" finds Hồ Gia Huy
 * and also Dương Thùy Chi ("thuy") and Huỳnh Mỹ Duyên ("huynh"). When some names hold every word
 * asked for as a whole word, only those are kept; otherwise the closest names are. Pure.
 */
export function peopleMatching<Row extends { fullName: string; workEmail?: string | null; employeeCode?: string | null }>(rows: readonly Row[], name: string): Named<Row> {
  return namedRows(rows, name, (row) => [row.fullName, row.workEmail?.split("@")[0], row.employeeCode]);
}

/** A directory card as the model reads it: no email, no code, no photo — a name, a title, a unit and an id to ask about. */
export const personCard = (row: PeopleListRow) => ({ personId: row.id, name: row.fullName, title: row.positionName, department: row.departmentName, entity: row.entityName, link: recordHref("person", row.id) });

const findPerson = defineTool({
  name: "find_person",
  module: "core-hr",
  description: "Finds colleagues by name in the company directory as the asker sees it: name, job title, department, entity, and a personId. Use it when the question is who someone is or where they work. For how a named person is doing (work, attendance, leave, performance) call person_overview with the name, and for a named person's pay estimate salary_estimate — both look the name up themselves.",
  input: z.strictObject({ name: z.string().min(2).max(80).describe("The name or part of it, as written in the question.") }),
  offeredTo: (principal) => canBrowsePeople(principal),
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: 10,
  tags: [],
  run: async ({ user }, input) => {
    const named = await peopleNamed(user.principal, input.name);
    const rows = named.rows;
    if (rows.length === 0) return { outcome: "empty", model: { people: [], link: "/people" }, card: null, subject: null };
    return {
      outcome: "answered",
      model: {
        people: rows.map(personCard),
        ...nameGuess(named),
        ...(rows.length > 1 ? { note: "Several people match: ask the asker which one, or use the one the question clearly means." } : {}),
        next: "This is only the directory card. If the question is about the person's work, attendance, leave, performance or pay, call the tool for that with the personId (person_overview, salary_estimate) when it is offered; otherwise answer from the card.",
      },
      card: { tool: "find_person", href: null, items: rows.map((row) => ({ label: row.fullName, href: recordHref("person", row.id), meta: row.positionName ? { key: "text", params: { text: [row.positionName, row.departmentName].filter(Boolean).join(" · ") } } : null })), more: 0 },
      subject: rows.length === 1 ? { type: "person", id: rows[0].id } : null,
    };
  },
});

// ── Projects ────────────────────────────────────────────────────────────────────────────────

/** Projects the asker may open whose name, job number or client the query means — an exact job number first. Pure. */
export function projectsMatching(rows: readonly PortfolioRow[], query: string): Named<PortfolioRow> {
  return namedRows(rows, query, (row) => [row.name, row.jobNumber, row.clientName]);
}

/** The projects the asker may open, as the portfolio lists them (done ones included when asked). */
export const visiblePortfolio = async (user: AgentUser, today: string, includeDone = false) => listPortfolio(await workViewerOf(user), { today, includeDone });

export const projectLine = (row: PortfolioRow) => ({ projectId: row.id, name: row.name, jobNumber: row.jobNumber, team: row.teamName, client: row.clientName, lead: row.leadName, status: row.statusName ?? row.status, health: row.health, dueDate: row.dueDate, link: recordHref("project", row.id) });

const findProject = defineTool({
  name: "find_project",
  module: "projects",
  description: "Finds projects the asker may open by name, job number (e.g. SZM-26-042) or client name: team, client, lead, status, health, due date and a projectId.",
  input: z.strictObject({ query: z.string().min(2).max(80).describe("Project name, job number or client name.") }),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: 10,
  tags: [],
  run: async ({ user, today }, input) => {
    const named = projectsMatching(await visiblePortfolio(user, today, true), input.query);
    const found = named.rows.slice(0, 10);
    if (found.length === 0) return { outcome: "empty", model: { projects: [], link: "/projects" }, card: null, subject: null };
    return {
      outcome: "answered",
      model: { projects: found.map(projectLine), ...nameGuess(named) },
      card: { tool: "find_project", href: "/projects", items: found.map((row) => ({ label: [row.jobNumber, row.name].filter(Boolean).join(" · "), href: recordHref("project", row.id), meta: row.health ? { key: `health_${row.health}`, params: {} } : null })), more: 0 },
      subject: found.length === 1 ? { type: "project", id: found[0].id } : null,
    };
  },
});

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────

/**
 * Tasks the asker may see for a key or words of a title. The command palette's search first; when
 * it finds nothing, the titles holding the start of any word asked for (marks aside) are weighed
 * for a typo, a shortened word or the words in another order.
 */
export async function tasksNamed(viewer: WorkViewer, query: string, limit: number): Promise<Named<TaskSearchHit>> {
  const hits = await searchTasks(viewer, query, limit);
  if (hits.length) return { rows: hits, guessed: false };
  const stems = toSearchKey(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 3)
    .map((word) => word.slice(0, 3));
  const named = namedRows(await searchTasksLoosely(viewer, stems), query, (hit) => [hit.title, hit.key]);
  return { rows: named.rows.slice(0, limit), guessed: named.guessed };
}

const findTask = defineTool({
  name: "find_task",
  module: "work",
  description: "Finds tasks the asker may see by key (e.g. VID-12) or words of the title: key, title, status and project.",
  input: z.strictObject({ query: z.string().min(1).max(120) }),
  offeredTo: () => true,
  tier: "public_internal",
  stepUp: false,
  kind: "read",
  rowCap: 12,
  tags: [],
  run: async ({ user }, input) => {
    const named = await tasksNamed(await workViewerOf(user), input.query, 12);
    const hits = named.rows;
    if (hits.length === 0) return { outcome: "empty", model: { tasks: [], link: "/work" }, card: null, subject: null };
    const shaped = hits.map((hit) => ({ ...hit, link: recordHref("task", hit.id) }));
    return {
      outcome: "answered",
      model: { ...modelRows(shaped, { key: "value", title: "text", status: "value", projectName: "text", link: "value" }, CAP), ...nameGuess(named) },
      card: { tool: "find_task", href: null, items: shaped.map((hit) => ({ label: `${hit.key} · ${hit.title}`, href: hit.link, meta: null })), more: 0 },
      subject: hits.length === 1 ? { type: "task", id: hits[0].id } : null,
    };
  },
});

export const LOOKUP_TOOLS: readonly AnyAgentTool[] = [findPerson, findProject, findTask];
