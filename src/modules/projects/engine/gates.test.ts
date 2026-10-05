import { describe, expect, it } from "vitest";
import { type GateFacts, lineScopeChanged, monthlyQuotaChanged, offeredStatuses, restoredStatus, scopeLocked, statusRefusal } from "./gates";

const CATEGORIES = ["planned", "active", "paused", "done", "archived"] as const;
const facts = (kind: string, options: { briefApproved?: boolean; closed?: boolean } = {}): GateFacts => ({ kind, briefApproved: !!options.briefApproved, closed: !!options.closed });
/** Every move by hand from `from`, as "to: refusal". */
const moves = (gate: GateFacts, from: string) => Object.fromEntries(CATEGORIES.filter((to) => to !== from).map((to) => [to, statusRefusal(gate, { from, to })]));

describe("the gates on a project's status (FR-PJM-03, 59)", () => {
  it("lets client work become Active only with an approved brief, and never Done by hand", () => {
    for (const kind of ["client", "retainer"]) {
      // Before the kick-off: planned and paused are the header's; active and done are the gates'.
      expect(moves(facts(kind), "planned")).toEqual({ active: "project_needs_kickoff", paused: null, done: "project_needs_closeout", archived: null });
      // Pausing first is not a way round the gate.
      expect(moves(facts(kind), "paused")).toEqual({ planned: null, active: "project_needs_kickoff", done: "project_needs_closeout", archived: null });
      // A project made active before this rule may still be paused, planned again or archived.
      expect(moves(facts(kind), "active")).toEqual({ planned: null, paused: null, done: "project_needs_closeout", archived: null });
      // After the kick-off the header pauses and resumes; Done is still the close-out's.
      expect(moves(facts(kind, { briefApproved: true }), "paused")).toEqual({ planned: null, active: null, done: "project_needs_closeout", archived: null });
      expect(moves(facts(kind, { briefApproved: true }), "active")).toEqual({ planned: null, paused: null, done: "project_needs_closeout", archived: null });
      // A project set Done by hand before this rule and never closed: out of Done the brief's gate still stands.
      expect(moves(facts(kind), "done")).toEqual({ planned: null, active: "project_needs_kickoff", paused: null, archived: null });
      expect(moves(facts(kind), "archived")).toEqual({ planned: null, active: "project_needs_kickoff", paused: null, done: "project_needs_closeout" });
    }
  });

  it("leaves an internal project and a pitch free, with or without a brief", () => {
    for (const kind of ["internal", "pitch"]) for (const briefApproved of [false, true]) for (const from of CATEGORIES) expect(Object.values(moves(facts(kind, { briefApproved }), from)).every((refusal) => refusal === null)).toBe(true);
  });

  it("keeps a closed project of any kind closed: Done or archived, nothing else, until it is re-opened", () => {
    for (const kind of ["client", "retainer", "internal", "pitch"]) {
      const closed = facts(kind, { briefApproved: true, closed: true });
      expect(moves(closed, "done")).toEqual({ planned: "project_closed_reopen", active: "project_closed_reopen", paused: "project_closed_reopen", archived: null });
      expect(moves(closed, "archived")).toEqual({ planned: "project_closed_reopen", active: "project_closed_reopen", paused: "project_closed_reopen", done: null });
      // One re-activated by hand before this rule, still locked: back to Done is open, the rest is the re-open's.
      expect(moves(closed, "active")).toEqual({ planned: "project_closed_reopen", paused: "project_closed_reopen", done: null, archived: null });
    }
  });

  it("never refuses a save that leaves the status where it is", () => {
    for (const gate of [facts("client"), facts("client", { closed: true }), facts("internal")]) for (const category of CATEGORIES) expect(statusRefusal(gate, { from: category, to: category })).toBeNull();
  });

  it("brings a project back from the archive without re-opening it or walking it past its kick-off", () => {
    expect(restoredStatus(facts("client", { briefApproved: true, closed: true }))).toBe("done");
    expect(restoredStatus(facts("internal", { closed: true }))).toBe("done");
    expect(restoredStatus(facts("client"))).toBe("planned");
    expect(restoredStatus(facts("retainer"))).toBe("planned");
    expect(restoredStatus(facts("client", { briefApproved: true }))).toBe("active");
    expect(restoredStatus(facts("internal"))).toBe("active");
    expect(restoredStatus(facts("pitch"))).toBe("active");
  });

  it("offers in the header only what would not be refused, the current status always", () => {
    expect(offeredStatuses(facts("client"), "planned", CATEGORIES)).toEqual(["planned", "paused", "archived"]);
    expect(offeredStatuses(facts("client"), "active", CATEGORIES)).toEqual(["planned", "active", "paused", "archived"]);
    expect(offeredStatuses(facts("client", { briefApproved: true }), "paused", CATEGORIES)).toEqual(["planned", "active", "paused", "archived"]);
    expect(offeredStatuses(facts("client", { briefApproved: true, closed: true }), "done", CATEGORIES)).toEqual(["done", "archived"]);
    expect(offeredStatuses(facts("internal"), "planned", CATEGORIES)).toEqual([...CATEGORIES]);
  });
});

