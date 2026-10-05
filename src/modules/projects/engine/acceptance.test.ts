import { describe, expect, it } from "vitest";
import { acceptanceBody, acceptanceHasScope, acceptanceItems, acceptanceItemsText, acceptanceNext, acceptanceNumber, acceptanceRefreshable, acceptanceTotals, billingDecidable, linesInScope, milestoneBillingState, projectFeeLeft, type ScopedLine, signedCorrectable } from "./acceptance";

const counts = (values: Partial<ScopedLine["counts"]>): ScopedLine["counts"] => ({ promised: 0, in_production: 0, ready_for_client: 0, client_review: 0, accepted: 0, delivered: 0, published: 0, ...values });
const lines: ScopedLine[] = [
  { id: "a", title: "TVC 30s", milestoneId: "m1", retainerPeriodId: null, cancelled: false, promised: 1, counts: counts({ delivered: 1 }), accepted: 1 },
  { id: "b", title: "Bản cắt 15s", milestoneId: "m1", retainerPeriodId: null, cancelled: false, promised: 3, counts: counts({ accepted: 1, published: 1, client_review: 1 }), accepted: 2 },
  { id: "c", title: "Bản cắt 6s", milestoneId: "m1", retainerPeriodId: null, cancelled: true, promised: 0, counts: counts({}), accepted: 0 },
  { id: "d", title: "Poster", milestoneId: "m2", retainerPeriodId: null, cancelled: false, promised: 2, counts: counts({ promised: 2 }), accepted: 0 },
  { id: "e", title: "Bài đăng tháng 10", milestoneId: null, retainerPeriodId: "p10", cancelled: false, promised: 12, counts: counts({ published: 12 }), accepted: 12 },
];

describe("acceptance snapshot (FR-PJM-55)", () => {
  it("takes the lines of a milestone, a retainer month or the project, never a cancelled one", () => {
    expect(linesInScope(lines, "milestone", { milestoneId: "m1" }).map((line) => line.id)).toEqual(["a", "b"]);
    expect(linesInScope(lines, "milestone", { milestoneId: null })).toEqual([]);
    expect(linesInScope(lines, "retainer_period", { retainerPeriodId: "p10" }).map((line) => line.id)).toEqual(["e"]);
    expect(linesInScope(lines, "project", {}).map((line) => line.id)).toEqual(["a", "b", "d"]);
  });

  it("lists promised, delivered and accepted with the links", () => {
    const items = acceptanceItems(linesInScope(lines, "milestone", { milestoneId: "m1" }), new Map([["b", ["https://facebook.com/p/1"]]]));
    expect(items).toEqual([
      { deliverableId: "a", title: "TVC 30s", promised: 1, delivered: 1, accepted: 1, links: [] },
      { deliverableId: "b", title: "Bản cắt 15s", promised: 3, delivered: 1, accepted: 2, links: ["https://facebook.com/p/1"] },
    ]);
    expect(acceptanceTotals(items)).toEqual({ promised: 4, delivered: 2, accepted: 3, complete: false });
    expect(acceptanceTotals([items[0]]).complete).toBe(true);
    expect(acceptanceTotals([]).complete).toBe(false);
    expect(acceptanceItemsText(items, { promised: "Cam kết", delivered: "Đã giao", accepted: "Đã duyệt" })).toBe("1. TVC 30s — Cam kết: 1; Đã giao: 1; Đã duyệt: 1\n2. Bản cắt 15s — Cam kết: 3; Đã giao: 1; Đã duyệt: 2\n   https://facebook.com/p/1");
  });

  it("goes draft → sent → signed, and void only before signing", () => {
    expect(acceptanceNext("draft", "send")).toBe("sent");
    expect(acceptanceNext("sent", "send")).toBeNull();
    expect(acceptanceNext("draft", "sign")).toBe("signed");
    expect(acceptanceNext("sent", "sign")).toBe("signed");
    expect(acceptanceNext("signed", "sign")).toBeNull();
    expect(acceptanceNext("sent", "void")).toBe("void");
    expect(acceptanceNext("signed", "void")).toBeNull();
    expect(acceptanceNext("void", "send")).toBeNull();
    expect(acceptanceNumber("SZM-26-042", 3)).toBe("SZM-26-042/NT-03");
  });
});

