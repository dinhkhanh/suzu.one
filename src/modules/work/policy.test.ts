import { describe, expect, it } from "vitest";
import type { Grant } from "../platform/rbac/policy";
import type { TeamRole } from "./enums";
import { canAdminTeam, canContributeToProject, canCreateProject, canDeleteTask, canEditTask, canManageProject, canManageWorkspace, canViewProject, canViewTask, canViewTeam, type ProjectFacts, type TaskFacts, type TeamFacts, type WorkViewer } from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const VID = "dept-vid";

const viewer = (personId: string, options: { entityId?: string | null; grants?: Grant[]; teams?: Record<string, TeamRole>; projects?: Record<string, TeamRole>; collaborator?: boolean } = {}): WorkViewer => ({
  principal: { personId, workforceType: options.collaborator ? "collaborator" : "employee", grants: options.grants ?? [] },
  entityId: options.entityId === undefined ? SZM : options.entityId,
  teamRoles: new Map(Object.entries(options.teams ?? {})),
  projectRoles: new Map(Object.entries(options.projects ?? {})),
});

const video: TeamFacts = { id: "team-video", entityId: SZM, departmentId: VID, defaultVisibility: "team" };
const project = (visibility: ProjectFacts["visibility"], entityId: string | null = SZM): ProjectFacts => ({ id: `project-${visibility}`, entityId, visibility, team: video });
const taskIn = (facts: Partial<TaskFacts> = {}): TaskFacts => ({ team: video, project: project("team"), assigneePersonId: null, requesterPersonId: null, createdByPersonId: null, peopleIds: [], ...facts });

const lead = viewer("long", { teams: { "team-video": "lead" } });
const member = viewer("huy", { teams: { "team-video": "member" } });
const colleague = viewer("bao");
const otherEntity = viewer("khoi", { entityId: SZC });
const owner = viewer("owner", { grants: [{ role: "owner", scope: { type: "group" } }] });
const head = viewer("head", { grants: [{ role: "department_head", scope: { type: "department", id: VID } }] });
const otherHead = viewer("chi", { entityId: SZC, grants: [{ role: "department_head", scope: { type: "department", id: "dept-des" } }] });
const freelancer = viewer("bao-anh", { collaborator: true });

describe("teams", () => {
  it("are run by their leads and by leaders with work:manage over their place", () => {
    for (const who of [lead, owner, head]) expect(canAdminTeam(who, video)).toBe(true);
    for (const who of [member, colleague, otherHead]) expect(canAdminTeam(who, video)).toBe(false);
  });
  it("can be created only where the leader's grant reaches", () => {
    expect(canManageWorkspace(head, { entityId: SZM, departmentId: VID })).toBe(true);
    expect(canManageWorkspace(head, { entityId: SZM, departmentId: null })).toBe(false);
    expect(canManageWorkspace(owner, { entityId: null, departmentId: null })).toBe(true);
    expect(canManageWorkspace(member)).toBe(false);
  });
  it("are visible to employees, and to a collaborator only when they are in it", () => {
    expect(canViewTeam(colleague, video)).toBe(true);
    expect(canViewTeam(freelancer, video)).toBe(false);
    expect(canViewTeam(viewer("bao-anh", { collaborator: true, teams: { "team-video": "member" } }), video)).toBe(true);
  });
  it("let their members start projects", () => {
    expect(canCreateProject(member, video)).toBe(true);
    expect(canCreateProject(colleague, video)).toBe(false);
  });
});

