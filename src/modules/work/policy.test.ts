import { describe, expect, it } from "vitest";
import type { Grant } from "../platform/rbac/policy";
import type { ProjectRole, TeamRole } from "./enums";
import { canManageAutomations, canViewAutomations } from "./policy";
import { canChangeDeliverable, canDecideStage, canManagePublish, canManageReviewChains, canPinFeedback, canRecordClientDecision, canRecordDelivery, canResolvePin } from "./policy";
import { canAcknowledgeCover, canChangeAccountManager, canHandBackCover, canHandOff, canManageHandoffPackages, canRespondToHandoff, canRunExitHandover, canSendToTeam, canSubmitCoverPlan, canViewCoverPlan, canViewExitHandover } from "./policy";
import { canAddTeamMember, canActForClient, canAdminTeam, canDecideReview, canDecideTriage, canJoinTaskConversation, canManageCustomFields, canMoveTask, canRaiseBlocker, canResolveBlocker, canSeeLoggedTime, canViewTeamBacklog, canViewTriage, canContributeToProject, canCreateProject, canDeleteTask, canEditTask, canManageProject, canManageWorkspace, canViewProject, canViewTask, canViewTeam, type ProjectFacts, readsPrivateByPortfolio, type TaskFacts, type TeamFacts, type WorkViewer } from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const VID = "dept-vid";