describe("billing hand-off amounts (FR-PJM-56)", () => {
  it("bills the project fee less what milestones and months billed, waived items aside", () => {
    expect(projectFeeLeft(100_000_000, [{ amountVnd: 30_000_000, status: "invoiced" }, { amountVnd: 20_000_000, status: "ready" }, { amountVnd: 40_000_000, status: "waived" }])).toBe(50_000_000);
    expect(projectFeeLeft(10_000_000, [{ amountVnd: 30_000_000, status: "invoiced" }])).toBe(0);
    expect(projectFeeLeft(null, [])).toBeNull();
    expect(billingDecidable("ready")).toBe(true);
    expect(billingDecidable("invoiced")).toBe(false);
  });
});

describe("acceptance without register lines, and corrections (PJM-08)", () => {
  const words = { promised: "Cam kết", delivered: "Đã giao", accepted: "Đã duyệt", totals: (totals: { promised: number; accepted: number }) => `${totals.accepted}/${totals.promised}`, described: "Theo mô tả" };
  const item = { deliverableId: "a", title: "TVC 30s", promised: 1, delivered: 1, accepted: 1, links: [] };

  it("needs something to accept: register lines, or the lead's words", () => {
    expect(acceptanceHasScope([], null)).toBe(false);
    expect(acceptanceHasScope([], "   ")).toBe(false);
    expect(acceptanceHasScope([], "Khách xác nhận kịch bản")).toBe(true);
    expect(acceptanceHasScope([item], null)).toBe(true);
  });

  it("prints the items, then the words; a record of words alone says it is as described", () => {
    expect(acceptanceBody([], "Khách xác nhận kịch bản", words)).toEqual({ items: "Khách xác nhận kịch bản", totals: "Theo mô tả" });
    expect(acceptanceBody([item], null, words)).toEqual({ items: "1. TVC 30s — Cam kết: 1; Đã giao: 1; Đã duyệt: 1", totals: "1/1" });
    expect(acceptanceBody([item], " Kèm bản cắt 15s ", words)).toEqual({ items: "1. TVC 30s — Cam kết: 1; Đã giao: 1; Đã duyệt: 1\n\nKèm bản cắt 15s", totals: "1/1" });
  });

  it("refreshes a draft and a sent paper, never a signed or void one", () => {
    expect((["draft", "sent", "signed", "void"] as const).map(acceptanceRefreshable)).toEqual([true, true, false, false]);
  });

  it("lets a signed record be corrected until what it earned is invoiced", () => {
    expect(signedCorrectable("signed", [])).toBe(true);
    expect(signedCorrectable("signed", ["ready"])).toBe(true);
    expect(signedCorrectable("signed", ["waived"])).toBe(true);
    expect(signedCorrectable("signed", ["ready", "invoiced"])).toBe(false);
    expect(signedCorrectable("sent", [])).toBe(false);
    expect(signedCorrectable("draft", [])).toBe(false);
    expect(signedCorrectable("void", [])).toBe(false);
  });

  it("says where a billing milestone stands with finance, in the order it is decided", () => {
    const facts = { item: null, clientWork: true, accepted: false, wholeProjectBilled: false, done: false };
    // Its own item speaks for itself, whatever else is true.
    expect(milestoneBillingState({ ...facts, item: { status: "ready" } })).toBe("ready");
    expect(milestoneBillingState({ ...facts, item: { status: "invoiced" } })).toBe("invoiced");
    expect(milestoneBillingState({ ...facts, item: { status: "waived" } })).toBe("waived");
    // A client's milestone waits for the signature — done or not (D27).
    expect(milestoneBillingState(facts)).toBe("awaiting_acceptance");
    expect(milestoneBillingState({ ...facts, done: true })).toBe("awaiting_acceptance");
    // Covered by the whole-project acceptance, which billed the remainder of the fee.
    expect(milestoneBillingState({ ...facts, accepted: true, wholeProjectBilled: true })).toBe("covered_by_project");
    // Internal work bills on "done".
    expect(milestoneBillingState({ ...facts, clientWork: false })).toBe("awaiting_done");
    expect(milestoneBillingState({ ...facts, clientWork: false, wholeProjectBilled: true })).toBe("covered_by_project");
  });
});
