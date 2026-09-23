import { describe, expect, it } from "vitest";
import type { Grant } from "../platform/rbac/policy";
import type { ProjectRole, TeamRole } from "../work/enums";
import { canGiveProjectRole, type ProjectFacts, type TeamFacts, type WorkViewer } from "../work/policy";
import { billingReach, canAddRaid, canCloseRaidItem, canCreateProjectSpace, canEditMeeting, canEditRaidItem, canRecordMeeting, canViewMeetings, canViewRaid, type CapacityReader, type CapacitySubject, canCloseProject, canDecideBilling, canEditClientSide, canEditFees, canEditPlan, canEditRetainer, canHoldRetro, canManageAcceptance, canManageBookings, canManageChanges, canOpenBillingQueue, canOpenCapacity, canPostStatus, canRebaseline, canSeeCapacityOf, canSeeFees, canViewBookings, canViewPlan, canWriteClientReport } from "./policy";

const SZM = "entity-szm";
const SZC = "entity-szc";
const VID = "dept-vid";

const viewer = (personId: string, options: { entityId?: string; grants?: Grant[]; teams?: Record<string, TeamRole>; projects?: Record<string, ProjectRole> } = {}): WorkViewer => ({
  principal: { personId, workforceType: "employee", grants: options.grants ?? [] },
  entityId: options.entityId ?? SZM,
  teamRoles: new Map(Object.entries(options.teams ?? {})),
  projectRoles: new Map(Object.entries(options.projects ?? {})),
});

const video: TeamFacts = { id: "team-video", entityId: SZM, departmentId: VID, defaultVisibility: "team" };
const tvc: ProjectFacts = { id: "project-tvc", entityId: SZM, visibility: "team", team: video };
const secret: ProjectFacts = { ...tvc, id: "project-secret", visibility: "private" };
const groupProject: ProjectFacts = { ...tvc, id: "project-group", entityId: null };

const outsider = viewer("bao");
const onlyViewer = viewer("vy", { projects: { "project-tvc": "viewer" } });
const member = viewer("huy", { projects: { "project-tvc": "member" } });
const teamMember = viewer("an", { teams: { "team-video": "member" } });
const accountManager = viewer("lan", { projects: { "project-tvc": "account_manager" } });
const lead = viewer("tam", { projects: { "project-tvc": "lead" } });
const teamLead = viewer("long", { teams: { "team-video": "lead" } });
const portfolio = viewer("head", { grants: [{ role: "department_head", scope: { type: "unit", id: VID } }] });
const director = viewer("dir", { grants: [{ role: "entity_director", scope: { type: "entity", id: SZM } }] });
const otherDirector = viewer("dir-c", { entityId: SZC, grants: [{ role: "entity_director", scope: { type: "entity", id: SZC } }] });
const finance = viewer("ke-toan", { grants: [{ role: "finance", scope: { type: "entity", id: SZM } }] });
const groupFinance = viewer("cfo", { grants: [{ role: "finance", scope: { type: "group" } }] });
const financeAm = viewer("lan-ke-toan", { projects: { "project-tvc": "account_manager" }, grants: [{ role: "finance", scope: { type: "entity", id: SZM } }] });

describe("reading the plan", () => {
  it("is for whoever may open the project", () => {
    for (const who of [onlyViewer, member, teamMember, accountManager, lead, teamLead, portfolio, director]) expect(canViewPlan(who, tvc)).toBe(true);
    expect(canViewPlan(outsider, tvc)).toBe(false);
    expect(canViewPlan(otherDirector, tvc)).toBe(false);
  });
  it("keeps a private project with its people, and opens it to pjm:portfolio to read (Q25)", () => {
    expect(canViewPlan(teamLead, secret)).toBe(true);
    expect(canViewPlan(viewer("huy", { projects: { "project-secret": "member" } }), secret)).toBe(true);
    // The owner's decision of 2026-09-23: a leader over the owning team may open it — and nothing more.
    expect(canViewPlan(portfolio, secret)).toBe(true);
    expect(canEditPlan(portfolio, secret)).toBe(false);
    expect(canEditClientSide(portfolio, secret)).toBe(false);
    expect(canPostStatus(portfolio, secret)).toBe(false);
    expect(canRebaseline(portfolio, secret)).toBe(false);
    expect(canCloseProject(portfolio, secret)).toBe(false);
    // Still nothing for a colleague or another entity's director.
    expect(canViewPlan(member, secret)).toBe(false);
    expect(canViewPlan(otherDirector, secret)).toBe(false);
  });
});

