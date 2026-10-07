// Look-ups (FR-AGT-12, D33): a person, a project or a task, found by name within what the asker's
// own screens show. A name becomes a person only through the directory as the asker sees it
// (`listPeople` with their principal); a project only among the projects they may open
// (`listPortfolio`, built on `canViewProject`); a task only through `searchTasks`, whose WHERE
// clause is the work module's own visibility. Every fact about what is found is read again by the
// tool that reads it — a look-up hands over an id, never a right.
import "server-only";
import { z } from "zod";
import { toSearchKey } from "@/lib/text";
import { recordHref } from "@/lib/record-routes";
import { canBrowsePeople, listPeople, type PeopleListRow } from "@/modules/core-hr/service";
import { listPortfolio, type PortfolioRow } from "@/modules/projects/service";
import type { Principal } from "@/modules/platform/rbac/policy";
import { loadViewer, searchTasks } from "@/modules/work/service";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows } from "../../engine/views";
import { type AgentUser, type AnyAgentTool, defineTool } from "../registry";

const CAP = TURN_CEILINGS.rowsPerTool;

/** The work module's viewer for the asker — cached per person by the work module. */
export const workViewerOf = (user: AgentUser) => loadViewer(user);

// ── People ──────────────────────────────────────────────────────────────────────────────────

/** People the asker's directory shows for a name, at most ten, active only — exactly the /people search. */
export async function peopleNamed(principal: Principal, name: string): Promise<PeopleListRow[]> {
  if (!canBrowsePeople(principal)) return [];
  const rows = (await listPeople(principal, { q: name.trim(), status: "active" }, { pageSize: 10 })).rows;
  return wholeWordMatches(rows, name);
}

/**
 * The directory's search matches inside words with the accents taken off, so "Huy" finds Hồ Gia Huy
 * and also Dương Thùy Chi ("thuy") and Huỳnh Mỹ Duyên ("huynh"). When some names hold every word
 * asked for as a whole word, only those are kept; otherwise the search stands as it is.
 */
export function wholeWordMatches<Row extends { fullName: string }>(rows: readonly Row[], name: string): Row[] {
  const asked = toSearchKey(name).split(/\s+/u).filter(Boolean);
  const whole = rows.filter((row) => {
    const words = new Set(toSearchKey(row.fullName).split(/\s+/u));
    return asked.every((word) => words.has(word));
  });
  return whole.length ? whole : [...rows];
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
    const rows = await peopleNamed(user.principal, input.name);
    if (rows.length === 0) return { outcome: "empty", model: { people: [], link: "/people" }, card: null, subject: null };
    return {
      outcome: "answered",
      model: {
        people: rows.map(personCard),
        ...(rows.length > 1 ? { note: "Several people match: ask the asker which one, or use the one the question clearly means." } : {}),
        next: "This is only the directory card. If the question is about the person's work, attendance, leave, performance or pay, call the tool for that with the personId (person_overview, salary_estimate) when it is offered; otherwise answer from the card.",
      },
      card: { tool: "find_person", href: null, items: rows.map((row) => ({ label: row.fullName, href: recordHref("person", row.id), meta: row.positionName ? { key: "text", params: { text: [row.positionName, row.departmentName].filter(Boolean).join(" · ") } } : null })), more: 0 },
      subject: rows.length === 1 ? { type: "person", id: rows[0].id } : null,
    };
  },
});

// ── Projects ────────────────────────────────────────────────────────────────────────────────

/** Projects the asker may open whose name or job number matches — exact job number first. */
export function projectsMatching(rows: readonly PortfolioRow[], query: string): PortfolioRow[] {
  const wanted = toSearchKey(query);
  const byNumber = rows.filter((row) => row.jobNumber && toSearchKey(row.jobNumber) === wanted);
  if (byNumber.length) return byNumber;
  return rows.filter((row) => toSearchKey(row.name).includes(wanted) || (row.jobNumber && toSearchKey(row.jobNumber).includes(wanted)) || (row.clientName && toSearchKey(row.clientName).includes(wanted)));
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
    const found = projectsMatching(await visiblePortfolio(user, today, true), input.query).slice(0, 10);
    if (found.length === 0) return { outcome: "empty", model: { projects: [], link: "/projects" }, card: null, subject: null };
    return {
      outcome: "answered",
      model: { projects: found.map(projectLine) },
      card: { tool: "find_project", href: "/projects", items: found.map((row) => ({ label: [row.jobNumber, row.name].filter(Boolean).join(" · "), href: recordHref("project", row.id), meta: row.health ? { key: `health_${row.health}`, params: {} } : null })), more: 0 },
      subject: found.length === 1 ? { type: "project", id: found[0].id } : null,
    };
  },
});

// ── Tasks ───────────────────────────────────────────────────────────────────────────────────

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
    const hits = await searchTasks(await workViewerOf(user), input.query, 12);
    if (hits.length === 0) return { outcome: "empty", model: { tasks: [], link: "/work" }, card: null, subject: null };
    const shaped = hits.map((hit) => ({ ...hit, link: recordHref("task", hit.id) }));
    return {
      outcome: "answered",
      model: { ...modelRows(shaped, { key: "value", title: "text", status: "value", projectName: "text", link: "value" }, CAP) },
      card: { tool: "find_task", href: null, items: shaped.map((hit) => ({ label: `${hit.key} · ${hit.title}`, href: hit.link, meta: null })), more: 0 },
      subject: hits.length === 1 ? { type: "task", id: hits[0].id } : null,
    };
  },
});

export const LOOKUP_TOOLS: readonly AnyAgentTool[] = [findPerson, findProject, findTask];