describe("the scope lock after the kick-off (FR-PJM-11)", () => {
  it("starts when the brief is approved, not before", () => {
    expect(["draft", "submitted", "returned", "approved"].map((briefStatus) => scopeLocked({ briefStatus }))).toEqual([false, false, false, true]);
  });

  it("counts a line's quantity, format and channel as the promise — and nothing else of it", () => {
    const line = { quantity: 12, format: "post", channel: "facebook" };
    expect(lineScopeChanged(line, { ...line })).toBe(false);
    expect(lineScopeChanged(line, { ...line, quantity: 15 })).toBe(true);
    expect(lineScopeChanged(line, { ...line, format: "short_video" })).toBe(true);
    expect(lineScopeChanged(line, { ...line, channel: null })).toBe(true);
    // The wording, the due date, the milestone and the order are not part of what is compared.
    expect(lineScopeChanged({ ...line, title: "Bài đăng", dueDate: "2026-10-20" } as never, { ...line, title: "Bài Facebook", dueDate: "2026-10-25", milestoneId: "m1", sortOrder: 3 } as never)).toBe(false);
    expect(lineScopeChanged({ quantity: 1, format: null, channel: null }, { quantity: 1, format: null, channel: null })).toBe(false);
  });

  it("counts a retainer's quota lines, its hours allowance and its monthly fee as its scope", () => {
    const quota = { lines: [{ title: "Bài đăng Facebook", quantity: 12, format: "post", channel: "facebook" }, { title: "Video TikTok", quantity: 2, format: "short_video", channel: "tiktok" }], minutesPerMonth: 1200, feePerMonthVnd: 30_000_000 };
    expect(monthlyQuotaChanged(quota, { ...quota, lines: quota.lines.map((line) => ({ ...line, title: ` ${line.title} ` })) })).toBe(false);
    expect(monthlyQuotaChanged(quota, { ...quota, lines: [{ ...quota.lines[0], quantity: 16 }, quota.lines[1]] })).toBe(true);
    expect(monthlyQuotaChanged(quota, { ...quota, lines: [quota.lines[0]] })).toBe(true);
    expect(monthlyQuotaChanged(quota, { ...quota, lines: [quota.lines[1], quota.lines[0]] })).toBe(true);
    expect(monthlyQuotaChanged(quota, { ...quota, minutesPerMonth: null })).toBe(true);
    expect(monthlyQuotaChanged(quota, { ...quota, feePerMonthVnd: 35_000_000 })).toBe(true);
    // A writer who may not touch the fee sends none: that is not a change of it.
    expect(monthlyQuotaChanged(quota, { lines: quota.lines, minutesPerMonth: 1200 })).toBe(false);
  });
});