describe("changing the plan", () => {
  it("is for whoever runs the project: its lead, the team's lead, work:manage over the team", () => {
    for (const who of [lead, teamLead, portfolio, director]) expect(canEditPlan(who, tvc)).toBe(true);
    for (const who of [onlyViewer, member, teamMember, accountManager, outsider]) expect(canEditPlan(who, tvc)).toBe(false);
  });
  it("gives the account manager the client side: the brief and the kick-off gate", () => {
    for (const who of [accountManager, lead, teamLead]) expect(canEditClientSide(who, tvc)).toBe(true);
    for (const who of [member, onlyViewer, teamMember]) expect(canEditClientSide(who, tvc)).toBe(false);
  });
});

describe("fees (pjm:commercial)", () => {
  it("are read with pjm:commercial over the project's entity", () => {
    for (const who of [director, finance, groupFinance]) expect(canSeeFees(who, tvc)).toBe(true);
    // Reading every project, or working in one, is not reading its money.
    for (const who of [teamLead, member, teamMember, onlyViewer, portfolio, otherDirector, outsider]) expect(canSeeFees(who, tvc)).toBe(false);
  });

  // The owner's decision of 2026-09-23 (Q21): "project lead & account managers can see (and upper
  // levels as well)" — the upper levels being `pjm:commercial`, which is not widened.
  it("are read by the project's own lead and its own account manager — their own project only", () => {
    expect(canSeeFees(lead, tvc)).toBe(true);
    expect(canSeeFees(accountManager, tvc)).toBe(true);
    // Another project of the same team, which they neither lead nor keep the client of.
    const other: ProjectFacts = { ...tvc, id: "project-other" };
    expect(canSeeFees(lead, other)).toBe(false);
    expect(canSeeFees(accountManager, other)).toBe(false);
    // The team's lead, a member and a viewer of the very same project still see no money.
    for (const who of [teamLead, member, onlyViewer, teamMember]) expect(canSeeFees(who, tvc)).toBe(false);
    // Reading it is not moving it.
    expect(canEditFees(lead, tvc)).toBe(false);
    expect(canEditFees(accountManager, tvc)).toBe(false);
  });
  // …which is why the seats themselves are handed out with `pjm:commercial`: otherwise whoever
  // runs the project — a team lead, `work:manage` — would name themselves lead or account manager
  // and read the price (security review of 2026-09-23).
  it("are not reached by naming oneself lead or account manager", () => {
    for (const who of [teamLead, portfolio, lead]) {
      expect(canGiveProjectRole(who, tvc, null, "lead")).toBe(false);
      expect(canGiveProjectRole(who, tvc, "member", "account_manager")).toBe(false);
    }
    // The director runs the project and holds `pjm:commercial` over its entity: they may.
    expect(canGiveProjectRole(director, tvc, "member", "account_manager")).toBe(true);
    // Finance reads fees but runs no project, so it staffs none either.
    expect(canGiveProjectRole(finance, tvc, null, "lead")).toBe(false);
  });
  it("of a group project need a group-wide grant", () => {
    expect(canSeeFees(groupFinance, groupProject)).toBe(true);
    expect(canSeeFees(finance, groupProject)).toBe(false);
  });
  it("are changed by someone who both reads money and owns the client side", () => {
    expect(canEditFees(director, tvc)).toBe(true);
    expect(canEditFees(financeAm, tvc)).toBe(true);
    // Finance reads fees but does not run projects; the account manager runs the client side but reads no money.
    expect(canEditFees(finance, tvc)).toBe(false);
    expect(canEditFees(accountManager, tvc)).toBe(false);
  });
});

describe("status updates (FR-PJM-27)", () => {
  it("are posted by the lead, the account manager or a lead of the team", () => {
    for (const who of [lead, accountManager, teamLead]) expect(canPostStatus(who, tvc)).toBe(true);
    for (const who of [member, onlyViewer, teamMember, portfolio, director, outsider]) expect(canPostStatus(who, tvc)).toBe(false);
  });
});

describe("re-baselining (FR-PJM-12)", () => {
  it("is the project lead's, or a lead of the owning team's", () => {
    for (const who of [lead, teamLead]) expect(canRebaseline(who, tvc)).toBe(true);
    // Planning the project is not moving its yardstick: workspace managers and the account manager cannot.
    for (const who of [accountManager, portfolio, director, member, onlyViewer, teamMember, outsider]) expect(canRebaseline(who, tvc)).toBe(false);
  });
});

