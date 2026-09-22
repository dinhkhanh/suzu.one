import { describe, expect, it } from "vitest";
import { canBecomeTask, isEvidenceUrl, meetingProblems, meetingWindow, normaliseMeetingTime, normaliseRaid, raidCounts, raidProblems, sortRaid } from "./raid";

const TODAY = "2026-10-20";
const draft = { kind: "risk" as const, title: "Mưa ngày quay", severity: "high" as const, decidedOn: null, evidenceUrl: null, evidenceFileId: null };

describe("RAID items (FR-PJM-29)", () => {
  it("asks a risk or an issue how bad it is, and a decision when it was taken", () => {
    expect(raidProblems(draft, TODAY)).toEqual([]);
    expect(raidProblems({ ...draft, severity: null }, TODAY)).toEqual(["raid_severity_required"]);
    expect(raidProblems({ ...draft, kind: "issue", severity: null, title: " " }, TODAY)).toEqual(["raid_title_required", "raid_severity_required"]);
    expect(raidProblems({ ...draft, kind: "decision", severity: null }, TODAY)).toEqual(["raid_decided_on_required"]);
    expect(raidProblems({ ...draft, kind: "decision", severity: null, decidedOn: "2026-10-21" }, TODAY)).toEqual(["raid_decided_in_future"]);
    expect(raidProblems({ ...draft, kind: "decision", severity: null, decidedOn: TODAY, evidenceUrl: "https://mail.google.com/x" }, TODAY)).toEqual([]);
    expect(raidProblems({ ...draft, kind: "assumption", severity: null }, TODAY)).toEqual([]);
  });

  it("takes evidence links over https only", () => {
    expect(isEvidenceUrl("https://drive.google.com/file/d/1")).toBe(true);
    for (const value of ["http://example.com", "javascript:alert(1)", "file:///C:/x.pdf", "not a url"]) expect(isEvidenceUrl(value), value).toBe(false);
    expect(raidProblems({ ...draft, evidenceUrl: "http://example.com" }, TODAY)).toEqual(["raid_evidence_url_invalid"]);
  });

  it("clears what a kind does not use", () => {
    expect(normaliseRaid({ ...draft, kind: "decision", decidedOn: TODAY })).toMatchObject({ severity: null, decidedOn: TODAY });
    expect(normaliseRaid({ ...draft, decidedOn: TODAY })).toMatchObject({ severity: "high", decidedOn: null });
    expect(normaliseRaid({ ...draft, kind: "assumption" })).toMatchObject({ severity: null, decidedOn: null });
  });

  it("turns only an open issue without a task into a task", () => {
    expect(canBecomeTask({ kind: "issue", status: "open", taskId: null })).toBe(true);
    expect(canBecomeTask({ kind: "issue", status: "open", taskId: "t1" })).toBe(false);
    expect(canBecomeTask({ kind: "issue", status: "closed", taskId: null })).toBe(false);
    expect(canBecomeTask({ kind: "risk", status: "open", taskId: null })).toBe(false);
  });

  it("counts open high risks and every open issue", () => {
    expect(
      raidCounts([
        { kind: "risk", severity: "high", status: "open" },
        { kind: "risk", severity: "low", status: "open" },
        { kind: "risk", severity: "high", status: "closed" },
        { kind: "issue", severity: "low", status: "open" },
        { kind: "issue", severity: "medium", status: "open" },
        { kind: "decision", severity: null, status: "open" },
      ]),
    ).toEqual({ highRisks: 1, openIssues: 2 });
  });

  it("reads open before closed, high before low, soonest first", () => {
    const at = new Date("2026-10-01T00:00:00Z");
    const items = [
      { id: "closed-high", kind: "risk", severity: "high", status: "closed", dueDate: "2026-10-01", createdAt: at },
      { id: "low", kind: "risk", severity: "low", status: "open", dueDate: "2026-10-02", createdAt: at },
      { id: "high-late", kind: "issue", severity: "high", status: "open", dueDate: "2026-11-01", createdAt: at },
      { id: "high-soon", kind: "risk", severity: "high", status: "open", dueDate: "2026-10-22", createdAt: at },
      { id: "decision", kind: "decision", severity: null, status: "open", dueDate: null, createdAt: at },
    ];
    expect(sortRaid(items).map((item) => item.id)).toEqual(["high-soon", "high-late", "low", "decision", "closed-high"]);
  });
});

