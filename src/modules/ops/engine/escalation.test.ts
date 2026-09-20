import { describe, expect, it } from "vitest";
import { escalationLevel, type EscalationFacts, noticesDue, supersededLeadKeys } from "./escalation";

const facts = (over: Partial<EscalationFacts> = {}): EscalationFacts => ({ status: "todo", dueDate: "2026-10-20", reminderLeadDays: [7, 3, 1], escalation: { managerAfterDays: 3, executiveAfterDays: 7 }, sent: new Set(), ...over });
const keys = (over: Partial<EscalationFacts>, today: string) => noticesDue(facts(over), today).map((notice) => `${notice.key}>${notice.audience}:${notice.days}`);

describe("noticesDue (golden)", () => {
  it("says nothing before the first lead time, for closed items and for undated ones", () => {
    expect(keys({}, "2026-10-12")).toEqual([]);
    expect(keys({ status: "done" }, "2026-10-25")).toEqual([]);
    expect(keys({ status: "cancelled" }, "2026-10-25")).toEqual([]);
    expect(keys({ dueDate: null }, "2026-10-25")).toEqual([]);
  });

  it("reminds the owner at each lead time, once", () => {
    expect(keys({}, "2026-10-13")).toEqual(["lead:7>owner:7"]);
    expect(keys({ sent: new Set(["lead:7"]) }, "2026-10-13")).toEqual([]);
    expect(keys({ sent: new Set(["lead:7"]) }, "2026-10-16")).toEqual([]);
    expect(keys({ sent: new Set(["lead:7"]) }, "2026-10-17")).toEqual(["lead:3>owner:3"]);
    expect(keys({ sent: new Set(["lead:7", "lead:3"]) }, "2026-10-19")).toEqual(["lead:1>owner:1"]);
    expect(keys({ sent: new Set(["lead:7", "lead:3", "lead:1"]) }, "2026-10-20")).toEqual([]);
  });

  it("sends only the closest lead time when earlier ones were missed", () => {
    expect(keys({}, "2026-10-18")).toEqual(["lead:3>owner:2"]);
    expect(supersededLeadKeys(facts(), 3)).toEqual(["lead:7"]);
    expect(keys({ sent: new Set(["lead:3", "lead:7"]) }, "2026-10-18")).toEqual([]);
    // Due today with a same-day lead time.
    expect(keys({ reminderLeadDays: [0] }, "2026-10-20")).toEqual(["lead:0>owner:0"]);
  });

  it("the first day late tells the owner and the reviewer", () => {
    expect(keys({ sent: new Set(["lead:1"]) }, "2026-10-21")).toEqual(["overdue:1>owner_and_reviewer:1"]);
    expect(keys({ sent: new Set(["overdue:1"]) }, "2026-10-22")).toEqual([]);
  });

  it("escalates to the manager, then to the executives", () => {
    expect(keys({ sent: new Set(["overdue:1"]) }, "2026-10-23")).toEqual(["escalate:manager>manager:3"]);
    expect(keys({ sent: new Set(["overdue:1", "escalate:manager"]) }, "2026-10-26")).toEqual([]);
    expect(keys({ sent: new Set(["overdue:1", "escalate:manager"]) }, "2026-10-27")).toEqual(["escalate:executive>executive:7"]);
    expect(keys({ sent: new Set(["overdue:1", "escalate:manager", "escalate:executive"]) }, "2026-11-30")).toEqual([]);
  });

  it("catches up in one run when the job did not run for a week", () => {
    expect(keys({}, "2026-10-28")).toEqual(["overdue:1>owner_and_reviewer:8", "escalate:manager>manager:8", "escalate:executive>executive:8"]);
  });

  it("follows the template's own thresholds", () => {
    expect(keys({ escalation: { managerAfterDays: 1, executiveAfterDays: 2 }, sent: new Set(["overdue:1"]) }, "2026-10-21")).toEqual(["escalate:manager>manager:1"]);
  });
});

describe("escalationLevel", () => {
  it("reads the level off the sent keys", () => {
    expect(escalationLevel([])).toBe(0);
    expect(escalationLevel(["lead:7", "overdue:1"])).toBe(0);
    expect(escalationLevel(["escalate:manager"])).toBe(1);
    expect(escalationLevel(["escalate:manager", "escalate:executive"])).toBe(2);
  });
});