describe("bookings (FR-PJM-13)", () => {
  it("are read by the project's readers and made by whoever runs it", () => {
    for (const who of [onlyViewer, member, teamMember, accountManager, lead, teamLead, portfolio, director]) expect(canViewBookings(who, tvc)).toBe(true);
    for (const who of [outsider, otherDirector]) expect(canViewBookings(who, tvc)).toBe(false);
    for (const who of [lead, teamLead, portfolio, director]) expect(canManageBookings(who, tvc)).toBe(true);
    for (const who of [onlyViewer, member, teamMember, accountManager, outsider]) expect(canManageBookings(who, tvc)).toBe(false);
  });
  it("of a private project stay with its people — a portfolio reader looks and books nothing (Q25)", () => {
    expect(canViewBookings(portfolio, secret)).toBe(true);
    expect(canManageBookings(portfolio, secret)).toBe(false);
    expect(canManageBookings(director, secret)).toBe(false);
    expect(canManageBookings(teamLead, secret)).toBe(true);
  });
});

describe("capacity (FR-PJM-13)", () => {
  const reader = (personId: string, options: { grants?: Grant[]; leads?: string[] } = {}): CapacityReader => ({ personId, principal: { personId, workforceType: "employee", grants: options.grants ?? [] }, ledTeamIds: new Set(options.leads ?? []) });
  // Huy is in the video team, reports to Tam, who reports to the department head's deputy Long.
  const huy: CapacitySubject = { personId: "huy", teamIds: ["team-video"], chainAbove: ["tam", "long"], entityId: SZM, unitPath: ["dept-marketing", VID] };
  const other: CapacitySubject = { personId: "mai", teamIds: ["team-social"], chainAbove: ["ha"], entityId: SZC, unitPath: ["dept-sales"] };

  it("is seen by the leads of the person's teams and every manager above them", () => {
    expect(canSeeCapacityOf(reader("long-lead", { leads: ["team-video"] }), huy)).toBe(true);
    expect(canSeeCapacityOf(reader("tam"), huy)).toBe(true);
    expect(canSeeCapacityOf(reader("long"), huy)).toBe(true);
  });
  it("is seen by pjm:portfolio and work:manage holders over where the person sits", () => {
    expect(canSeeCapacityOf(reader("head", { grants: [{ role: "department_head", scope: { type: "unit", id: VID } }] }), huy)).toBe(true);
    expect(canSeeCapacityOf(reader("dir", { grants: [{ role: "entity_director", scope: { type: "entity", id: SZM } }] }), huy)).toBe(true);
    expect(canSeeCapacityOf(reader("dir", { grants: [{ role: "entity_director", scope: { type: "entity", id: SZM } }] }), other)).toBe(false);
    expect(canSeeCapacityOf(reader("head", { grants: [{ role: "department_head", scope: { type: "unit", id: VID } }] }), other)).toBe(false);
  });
  it("is not seen by colleagues, other teams' leads, a project lead as such, or roles without the permissions", () => {
    expect(canSeeCapacityOf(reader("an"), huy)).toBe(false);
    expect(canSeeCapacityOf(reader("social-lead", { leads: ["team-social"] }), huy)).toBe(false);
    // Finance reads money, HR reads people: neither plans work.
    expect(canSeeCapacityOf(reader("ke-toan", { grants: [{ role: "finance", scope: { type: "entity", id: SZM } }] }), huy)).toBe(false);
    expect(canSeeCapacityOf({ personId: null, principal: { personId: null, workforceType: null, grants: [] }, ledTeamIds: new Set(["team-video"]) }, huy)).toBe(false);
  });
  it("opens for someone who plans others' time somewhere", () => {
    expect(canOpenCapacity(reader("long-lead", { leads: ["team-video"] }), false)).toBe(true);
    expect(canOpenCapacity(reader("tam"), true)).toBe(true);
    expect(canOpenCapacity(reader("head", { grants: [{ role: "department_head", scope: { type: "unit", id: VID } }] }), false)).toBe(true);
    expect(canOpenCapacity(reader("an"), false)).toBe(false);
    expect(canOpenCapacity(reader("ke-toan", { grants: [{ role: "finance", scope: { type: "group" } }] }), false)).toBe(false);
  });
});

// ── The commercial side (FR-PJM-06, 11, 55, 56, 58, 59) ─────────────────────────────────────

const closed = { ...tvc, closed: true };

