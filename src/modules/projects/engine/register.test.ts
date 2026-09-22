import { describe, expect, it } from "vitest";
import { lineStatus, registerProgress, unitsConsumed, unitStatus } from "./register";

describe("deliverables register (FR-PJM-05)", () => {
  it("places one unit by its task and, when present, its review, client, delivery and publish data", () => {
    expect(unitStatus({ category: "backlog" })).toBe("promised");
    expect(unitStatus({ category: "todo" })).toBe("promised");
    expect(unitStatus({ category: "in_progress" })).toBe("in_production");
    expect(unitStatus({ category: "in_review" })).toBe("client_review");
    expect(unitStatus({ category: "done" })).toBe("accepted");
    expect(unitStatus({ category: "cancelled" })).toBeNull();
    // Review data that exists today.
    expect(unitStatus({ category: "in_progress", review: "approved" })).toBe("client_review");
    expect(unitStatus({ category: "in_review", review: "changes_requested" })).toBe("in_production");
    expect(unitStatus({ category: "todo", review: "pending" })).toBe("in_production");
    // Later releases' records.
    expect(unitStatus({ category: "in_review", clientDecision: "approved" })).toBe("accepted");
    expect(unitStatus({ category: "in_review", clientDecision: "approved_with_changes" })).toBe("accepted");
    expect(unitStatus({ category: "in_review", clientDecision: "changes_required" })).toBe("in_production");
    expect(unitStatus({ category: "done", delivered: true })).toBe("delivered");
    expect(unitStatus({ category: "done", delivered: true, published: true })).toBe("published");
    expect(unitStatus({ category: "cancelled", published: true })).toBeNull();
  });

  it("puts a line at its least advanced unit; unlinked units stay promised", () => {
    const twelvePosts = (units: Parameters<typeof lineStatus>[0]["units"]) => lineStatus({ quantity: 12, cancelled: false, units });
    expect(twelvePosts([])).toMatchObject({ status: "promised", promised: 12, accepted: 0, linked: 0 });
    // Something started: in production, even though ten units have no task yet.
    expect(twelvePosts([{ category: "done" }, { category: "in_progress" }])).toMatchObject({ status: "in_production", accepted: 1, linked: 2 });
    const allDone = Array.from({ length: 12 }, () => ({ category: "done" as const }));
    expect(twelvePosts(allDone)).toMatchObject({ status: "accepted", accepted: 12 });
    expect(twelvePosts([...allDone.slice(1), { category: "in_review" }])).toMatchObject({ status: "client_review", accepted: 11 });
    // Delivered and published units together: the line is delivered.
    expect(lineStatus({ quantity: 2, cancelled: false, units: [{ category: "done", delivered: true }, { category: "done", published: true }] }).status).toBe("delivered");
  });

  it("fills the promise with the most advanced units; cancelled tasks and lines count for nothing", () => {
    const line = lineStatus({ quantity: 1, cancelled: false, units: [{ category: "todo" }, { category: "done" }, { category: "cancelled" }] });
    expect(line).toMatchObject({ status: "accepted", promised: 1, accepted: 1, linked: 2 });
    expect(line.counts).toEqual({ promised: 0, in_production: 0, client_review: 0, accepted: 1, delivered: 0, published: 0 });
    expect(lineStatus({ quantity: 3, cancelled: true, units: [{ category: "done" }] })).toMatchObject({ status: "cancelled", promised: 0, accepted: 0 });
  });

  it("measures progress as accepted ÷ promised", () => {
    expect(registerProgress([{ promised: 12, accepted: 6 }, { promised: 4, accepted: 4 }, { promised: 0, accepted: 0 }])).toEqual({ promised: 16, accepted: 10, percent: 62 });
    expect(registerProgress([])).toEqual({ promised: 0, accepted: 0, percent: null });
  });

  it("counts consumed units without the quantity's cap (FR-PJM-06)", () => {
    const done = { category: "done" as const };
    expect(unitsConsumed([done, done, { category: "in_progress" }, { category: "cancelled" }, { category: "in_review", clientDecision: "approved" }])).toBe(3);
    expect(unitsConsumed(Array.from({ length: 15 }, () => done))).toBe(15);
    expect(unitsConsumed([])).toBe(0);
  });
});
