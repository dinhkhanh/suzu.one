import { describe, expect, it } from "vitest";
import { appliedMinutes, applyChange, changeLedger, changeProblems, hasFeeChange, hasImpact, ledgerWithoutFee, withoutFee } from "./change-request";

const draft = { title: "Thêm 2 video", requestedBy: "client" as const, impact: { minutesDelta: 600 }, evidenceFileId: null, evidenceUrl: null };

describe("change requests (FR-PJM-11)", () => {
  it("needs the client's word on file when the client asked, and some impact", () => {
    expect(changeProblems(draft)).toEqual(["change_evidence_required"]);
    expect(changeProblems({ ...draft, evidenceUrl: "https://mail.example/thread" })).toEqual([]);
    expect(changeProblems({ ...draft, requestedBy: "internal" })).toEqual([]);
    expect(changeProblems({ ...draft, requestedBy: "internal", impact: {} })).toEqual(["change_empty"]);
    expect(changeProblems({ ...draft, title: " ", requestedBy: "internal", impact: { dueDateTo: "2026-12-01" } })).toEqual(["change_title_required"]);
  });

  it("asks for the commercial step only when the fee moves", () => {
    expect(hasFeeChange({ minutesDelta: 600 })).toBe(false);
    expect(hasFeeChange({ feeDeltaVnd: 5_000_000 })).toBe(true);
    expect(withoutFee({ feeDeltaVnd: 5_000_000, minutesDelta: 60, applied: { budgetMinutesBefore: 10, feeVndBefore: 90, dueDateBefore: null } })).toEqual({
      minutesDelta: 60,
      applied: { budgetMinutesBefore: 10, feeVndBefore: null, dueDateBefore: null },
    });
  });

  it("counts a retainer's monthly scope as an impact, and its monthly fee as a fee change", () => {
    const lines = [{ title: "Bài Facebook", quantity: 16, format: "post", channel: "facebook" }];
    expect(hasImpact({ retainer: { lines } })).toBe(true);
    expect(hasImpact({ retainer: { minutesPerMonth: null } })).toBe(true);
    expect(hasImpact({ retainer: {} })).toBe(false);
    expect(hasFeeChange({ retainer: { lines } })).toBe(false);
    expect(hasFeeChange({ retainer: { feePerMonthVnd: 40_000_000 } })).toBe(true);
    // A reader without `pjm:commercial` sees the quota move, never the fee — the one asked for or the one replaced.
    expect(withoutFee({ retainer: { lines, feePerMonthVnd: 40_000_000 }, applied: { budgetMinutesBefore: null, feeVndBefore: null, dueDateBefore: null, retainer: { lines: [], minutesPerMonth: 600, feePerMonthVnd: 30_000_000 } } })).toEqual(
      {
        retainer: { lines },
        applied: { budgetMinutesBefore: null, feeVndBefore: null, dueDateBefore: null, retainer: { lines: [], minutesPerMonth: 600, feePerMonthVnd: null } },
      },
    );
  });

  it("applies hours, fee and date, never below zero", () => {
    const plan = { budgetMinutes: 6000, feeVnd: 100_000_000, dueDate: "2026-11-30" };
    expect(applyChange(plan, { minutesDelta: 1200, feeDeltaVnd: 20_000_000, dueDateTo: "2026-12-15" })).toEqual({ budgetMinutes: 7200, feeVnd: 120_000_000, dueDate: "2026-12-15" });
    expect(applyChange(plan, { minutesDelta: -9000 })).toEqual({ ...plan, budgetMinutes: 0 });
    expect(applyChange({ budgetMinutes: null, feeVnd: null, dueDate: null }, { minutesDelta: 600, feeDeltaVnd: 1_000_000 })).toEqual({ budgetMinutes: 600, feeVnd: 1_000_000, dueDate: null });
    expect(applyChange(plan, { deliverables: [{ title: "x", quantity: 1, format: null, channel: null }] })).toEqual(plan);
  });

  const original = { budgetMinutes: 6000, feeVnd: 100_000_000, dueDate: "2026-11-30" };
  const afterFirst = { budgetMinutes: 7200, feeVnd: 120_000_000, dueDate: "2026-11-30" };
  const first = { number: 1, title: "Thêm 2 video", impact: { minutesDelta: 1200, feeDeltaVnd: 20_000_000 }, before: original, after: afterFirst };

  it("reads original + changes = current from each change's own before and after", () => {
    const current = { budgetMinutes: 7800, feeVnd: 125_000_000, dueDate: "2026-12-20" };
    const ledger = changeLedger(current, [first, { number: 2, title: "Lùi ngày", impact: { minutesDelta: 600, feeDeltaVnd: 5_000_000, dueDateTo: "2026-12-20" }, before: afterFirst, after: current }]);
    expect(ledger.original).toEqual(original);
    expect(ledger.steps).toEqual([
      { kind: "change", number: 1, title: "Thêm 2 video", impact: first.impact, after: afterFirst },
      { kind: "change", number: 2, title: "Lùi ngày", impact: { minutesDelta: 600, feeDeltaVnd: 5_000_000, dueDateTo: "2026-12-20" }, after: current },
    ]);
    expect(ledger.balanced).toBe(true);
    expect(changeLedger(current, [])).toEqual({ original: current, steps: [], current, balanced: true });
    expect(appliedMinutes([{ minutesDelta: 1200 }, { minutesDelta: -300 }, {}])).toBe(900);
  });

  it("reads a change applied before the figures were stored from what it found and its delta", () => {
    const current = { budgetMinutes: 7800, feeVnd: 125_000_000, dueDate: "2026-12-20" };
    const ledger = changeLedger(current, [
      { number: 1, title: "Thêm 2 video", impact: { minutesDelta: 1200, feeDeltaVnd: 20_000_000, applied: { budgetMinutesBefore: 6000, feeVndBefore: 100_000_000, dueDateBefore: "2026-11-30" } } },
      { number: 2, title: "Lùi ngày", impact: { minutesDelta: 600, feeDeltaVnd: 5_000_000, dueDateTo: "2026-12-20", applied: { budgetMinutesBefore: 7200, feeVndBefore: 120_000_000, dueDateBefore: "2026-11-30" } } },
    ]);
    expect(ledger.original).toEqual(original);
    expect(ledger.steps.map((step) => [step.kind, step.after])).toEqual([
      ["change", afterFirst],
      ["change", current],
    ]);
    expect(ledger.balanced).toBe(true);
  });

  it("shows a figure edited outside any change as a difference nobody explained, instead of absorbing it", () => {
    // Somebody raised the budget by 5 h after CR-1 and typed a new fee after CR-2: neither is a change request.
    const foundBySecond = { budgetMinutes: 7500, feeVnd: 120_000_000, dueDate: "2026-11-30" };
    const afterSecond = { budgetMinutes: 8100, feeVnd: 120_000_000, dueDate: "2026-11-30" };
    const current = { budgetMinutes: 8100, feeVnd: 150_000_000, dueDate: "2026-11-30" };
    const ledger = changeLedger(current, [first, { number: 2, title: "Thêm 10 giờ", impact: { minutesDelta: 600 }, before: foundBySecond, after: afterSecond }]);
    expect(ledger.steps).toEqual([
      { kind: "change", number: 1, title: "Thêm 2 video", impact: first.impact, after: afterFirst },
      { kind: "unexplained", delta: { minutes: 300, feeVnd: 0, dueDate: false }, after: foundBySecond },
      { kind: "change", number: 2, title: "Thêm 10 giờ", impact: { minutesDelta: 600 }, after: afterSecond },
      { kind: "unexplained", delta: { minutes: 0, feeVnd: 30_000_000, dueDate: false }, after: current },
    ]);
    expect(ledger.balanced).toBe(false);
    // The arithmetic the page shows: original + every row's own movement = current.
    const changes = ledger.steps.reduce((sum, step) => sum + (step.kind === "change" ? (step.impact.minutesDelta ?? 0) : step.delta.minutes), 0);
    expect(ledger.original.budgetMinutes! + changes).toBe(current.budgetMinutes);

    // Without the fee, the row that was only about the fee is gone and nothing else says there was one.
    const noFee = ledgerWithoutFee(ledger);
    expect(noFee.steps.map((step) => step.kind)).toEqual(["change", "unexplained", "change"]);
    expect([noFee.original.feeVnd, noFee.current.feeVnd, ...noFee.steps.map((step) => step.after.feeVnd)]).toEqual([null, null, null, null, null]);
    expect(noFee.steps.every((step) => step.kind === "unexplained" || step.impact.feeDeltaVnd === undefined)).toBe(true);
  });

  it("starts from the kick-off's figures when they are known: an edit before the first change shows, and one with no change at all", () => {
    const current = { budgetMinutes: 9000, feeVnd: 100_000_000, dueDate: "2026-12-05" };
    expect(changeLedger(current, [], original).steps).toEqual([{ kind: "unexplained", delta: { minutes: 3000, feeVnd: 0, dueDate: true }, after: current }]);
    const late = changeLedger(afterFirst, [{ ...first, before: { ...original, budgetMinutes: 6000 } }], { ...original, budgetMinutes: 5400 });
    expect(late.original.budgetMinutes).toBe(5400);
    expect(late.steps.map((step) => step.kind)).toEqual(["unexplained", "change"]);
    // A figure nobody set and a zero are the same nothing.
    expect(changeLedger({ budgetMinutes: 0, feeVnd: null, dueDate: null }, [], { budgetMinutes: null, feeVnd: 0, dueDate: null }).balanced).toBe(true);
  });
});