describe("project privacy (FR-WRK-18)", () => {
  it("opens an entity project to the entity, not to other entities or collaborators", () => {
    expect(canViewProject(colleague, project("entity"))).toBe(true);
    expect(canViewProject(otherEntity, project("entity"))).toBe(false);
    expect(canViewProject(freelancer, project("entity"))).toBe(false);
    // A group project (no entity) is open to every employee.
    expect(canViewProject(otherEntity, project("entity", null))).toBe(true);
    // Looking is not working: a colleague cannot change tasks there.
    expect(canContributeToProject(colleague, project("entity"))).toBe(false);
  });
  it("keeps a team project to the team, the project's members and the leaders above it", () => {
    for (const who of [lead, member, owner, head]) expect(canViewProject(who, project("team"))).toBe(true);
    for (const who of [colleague, otherEntity, otherHead, freelancer]) expect(canViewProject(who, project("team"))).toBe(false);
    const guest = viewer("khoi", { entityId: SZC, projects: { "project-team": "member" } });
    expect(canViewProject(guest, project("team"))).toBe(true);
    expect(canContributeToProject(guest, project("team"))).toBe(true);
    expect(canManageProject(guest, project("team"))).toBe(false);
  });
  it("keeps a private project to its members and the team's leads — work:manage does not open it", () => {
    const insider = viewer("tam", { teams: { "team-video": "member" }, projects: { "project-private": "member" } });
    expect(canViewProject(insider, project("private"))).toBe(true);
    expect(canViewProject(lead, project("private"))).toBe(true);
    for (const who of [member, owner, head, colleague]) {
      expect(canViewProject(who, project("private"))).toBe(false);
      expect(canContributeToProject(who, project("private"))).toBe(false);
      expect(canManageProject(who, project("private"))).toBe(false);
    }
  });
  it("lets the project lead, the team lead and leaders in scope manage a project", () => {
    expect(canManageProject(viewer("tam", { projects: { "project-team": "lead" } }), project("team"))).toBe(true);
    for (const who of [lead, owner, head]) expect(canManageProject(who, project("team"))).toBe(true);
    for (const who of [member, colleague, otherHead]) expect(canManageProject(who, project("team"))).toBe(false);
  });
});

describe("tasks", () => {
  it("follow their project", () => {
    expect(canViewTask(member, taskIn())).toBe(true);
    expect(canEditTask(member, taskIn())).toBe(true);
    expect(canViewTask(colleague, taskIn())).toBe(false);
    expect(canEditTask(colleague, taskIn({ project: project("entity") }))).toBe(false);
    expect(canViewTask(colleague, taskIn({ project: project("entity") }))).toBe(true);
  });
  it("always show to the people on them, even in a private project", () => {
    const secret = { project: project("private") };
    expect(canViewTask(colleague, taskIn({ ...secret, assigneePersonId: "bao" }))).toBe(true);
    expect(canEditTask(colleague, taskIn({ ...secret, assigneePersonId: "bao" }))).toBe(true);
    expect(canEditTask(colleague, taskIn({ ...secret, peopleIds: ["bao"] }))).toBe(true);
    // The requester watches, but does not edit.
    expect(canViewTask(colleague, taskIn({ ...secret, requesterPersonId: "bao" }))).toBe(true);
    expect(canEditTask(colleague, taskIn({ ...secret, requesterPersonId: "bao" }))).toBe(false);
  });
  it("without a project follow the team's default visibility", () => {
    expect(canViewTask(member, taskIn({ project: null }))).toBe(true);
    expect(canViewTask(colleague, taskIn({ project: null }))).toBe(false);
    expect(canViewTask(colleague, taskIn({ project: null, team: { ...video, defaultVisibility: "entity" } }))).toBe(true);
    expect(canViewTask(member, taskIn({ project: null, team: { ...video, defaultVisibility: "private" } }))).toBe(false);
  });
  it("are deleted by whoever runs the project, or by their creator", () => {
    expect(canDeleteTask(lead, taskIn())).toBe(true);
    expect(canDeleteTask(member, taskIn())).toBe(false);
    expect(canDeleteTask(member, taskIn({ createdByPersonId: "huy" }))).toBe(true);
    // A creator who has since left the team keeps no rights over the task.
    expect(canDeleteTask(colleague, taskIn({ createdByPersonId: "bao" }))).toBe(false);
  });
});