describe("meetings (FR-PJM-30)", () => {
  const people = new Set(["tam", "huy"]);
  const meeting = { title: "Họp tuần", heldOn: "2026-10-19", startTime: null, durationMinutes: null, attendeeIds: ["tam"], decisions: [], actionItems: [] };

  it("takes attendees and assignees from the project's people", () => {
    expect(meetingProblems(meeting, { today: TODAY, people })).toEqual([]);
    expect(meetingProblems({ ...meeting, attendeeIds: ["tam", "bao"] }, { today: TODAY, people })).toEqual(["meeting_attendee_not_member"]);
    expect(meetingProblems({ ...meeting, actionItems: [{ title: "x", assigneePersonId: "bao", dueDate: null }] }, { today: TODAY, people })).toEqual(["meeting_assignee_not_member"]);
  });

  it("may be written up before it is held, but decides nothing until then", () => {
    expect(meetingProblems({ ...meeting, heldOn: "2026-10-27" }, { today: TODAY, people })).toEqual([]);
    expect(meetingProblems({ ...meeting, heldOn: "2026-10-27", decisions: [{ title: "Chốt KV B" }] }, { today: TODAY, people })).toEqual(["meeting_decisions_before_held"]);
  });

  it("does not make an action item due before the meeting", () => {
    expect(meetingProblems({ ...meeting, actionItems: [{ title: "x", assigneePersonId: "huy", dueDate: "2026-10-18" }] }, { today: TODAY, people })).toEqual(["meeting_action_due_before"]);
    expect(meetingProblems({ ...meeting, title: "" }, { today: TODAY, people })).toEqual(["meeting_title_required"]);
  });

  it("refuses an hour that is not one, and a meeting nobody could sit through", () => {
    expect(meetingProblems({ ...meeting, startTime: "09:30", durationMinutes: 90 }, { today: TODAY, people })).toEqual([]);
    expect(meetingProblems({ ...meeting, startTime: "25:00" }, { today: TODAY, people })).toEqual(["meeting_time_invalid"]);
    expect(meetingProblems({ ...meeting, startTime: "09:30", durationMinutes: 900 }, { today: TODAY, people })).toEqual(["meeting_duration_invalid"]);
  });

  it("turns the Vietnam-local day and hour into instants — +07:00 all year, there is no daylight saving", () => {
    expect(meetingWindow({ heldOn: "2026-10-19", startTime: "09:30", durationMinutes: 90 })).toEqual({ start: new Date("2026-10-19T02:30:00Z"), end: new Date("2026-10-19T04:00:00Z") });
    // The `time` column reads back with seconds; the form posts without them. Both are the same hour.
    expect(meetingWindow({ heldOn: "2026-10-19", startTime: "09:30:00", durationMinutes: null })?.end).toEqual(new Date("2026-10-19T03:30:00Z"));
    // An evening meeting is the same day in Vietnam and the same day in UTC — a late one is not.
    expect(meetingWindow({ heldOn: "2026-10-19", startTime: "22:00", durationMinutes: 60 })).toEqual({ start: new Date("2026-10-19T15:00:00Z"), end: new Date("2026-10-19T16:00:00Z") });
    // No hour, no event: notes written up afterwards belong to nobody's calendar.
    expect(meetingWindow({ heldOn: "2026-10-19", startTime: null, durationMinutes: 60 })).toBeNull();
    expect(normaliseMeetingTime({ heldOn: "2026-10-19", startTime: null, durationMinutes: 60 }).durationMinutes).toBeNull();
  });
});
