import { describe, expect, it } from "vitest";
import { canApproveTimesheet, canCommentOnReport, canOverseeReport, canViewReport, canViewTimeEntry, canViewTimesheet, canViewUtilisation, type ReportReader, type ReportSubject, type TimeReader } from "./policy";

const reader = (personId: string, led: string[] = []): ReportReader => ({ personId, ledTeamIds: new Set(led) });

// Huy works in Video (led by Long) and collaborates on Design's work as a member (led by Mai).
// His line manager is Tam, whose manager is Chi.
const huy: ReportSubject = { personId: "huy", teamIds: ["team-video", "team-design"], chainAbove: ["tam", "chi"] };

describe("daily report visibility", () => {
  it("the person sees their own", () => {
    expect(canViewReport(reader("huy"), huy)).toBe(true);
    expect(canOverseeReport(reader("huy"), huy)).toBe(false);
  });

  it("the lead of any team the person belongs to sees it", () => {
    expect(canViewReport(reader("long", ["team-video"]), huy)).toBe(true);
    expect(canViewReport(reader("mai", ["team-design"]), huy)).toBe(true);
    expect(canOverseeReport(reader("long", ["team-video"]), huy)).toBe(true);
  });

  it("the line manager and the manager's manager see it", () => {
    expect(canViewReport(reader("tam"), huy)).toBe(true);
    expect(canViewReport(reader("chi"), huy)).toBe(true);
    expect(canOverseeReport(reader("chi"), huy)).toBe(true);
  });

  it("a colleague in the same team does not", () => {
    // A member of Video, not its lead.
    expect(canViewReport(reader("bao"), huy)).toBe(false);
    expect(canCommentOnReport(reader("bao"), huy)).toBe(false);
  });

  it("the lead of another team does not", () => {
    expect(canViewReport(reader("khoi", ["team-social"]), huy)).toBe(false);
  });

  it("a collaborator, and someone the person manages, do not", () => {
    // A freelancer on Huy's project, and Huy's own report: the chain runs upwards only.
    expect(canViewReport(reader("bao-anh"), huy)).toBe(false);
    const intern: ReportSubject = { personId: "intern", teamIds: ["team-video"], chainAbove: ["huy", "tam", "chi"] };
    expect(canViewReport(reader("intern"), huy)).toBe(false);
    expect(canViewReport(reader("huy"), intern)).toBe(true);
  });

  it("nobody without a person record", () => {
    expect(canViewReport({ personId: null, ledTeamIds: new Set(["team-video"]) }, huy)).toBe(false);
  });
});

const timeReader = (personId: string, led: string[] = [], projects: string[] = []): TimeReader => ({ personId, ledTeamIds: new Set(led), ledProjectIds: new Set(projects) });

describe("time entries", () => {
  it("follow the report: the person, their team leads, their managers", () => {
    for (const reader of [timeReader("huy"), timeReader("long", ["team-video"]), timeReader("tam"), timeReader("chi")]) {
      expect(canViewTimeEntry(reader, huy, { projectId: null }), reader.personId!).toBe(true);
      expect(canViewTimesheet(reader, huy)).toBe(true);
    }
  });

  it("a project's lead sees the rows on their project, and nothing else of the week", () => {
    const vy = timeReader("vy", [], ["project-tvc"]);
    expect(canViewTimeEntry(vy, huy, { projectId: "project-tvc" })).toBe(true);
    expect(canViewTimeEntry(vy, huy, { projectId: "project-other" })).toBe(false);
    expect(canViewTimeEntry(vy, huy, { projectId: null })).toBe(false);
    expect(canViewTimesheet(vy, huy)).toBe(false);
    expect(canApproveTimesheet(vy, huy)).toBe(false);
  });

  it("a colleague and another team's lead see none", () => {
    expect(canViewTimeEntry(timeReader("bao"), huy, { projectId: "project-tvc" })).toBe(false);
    expect(canViewTimeEntry(timeReader("khoi", ["team-social"]), huy, { projectId: null })).toBe(false);
    expect(canViewTimeEntry({ personId: null, ledTeamIds: new Set(), ledProjectIds: new Set(["project-tvc"]) }, huy, { projectId: "project-tvc" })).toBe(false);
  });
});

describe("who approves a week", () => {
  it("a lead of any of the person's teams, or the line manager directly above", () => {
    expect(canApproveTimesheet(reader("long", ["team-video"]), huy)).toBe(true);
    expect(canApproveTimesheet(reader("mai", ["team-design"]), huy)).toBe(true);
    expect(canApproveTimesheet(reader("tam"), huy)).toBe(true);
  });

  it("not the manager's manager, a colleague or another team's lead", () => {
    expect(canApproveTimesheet(reader("chi"), huy)).toBe(false);
    expect(canApproveTimesheet(reader("bao"), huy)).toBe(false);
    expect(canApproveTimesheet(reader("khoi", ["team-social"]), huy)).toBe(false);
  });

  it("never the person themself — not even a lead approving their own week", () => {
    const long: ReportSubject = { personId: "long", teamIds: ["team-video"], chainAbove: ["tam"] };
    expect(canApproveTimesheet(reader("long", ["team-video"]), long)).toBe(false);
    expect(canApproveTimesheet(reader("tam"), long)).toBe(true);
    expect(canApproveTimesheet({ personId: null, ledTeamIds: new Set(["team-video"]) }, huy)).toBe(false);
  });
});

describe("utilisation", () => {
  it("is for the people above: leads and the reporting line, not the person or a colleague", () => {
    expect(canViewUtilisation(reader("long", ["team-video"]), huy)).toBe(true);
    expect(canViewUtilisation(reader("chi"), huy)).toBe(true);
    expect(canViewUtilisation(reader("huy"), huy)).toBe(false);
    expect(canViewUtilisation(reader("bao"), huy)).toBe(false);
  });
});
