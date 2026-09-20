import { describe, expect, it } from "vitest";
import { clashesWith, daysTouched, overlaps, schedulingProblems } from "./schedule";

const at = (iso: string) => new Date(iso);
const now = at("2026-09-20T02:00:00.000Z");
const draft = (start: string, end: string, interviewers: string[] = ["p1"]) => ({ startAt: at(start), endAt: at(end), interviewerPersonIds: interviewers });

describe("schedulingProblems", () => {
  it("accepts an ordinary hour next week", () => {
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T03:00:00Z"), now)).toEqual([]);
  });

  it("refuses an end before the start", () => {
    expect(schedulingProblems(draft("2026-09-24T03:00:00Z", "2026-09-24T02:00:00Z"), now)).toContain("interview_ends_before_it_starts");
  });

  it("refuses a zero-length slot", () => {
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T02:00:00Z"), now)).toContain("interview_ends_before_it_starts");
  });

  it("refuses five minutes and a whole working day", () => {
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T02:05:00Z"), now)).toContain("interview_too_short");
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T11:00:00Z"), now)).toContain("interview_too_long");
  });

  it("allows writing up yesterday but not last year", () => {
    expect(schedulingProblems(draft("2026-09-19T02:00:00Z", "2026-09-19T03:00:00Z"), now)).toEqual([]);
    expect(schedulingProblems(draft("2025-09-19T02:00:00Z", "2025-09-19T03:00:00Z"), now)).toContain("interview_too_far_back");
  });

  it("refuses a slot a decade out", () => {
    expect(schedulingProblems(draft("2036-09-24T02:00:00Z", "2036-09-24T03:00:00Z"), now)).toContain("interview_too_far_ahead");
  });

  it("refuses an interview with nobody in it", () => {
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T03:00:00Z", []), now)).toContain("interview_no_interviewer");
  });

  it("counts the same person twice as one person", () => {
    expect(schedulingProblems(draft("2026-09-24T02:00:00Z", "2026-09-24T03:00:00Z", ["p1", "p1"]), now)).toEqual([]);
  });
});

describe("overlaps", () => {
  const block = { startAt: at("2026-09-24T02:00:00Z"), endAt: at("2026-09-24T03:00:00Z") };

  it("is half-open: touching at the boundary is not a clash", () => {
    expect(overlaps(block, { startAt: at("2026-09-24T03:00:00Z"), endAt: at("2026-09-24T04:00:00Z") })).toBe(false);
    expect(overlaps(block, { startAt: at("2026-09-24T01:00:00Z"), endAt: at("2026-09-24T02:00:00Z") })).toBe(false);
  });

  it("catches a minute of overlap at either end", () => {
    expect(overlaps(block, { startAt: at("2026-09-24T02:59:00Z"), endAt: at("2026-09-24T04:00:00Z") })).toBe(true);
    expect(overlaps(block, { startAt: at("2026-09-24T01:00:00Z"), endAt: at("2026-09-24T02:01:00Z") })).toBe(true);
  });

  it("catches containment either way round", () => {
    expect(overlaps(block, { startAt: at("2026-09-24T02:15:00Z"), endAt: at("2026-09-24T02:30:00Z") })).toBe(true);
    expect(overlaps(block, { startAt: at("2026-09-24T00:00:00Z"), endAt: at("2026-09-24T09:00:00Z") })).toBe(true);
  });
});

describe("clashesWith", () => {
  const busy = [
    { interviewId: "a", title: "Vòng 1", startAt: at("2026-09-24T02:00:00Z"), endAt: at("2026-09-24T03:00:00Z") },
    { interviewId: "b", title: "Vòng 2", startAt: at("2026-09-24T06:00:00Z"), endAt: at("2026-09-24T07:00:00Z") },
  ];

  it("names the interviews the slot runs into", () => {
    expect(clashesWith({ startAt: at("2026-09-24T02:30:00Z"), endAt: at("2026-09-24T03:30:00Z") }, busy).map((row) => row.interviewId)).toEqual(["a"]);
  });

  it("does not report an interview against itself when it is being moved", () => {
    // Rescheduling "a" by ten minutes must not be refused because it overlaps where "a" is now.
    expect(clashesWith({ startAt: at("2026-09-24T02:10:00Z"), endAt: at("2026-09-24T03:10:00Z") }, busy, "a")).toEqual([]);
  });

  it("finds nothing in a free afternoon", () => {
    expect(clashesWith({ startAt: at("2026-09-24T04:00:00Z"), endAt: at("2026-09-24T05:00:00Z") }, busy)).toEqual([]);
  });
});

describe("daysTouched", () => {
  it("gives the local date, not the UTC one", () => {
    // 02:00Z on the 24th is 09:00 in Hồ Chí Minh on the 24th; 18:00Z is 01:00 on the 25th.
    expect(daysTouched({ startAt: at("2026-09-24T02:00:00Z"), endAt: at("2026-09-24T03:00:00Z") }, "Asia/Ho_Chi_Minh")).toEqual(["2026-09-24"]);
    expect(daysTouched({ startAt: at("2026-09-24T18:00:00Z"), endAt: at("2026-09-24T19:00:00Z") }, "Asia/Ho_Chi_Minh")).toEqual(["2026-09-25"]);
  });

  it("returns both days when a slot straddles midnight locally", () => {
    expect(daysTouched({ startAt: at("2026-09-24T16:30:00Z"), endAt: at("2026-09-24T17:30:00Z") }, "Asia/Ho_Chi_Minh")).toEqual(["2026-09-24", "2026-09-25"]);
  });
});