const viewer = (personId: string, options: { entityId?: string | null; grants?: Grant[]; teams?: Record<string, TeamRole>; projects?: Record<string, ProjectRole>; collaborator?: boolean } = {}): WorkViewer => ({
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
const head = viewer("head", { grants: [{ role: "department_head", scope: { type: "unit", id: VID } }] });
const otherHead = viewer("chi", { entityId: SZC, grants: [{ role: "department_head", scope: { type: "unit", id: "dept-des" } }] });
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
  it("take in only people of their own place, unless the leader's grant reaches the person", () => {
    const inside = { entityId: SZM, unitPath: [VID] };
    const otherUnit = { entityId: SZM, unitPath: ["dept-des"] };
    const otherEntityPerson = { entityId: SZC, unitPath: [VID] };
    // The team hangs off Video: its lead adds people of that subtree and of its entity.
    expect(canAddTeamMember(lead, video, inside)).toBe(true);
    expect(canAddTeamMember(lead, video, otherUnit)).toBe(false);
    expect(canAddTeamMember(lead, video, otherEntityPerson)).toBe(false);
    // A leader whose grant reaches where the person sits may put anyone in.
    expect(canAddTeamMember(owner, video, otherEntityPerson)).toBe(true);
    expect(canAddTeamMember(head, video, otherUnit)).toBe(false);
    // A team of no unit takes anyone of its entity; a group team, anyone.
    const design: TeamFacts = { id: "team-design", entityId: SZM, departmentId: null, defaultVisibility: "team" };
    const designLead = viewer("dl", { teams: { "team-design": "lead" } });
    expect(canAddTeamMember(designLead, design, otherUnit)).toBe(true);
    expect(canAddTeamMember(designLead, design, otherEntityPerson)).toBe(false);
    expect(canAddTeamMember(designLead, { ...design, entityId: null }, otherEntityPerson)).toBe(true);
    // Running the team is still the first condition.
    expect(canAddTeamMember(member, video, inside)).toBe(false);
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
    // A team member and a colleague are not its people and hold no `pjm:portfolio`: nothing at all.
    for (const who of [member, colleague, otherHead, freelancer]) {
      expect(canViewProject(who, project("private"))).toBe(false);
      expect(canContributeToProject(who, project("private"))).toBe(false);
      expect(canManageProject(who, project("private"))).toBe(false);
    }
  });

  // The owner's decision of 2026-09-23 (Q25), reversing the Phase 3 default.
  it("lets the owner and a pjm:portfolio holder read a private project — and do nothing in it", () => {
    const secret = project("private");
    for (const who of [owner, head]) {
      expect(canViewProject(who, secret)).toBe(true);
      expect(readsPrivateByPortfolio(who, secret)).toBe(true);
      // Reading, not working: they contribute nothing, run nothing, join no conversation.
      expect(canContributeToProject(who, secret)).toBe(false);
      expect(canManageProject(who, secret)).toBe(false);
      expect(canActForClient(who, secret)).toBe(false);
      expect(canEditTask(who, taskIn({ project: secret }))).toBe(false);
      expect(canDeleteTask(who, taskIn({ project: secret }))).toBe(false);
      expect(canDecideReview(who, taskIn({ project: secret }), { reviewerPersonId: null, submittedByPersonId: "huy" })).toBe(false);
      expect(canJoinTaskConversation(who, taskIn({ project: secret }))).toBe(false);
      expect(canPinFeedback(who, taskIn({ project: secret }))).toBe(false);
      // They do read it, and its tasks with it.
      expect(canViewTask(who, taskIn({ project: secret }))).toBe(true);
    }
    // Its own people are not "reading from outside": nothing of theirs is audited, and they work.
    expect(readsPrivateByPortfolio(lead, secret)).toBe(false);
    expect(readsPrivateByPortfolio(viewer("tam", { projects: { "project-private": "member" } }), secret)).toBe(false);
    // A grant that does not reach the owning team opens nothing.
    expect(canViewProject(otherHead, secret)).toBe(false);
    // Narrow on purpose: a private *team backlog* was not part of the decision.
    expect(canViewTeamBacklog(head, { ...video, defaultVisibility: "private" })).toBe(false);
    // Being asked to do the work still makes them a party, with everything that follows.
    const assigned = taskIn({ project: secret, assigneePersonId: "head" });
    expect(canJoinTaskConversation(head, assigned)).toBe(true);
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

describe("project roles (FR-PJM-14)", () => {
  const privateProject = project("private");
  const viewerOnly = viewer("xem", { projects: { [privateProject.id]: "viewer" } });
  const accountManager = viewer("am", { projects: { [privateProject.id]: "account_manager" } });
  const projectMember = viewer("tv", { projects: { [privateProject.id]: "member" } });

  it("lets a viewer look and nothing more", () => {
    expect(canViewProject(viewerOnly, privateProject)).toBe(true);
    expect(canContributeToProject(viewerOnly, privateProject)).toBe(false);
    expect(canEditTask(viewerOnly, taskIn({ project: privateProject }))).toBe(false);
    expect(canActForClient(viewerOnly, privateProject)).toBe(false);
  });

  it("gives the account manager the client side, not the project's settings", () => {
    expect(canContributeToProject(accountManager, privateProject)).toBe(true);
    expect(canActForClient(accountManager, privateProject)).toBe(true);
    expect(canManageProject(accountManager, privateProject)).toBe(false);
    expect(canActForClient(projectMember, privateProject)).toBe(false);
    expect(canActForClient(lead, privateProject)).toBe(true);
  });

  it("opens projects in scope to pjm:portfolio — a private one to read only (Q25)", () => {
    const portfolio = viewer("port", { entityId: SZC, grants: [{ role: "entity_director", scope: { type: "entity", id: SZM } }] });
    expect(canViewProject(portfolio, project("team"))).toBe(true);
    expect(canViewProject(portfolio, privateProject)).toBe(true);
    expect(canContributeToProject(portfolio, privateProject)).toBe(false);
    // Out of scope (another entity's project): still nothing.
    expect(canViewProject(portfolio, { ...privateProject, entityId: SZC, team: { ...video, entityId: SZC, departmentId: null } })).toBe(false);
  });
});

describe("PJM task foundation", () => {
  const design: TeamFacts = { id: "team-design", entityId: SZM, departmentId: "dept-des", defaultVisibility: "team" };
  const designProject: ProjectFacts = { id: "project-design", entityId: SZM, visibility: "team", team: design };
  const projectLead = viewer("tam", { teams: { "team-video": "member" }, projects: { "project-team": "lead" } });
  const both = viewer("huy", { teams: { "team-video": "member", "team-design": "member" } });

  it("custom fields: a team's by whoever runs the team, a project's by whoever runs the project", () => {
    for (const who of [lead, owner, head]) expect(canManageCustomFields(who, video)).toBe(true);
    for (const who of [member, projectLead, colleague]) expect(canManageCustomFields(who, video)).toBe(false);
    expect(canManageCustomFields(projectLead, video, project("team"))).toBe(true);
    expect(canManageCustomFields(member, video, project("team"))).toBe(false);
    // A project is managed in its own team's settings only.
    expect(canManageCustomFields(lead, design, project("team"))).toBe(false);
  });

  it("triage: the team sees its queue, only the leads decide", () => {
    expect(canViewTriage(member, video)).toBe(true);
    expect(canViewTriage(colleague, video)).toBe(false);
    for (const who of [lead, owner, head]) expect(canDecideTriage(who, video)).toBe(true);
    for (const who of [member, colleague, otherHead]) expect(canDecideTriage(who, video)).toBe(false);
  });

  it("blockers: raised by the people who work on the task; resolved by them, the raiser or the person it waits for", () => {
    expect(canRaiseBlocker(member, taskIn())).toBe(true);
    expect(canRaiseBlocker(colleague, taskIn())).toBe(false);
    expect(canRaiseBlocker(colleague, taskIn({ assigneePersonId: "bao" }))).toBe(true);
    const raised = { raisedByPersonId: "huy", neededPersonId: "bao" };
    expect(canResolveBlocker(colleague, taskIn(), raised)).toBe(true);
    expect(canResolveBlocker(member, taskIn(), raised)).toBe(true);
    expect(canResolveBlocker(otherEntity, taskIn(), raised)).toBe(false);
  });

  it("moves: edit here and contribute there — never to the same team or a project of another team", () => {
    expect(canMoveTask(both, taskIn(), { team: design, project: null })).toBe(true);
    expect(canMoveTask(both, taskIn(), { team: design, project: designProject })).toBe(true);
    expect(canMoveTask(member, taskIn(), { team: design, project: null })).toBe(false);
    expect(canMoveTask(lead, taskIn(), { team: design, project: null })).toBe(false);
    expect(canMoveTask(owner, taskIn(), { team: design, project: designProject })).toBe(true);
    expect(canMoveTask(both, taskIn(), { team: video, project: null })).toBe(false);
    expect(canMoveTask(both, taskIn(), { team: design, project: project("team") })).toBe(false);
    expect(canMoveTask(colleague, taskIn(), { team: design, project: null })).toBe(false);
  });

  it("logged time per task: the project's lead and the team's leads, not every member", () => {
    expect(canSeeLoggedTime(projectLead, { team: video, project: project("team") })).toBe(true);
    expect(canSeeLoggedTime(lead, { team: video, project: project("team") })).toBe(true);
    expect(canSeeLoggedTime(member, { team: video, project: project("team") })).toBe(false);
    expect(canSeeLoggedTime(lead, { team: video, project: null })).toBe(true);
    expect(canSeeLoggedTime(projectLead, { team: video, project: null })).toBe(false);
  });
});

describe("hand-offs (FR-PJM-40..46)", () => {
  const design: TeamFacts = { id: "team-design", entityId: SZM, departmentId: null, defaultVisibility: "team" };
  const hr = viewer("hr", { grants: [{ role: "hr_staff", scope: { type: "entity", id: SZM } }] });
  const otherHr = viewer("hr-szc", { entityId: SZC, grants: [{ role: "hr_staff", scope: { type: "entity", id: SZC } }] });
  const director = viewer("director", { grants: [{ role: "entity_director", scope: { type: "entity", id: SZM } }] });

  it("packages are defined by whoever runs the team", () => {
    for (const who of [lead, owner, head]) expect(canManageHandoffPackages(who, video)).toBe(true);
    for (const who of [member, colleague, otherHead]) expect(canManageHandoffPackages(who, video)).toBe(false);
  });

  it("the people who move a task hand it off; a hand-off is accepted or returned by its receiver or a lead, never by its sender", () => {
    expect(canHandOff(member, taskIn())).toBe(true);
    expect(canHandOff(colleague, taskIn())).toBe(false);
    const handoff = { fromPersonId: "huy", toPersonId: "bao" };
    expect(canRespondToHandoff(colleague, taskIn(), handoff)).toBe(true);
    expect(canRespondToHandoff(lead, taskIn(), handoff)).toBe(true);
    expect(canRespondToHandoff(member, taskIn(), handoff)).toBe(false);
    expect(canRespondToHandoff(otherEntity, taskIn(), handoff)).toBe(false);
    expect(canRespondToHandoff(lead, taskIn(), { fromPersonId: "long", toPersonId: "bao" })).toBe(false);
    // On a private project's task only the people who run that project stand in for the receiver:
    // `work:manage` over the team does not reach in.
    const secret = taskIn({ project: project("private") });
    expect(canRespondToHandoff(owner, secret, handoff)).toBe(false);
    expect(canRespondToHandoff(head, secret, handoff)).toBe(false);
    expect(canRespondToHandoff(lead, secret, handoff)).toBe(true);
    expect(canRespondToHandoff(viewer("tam", { projects: { "project-private": "lead" } }), secret, handoff)).toBe(true);
  });

  it("work goes to another team's triage from whoever may move it — not to its own team, not by a collaborator", () => {
    expect(canSendToTeam(member, taskIn(), design)).toBe(true);
    expect(canSendToTeam(member, taskIn(), video)).toBe(false);
    expect(canSendToTeam(colleague, taskIn(), design)).toBe(false);
    const inProject = viewer("bao-anh", { collaborator: true, projects: { "project-team": "member" } });
    expect(canEditTask(inProject, taskIn())).toBe(true);
    expect(canSendToTeam(inProject, taskIn(), design)).toBe(false);
  });

  it("a cover plan is submitted by the person or work:manage over their entity; covers see it and acknowledge it", () => {
    const plan = { personId: "huy", entityId: SZM, coverIds: ["bao"] };
    expect(canSubmitCoverPlan(member, plan)).toBe(true);
    expect(canSubmitCoverPlan(owner, plan)).toBe(true);
    expect(canSubmitCoverPlan(colleague, plan)).toBe(false);
    expect(canSubmitCoverPlan(lead, plan)).toBe(false);
    expect(canViewCoverPlan(colleague, plan)).toBe(true);
    expect(canViewCoverPlan(otherEntity, plan)).toBe(false);
    expect(canAcknowledgeCover(colleague, plan)).toBe(true);
    expect(canAcknowledgeCover(member, plan)).toBe(false);
    expect(canHandBackCover(member, plan)).toBe(true);
    expect(canHandBackCover(colleague, plan)).toBe(true);
    expect(canHandBackCover(otherEntity, plan)).toBe(false);
  });

  it("an exit handover is run by the line manager, the person's team leads, and work or HR leaders of the entity — not by the leaver", () => {
    const handover = { personId: "huy", managerId: "manager", entityId: SZM, teamIds: ["team-video"] };
    for (const who of [viewer("manager"), lead, hr, director, owner]) expect(canRunExitHandover(who, handover)).toBe(true);
    for (const who of [member, colleague, otherHr, viewer("design-lead", { teams: { "team-design": "lead" } })]) expect(canRunExitHandover(who, handover)).toBe(false);
    expect(canViewExitHandover(member, handover)).toBe(true);
    expect(canViewExitHandover(colleague, handover)).toBe(false);
  });

  it("the account manager of a client is changed by leaders whose grant reaches the client's entity", () => {
    const vinamilk = { entityId: SZM };
    expect(canChangeAccountManager(owner, vinamilk)).toBe(true);
    expect(canChangeAccountManager(lead, vinamilk)).toBe(false);
    expect(canChangeAccountManager(director, vinamilk)).toBe(true);
    // A department head's unit grant covers no whole entity, and another entity's leader is out.
    expect(canChangeAccountManager(head, vinamilk)).toBe(false);
    expect(canChangeAccountManager(director, { entityId: SZC })).toBe(false);
    // A group client (no entity of its own) takes a group-wide grant.
    expect(canChangeAccountManager(director, { entityId: null })).toBe(false);
    expect(canChangeAccountManager(owner, { entityId: null })).toBe(true);
  });
});

describe("delivery (FR-PJM-50..57)", () => {
  const am = viewer("an", { projects: { "project-team": "account_manager" } });
  const pl = viewer("pl", { projects: { "project-team": "lead" } });
  const projectViewer = viewer("vi", { projects: { "project-team": "viewer" } });
  const doer = viewer("huy", { teams: { "team-video": "member" } });
  const task = taskIn({ assigneePersonId: "huy" });
  const backlog = taskIn({ project: null, assigneePersonId: "huy" });
  const noClientAm = { accountManagerPersonId: null };

  it("review chains are kept by the team's leads, and a project's own by whoever runs the project", () => {
    expect(canManageReviewChains(lead, video)).toBe(true);
    expect(canManageReviewChains(head, video)).toBe(true);
    for (const who of [member, am, pl, colleague]) expect(canManageReviewChains(who, video)).toBe(false);
    expect(canManageReviewChains(pl, video, project("team"))).toBe(true);
    expect(canManageReviewChains(lead, video, project("team"))).toBe(true);
    for (const who of [am, member, projectViewer]) expect(canManageReviewChains(who, video, project("team"))).toBe(false);
    // A project of another team is no place for this team's chain.
    expect(canManageReviewChains(lead, { ...video, id: "team-design" }, project("team"))).toBe(false);
  });

  it("an internal stage is decided by its reviewer or whoever runs the project, never by the submitter", () => {
    const stage = { isClient: false, reviewerPersonId: "bao", submittedByPersonId: "huy" };
    expect(canDecideStage(viewer("bao"), task, stage, noClientAm)).toBe(true);
    expect(canDecideStage(lead, task, stage, noClientAm)).toBe(true);
    expect(canDecideStage(pl, task, stage, noClientAm)).toBe(true);
    expect(canDecideStage(doer, task, stage, noClientAm)).toBe(false);
    expect(canDecideStage(am, task, stage, noClientAm)).toBe(false);
    expect(canDecideStage(viewer("bao"), task, { ...stage, submittedByPersonId: "bao" }, noClientAm)).toBe(false);
  });

  it("a client stage, and any client decision, is recorded by the account side only", () => {
    const stage = { isClient: true, reviewerPersonId: "an", submittedByPersonId: "huy" };
    for (const who of [am, pl, lead]) expect(canDecideStage(who, task, stage, noClientAm)).toBe(true);
    for (const who of [doer, colleague, projectViewer, viewer("bao")]) expect(canDecideStage(who, task, stage, noClientAm)).toBe(false);
    expect(canRecordClientDecision(am, task, noClientAm)).toBe(true);
    expect(canRecordClientDecision(doer, task, noClientAm)).toBe(false);
    // Outside a project: the client's account manager, or the team's leads.
    expect(canRecordClientDecision(viewer("an"), backlog, { accountManagerPersonId: "an" })).toBe(true);
    expect(canRecordClientDecision(lead, backlog, noClientAm)).toBe(true);
    expect(canRecordClientDecision(doer, backlog, { accountManagerPersonId: "an" })).toBe(false);
  });

  it("a frozen version cannot change", () => {
    expect(canChangeDeliverable({ frozenAt: null })).toBe(true);
    expect(canChangeDeliverable({ frozenAt: new Date() })).toBe(false);
    expect(canChangeDeliverable({ frozenAt: "2026-09-22T00:00:00Z" })).toBe(false);
  });

  it("pins are for whoever may open the task; resolving them for their author and the people doing the work", () => {
    // A project viewer only looks — but may point at what is wrong.
    expect(canPinFeedback(projectViewer, task)).toBe(true);
    expect(canPinFeedback(colleague, task)).toBe(false);
    expect(canResolvePin(projectViewer, task, { authorPersonId: "vi" })).toBe(true);
    expect(canResolvePin(doer, task, { authorPersonId: "lan" })).toBe(true);
    expect(canResolvePin(projectViewer, task, { authorPersonId: "lan" })).toBe(false);
  });

  it("deliveries are recorded by the people doing the work and the account side; the publish log by whoever may change the task", () => {
    for (const who of [doer, am, pl, lead]) expect(canRecordDelivery(who, task)).toBe(true);
    for (const who of [colleague, projectViewer]) expect(canRecordDelivery(who, task)).toBe(false);
    expect(canManagePublish(doer, task)).toBe(true);
    expect(canManagePublish(projectViewer, task)).toBe(false);
    expect(canManagePublish(colleague, task)).toBe(false);
  });
});

describe("automations (FR-PJM-33)", () => {
  it("are kept by whoever runs the team only — a project's lead or member does not write rules", () => {
    for (const who of [lead, owner, head]) expect(canManageAutomations(who, video)).toBe(true);
    const projectLead = viewer("tam", { projects: { "project-team": "lead" } });
    for (const who of [member, colleague, otherHead, freelancer, projectLead]) expect(canManageAutomations(who, video)).toBe(false);
  });
  it("of a project also need the right to run that project — a private project's rules stay inside it", () => {
    for (const who of [lead, owner, head]) expect(canManageAutomations(who, video, project("team"))).toBe(true);
    expect(canManageAutomations(lead, video, project("private"))).toBe(true);
    for (const who of [owner, head]) expect(canManageAutomations(who, video, project("private"))).toBe(false);
    // The project must be the team's own.
    expect(canManageAutomations(lead, { ...video, id: "team-design" }, project("team"))).toBe(false);
  });
  it("are read by the team's own people", () => {
    for (const who of [lead, member, owner]) expect(canViewAutomations(who, video)).toBe(true);
    for (const who of [colleague, freelancer, otherEntity]) expect(canViewAutomations(who, video)).toBe(false);
  });
});