describe("retainers and change requests", () => {
  it("are edited by the account manager and whoever runs the project", () => {
    for (const who of [accountManager, lead, teamLead, director]) {
      expect(canEditRetainer(who, tvc)).toBe(true);
      expect(canManageChanges(who, tvc)).toBe(true);
    }
    for (const who of [member, onlyViewer, teamMember, outsider, finance]) {
      expect(canEditRetainer(who, tvc)).toBe(false);
      expect(canManageChanges(who, tvc)).toBe(false);
    }
  });
  it("put money — a monthly fee, a fee delta — only in the hands of pjm:commercial holders who also run the client side", () => {
    expect(canEditFees(financeAm, tvc)).toBe(true);
    for (const who of [accountManager, lead, teamLead, finance]) expect(canEditFees(who, tvc)).toBe(false);
  });
});

describe("acceptance and client reports", () => {
  it("are the account manager's and the lead's, and outlive the close", () => {
    for (const who of [accountManager, lead, teamLead]) {
      expect(canManageAcceptance(who, tvc)).toBe(true);
      expect(canManageAcceptance(who, closed)).toBe(true);
      expect(canWriteClientReport(who, tvc)).toBe(true);
    }
    for (const who of [member, onlyViewer, outsider, finance]) {
      expect(canManageAcceptance(who, tvc)).toBe(false);
      expect(canWriteClientReport(who, tvc)).toBe(false);
    }
  });
});

describe("the billing queue", () => {
  it("opens for pjm:commercial holders, never for line managers, leads or account managers as such", () => {
    for (const who of [finance, groupFinance, director]) expect(canOpenBillingQueue(who.principal)).toBe(true);
    for (const who of [lead, teamLead, accountManager, portfolio, member]) expect(canOpenBillingQueue(who.principal)).toBe(false);
  });
  it("decides an item only over its own entity; a group project's items need a group-wide grant", () => {
    expect(canDecideBilling(finance.principal, { entityId: SZM })).toBe(true);
    expect(canDecideBilling(finance.principal, { entityId: SZC })).toBe(false);
    expect(canDecideBilling(finance.principal, { entityId: null })).toBe(false);
    expect(canDecideBilling(groupFinance.principal, { entityId: null })).toBe(true);
    expect(canDecideBilling(otherDirector.principal, { entityId: SZM })).toBe(false);
    expect(canDecideBilling(lead.principal, { entityId: SZM })).toBe(false);
  });
  it("reaches the entities the reader holds pjm:commercial over", () => {
    expect(billingReach(finance.principal)).toEqual({ all: false, entityIds: [SZM] });
    expect(billingReach(groupFinance.principal)).toEqual({ all: true });
    expect(billingReach(lead.principal)).toEqual({ all: false, entityIds: [] });
  });
});

describe("closing a project (FR-PJM-59)", () => {
  it("is the project lead's or the team lead's call — not the account manager's, not a workspace manager's", () => {
    for (const who of [lead, teamLead]) expect(canCloseProject(who, tvc)).toBe(true);
    for (const who of [accountManager, director, portfolio, member, finance]) expect(canCloseProject(who, tvc)).toBe(false);
    expect(canCloseProject(lead, closed)).toBe(false);
  });
  it("leaves the plan read-only for everyone, whatever their role", () => {
    for (const who of [lead, teamLead, director, accountManager, financeAm]) {
      expect(canEditPlan(who, closed)).toBe(false);
      expect(canManageBookings(who, closed)).toBe(false);
      expect(canEditClientSide(who, closed)).toBe(false);
      expect(canEditRetainer(who, closed)).toBe(false);
      expect(canManageChanges(who, closed)).toBe(false);
      expect(canEditFees(who, closed)).toBe(false);
      expect(canRebaseline(who, closed)).toBe(false);
      expect(canPostStatus(who, closed)).toBe(false);
    }
    // Reading stays as it was.
    expect(canViewPlan(lead, closed)).toBe(true);
    expect(canSeeFees(financeAm, closed)).toBe(true);
  });
  it("lets the lead, the account manager and the team lead hold the retrospective", () => {
    for (const who of [lead, accountManager, teamLead]) expect(canHoldRetro(who, closed)).toBe(true);
    for (const who of [member, director, finance]) expect(canHoldRetro(who, tvc)).toBe(false);
  });
});

