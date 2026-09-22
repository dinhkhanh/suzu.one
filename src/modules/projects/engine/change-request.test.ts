import { describe, expect, it } from "vitest";
import { appliedMinutes, applyChange, changeLedger, changeProblems, hasFeeChange, withoutFee } from "./change-request";

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
    expect(withoutFee({ feeDeltaVnd: 5_000_000, minutesDelta: 60, applied: { budgetMinutesBefore: 10, feeVndBefore: 90, dueDateBefore: null } })).toEqual({ minutesDelta: 60, applied: { budgetMinutesBefore: 10, feeVndBefore: null, dueDateBefore: null } });
  });

  it("applies hours, fee and date, never below zero", () => {
    const plan = { budgetMinutes: 6000, feeVnd: 100_000_000, dueDate: "2026-11-30" };
    expect(applyChange(plan, { minutesDelta: 1200, feeDeltaVnd: 20_000_000, dueDateTo: "2026-12-15" })).toEqual({ budgetMinutes: 7200, feeVnd: 120_000_000, dueDate: "2026-12-15" });
    expect(applyChange(plan, { minutesDelta: -9000 })).toEqual({ ...plan, budgetMinutes: 0 });
    expect(applyChange({ budgetMinutes: null, feeVnd: null, dueDate: null }, { minutesDelta: 600, feeDeltaVnd: 1_000_000 })).toEqual({ budgetMinutes: 600, feeVnd: 1_000_000, dueDate: null });
    expect(applyChange(plan, { deliverables: [{ title: "x", quantity: 1, format: null, channel: null }] })).toEqual(plan);
  });

  it("reads original + changes = current", () => {
    const current = { budgetMinutes: 7800, feeVnd: 125_000_000, dueDate: "2026-12-20" };
    const ledger = changeLedger(current, [
      { number: 1, title: "Thêm 2 video", impact: { minutesDelta: 1200, feeDeltaVnd: 20_000_000, applied: { budgetMinutesBefore: 6000, feeVndBefore: 100_000_000, dueDateBefore: "2026-11-30" } } },
      { number: 2, title: "Lùi ngày", impact: { minutesDelta: 600, feeDeltaVnd: 5_000_000, dueDateTo: "2026-12-20", applied: { budgetMinutesBefore: 7200, feeVndBefore: 120_000_000, dueDateBefore: "2026-11-30" } } },
    ]);
    expect(ledger.original).toEqual({ budgetMinutes: 6000, feeVnd: 100_000_000, dueDate: "2026-11-30" });
    expect(ledger.steps.map((step) => step.after)).toEqual([{ budgetMinutes: 7200, feeVnd: 120_000_000, dueDate: "2026-11-30" }, current]);
    expect(changeLedger(current, [])).toEqual({ original: current, steps: [], current });
    expect(appliedMinutes([{ minutesDelta: 1200 }, { minutesDelta: -300 }, {}])).toBe(900);
  });
});