describe("the RAID log (FR-PJM-29)", () => {
  const closed = { ...tvc, closed: true };
  const byMember = { ownerPersonId: null, createdByPersonId: "huy" };
  const ownedByAn = { ownerPersonId: "an", createdByPersonId: "tam" };

  it("is read by every reader of the project, written by the people working in it", () => {
    for (const who of [onlyViewer, member, teamMember, accountManager, lead, teamLead, portfolio, director]) expect(canViewRaid(who, tvc)).toBe(true);
    expect(canViewRaid(outsider, tvc)).toBe(false);
    for (const who of [member, teamMember, accountManager, lead, teamLead]) expect(canAddRaid(who, tvc)).toBe(true);
    // A viewer only looks.
    for (const who of [onlyViewer, outsider, otherDirector]) expect(canAddRaid(who, tvc)).toBe(false);
  });

  it("lets the author, the owner and whoever runs the project change an item — nobody else", () => {
    expect(canEditRaidItem(member, tvc, byMember)).toBe(true);
    expect(canEditRaidItem(teamMember, tvc, ownedByAn)).toBe(true);
    for (const who of [lead, teamLead]) expect(canEditRaidItem(who, tvc, byMember)).toBe(true);
    for (const who of [accountManager, teamMember, onlyViewer]) expect(canEditRaidItem(who, tvc, byMember)).toBe(false);
  });

  it("closes an item by the project's lead, a team lead or the item's owner — not its author", () => {
    for (const who of [lead, teamLead]) expect(canCloseRaidItem(who, tvc, byMember)).toBe(true);
    expect(canCloseRaidItem(teamMember, tvc, ownedByAn)).toBe(true);
    expect(canCloseRaidItem(member, tvc, byMember)).toBe(false);
    for (const who of [accountManager, onlyViewer, portfolio, outsider]) expect(canCloseRaidItem(who, tvc, byMember)).toBe(false);
  });

  it("is read-only once the project is closed", () => {
    for (const who of [member, lead, teamLead]) expect(canAddRaid(who, closed)).toBe(false);
    expect(canEditRaidItem(lead, closed, byMember)).toBe(false);
    expect(canCloseRaidItem(lead, closed, byMember)).toBe(false);
    expect(canViewRaid(member, closed)).toBe(true);
  });

  it("keeps a private project's log with its people — a portfolio reader reads it and adds nothing (Q25)", () => {
    expect(canViewRaid(portfolio, secret)).toBe(true);
    expect(canAddRaid(portfolio, secret)).toBe(false);
    expect(canCloseRaidItem(portfolio, secret, byMember)).toBe(false);
    expect(canAddRaid(teamMember, secret)).toBe(false);
    expect(canAddRaid(viewer("huy", { projects: { "project-secret": "member" } }), secret)).toBe(true);
  });
});

describe("meetings (FR-PJM-30) and the document space (FR-PJM-31)", () => {
  const weekly = { createdByPersonId: "huy", kind: "weekly" };
  const retro = { createdByPersonId: "tam", kind: "retro" };

  it("are read by the project's readers and recorded by its contributors", () => {
    for (const who of [onlyViewer, member, lead, teamLead, director]) expect(canViewMeetings(who, tvc)).toBe(true);
    expect(canViewMeetings(outsider, tvc)).toBe(false);
    for (const who of [member, teamMember, accountManager, lead, teamLead]) expect(canRecordMeeting(who, tvc)).toBe(true);
    // A manager of the team's workspace contributes to its non-private projects, as in the work module.
    expect(canRecordMeeting(director, tvc)).toBe(true);
    for (const who of [onlyViewer, outsider, otherDirector]) expect(canRecordMeeting(who, tvc)).toBe(false);
  });

  it("lets the note's author and whoever runs the project change it; the retrospective has its own page", () => {
    expect(canEditMeeting(member, tvc, weekly)).toBe(true);
    for (const who of [lead, teamLead]) expect(canEditMeeting(who, tvc, weekly)).toBe(true);
    for (const who of [teamMember, accountManager, onlyViewer]) expect(canEditMeeting(who, tvc, weekly)).toBe(false);
    for (const who of [lead, teamLead]) expect(canEditMeeting(who, tvc, retro)).toBe(false);
    expect(canEditMeeting(member, { ...tvc, closed: true }, weekly)).toBe(false);
  });

  it("makes the document space for the project's contributors, while it is open", () => {
    for (const who of [member, teamMember, lead, teamLead, accountManager]) expect(canCreateProjectSpace(who, tvc)).toBe(true);
    for (const who of [onlyViewer, outsider, otherDirector]) expect(canCreateProjectSpace(who, tvc)).toBe(false);
    expect(canCreateProjectSpace(lead, { ...tvc, closed: true })).toBe(false);
  });
});
