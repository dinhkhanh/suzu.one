// The CRM's pure engines against worked examples: quote totals and VAT, approval reasons and margin,
// the plan a won deal becomes, deal value and forecast, stage gates, account lifecycle, duplicates,
// contract state, renewals, payment terms, aging and reminders.
import { describe, expect, it } from "vitest";
import { companyKey, likelyDuplicateAccounts, likelyDuplicateContacts, normalizeTaxCode, phoneKey, proposeLifecycle } from "./account";
import { agingBucket, contractState, daysPastDue, invoiceStanding, monthEnd, paymentTerms, reminderDue, renewalDue, vatOf } from "./contract";
import { dealValue, effectiveProbability, forecastByMonth, isStale, unmetGates, weightedValue, winRate } from "./deal";
import { addMonths, salePlanFrom } from "./delivery";
import { approvalReasons, draftApproval, lineNet, marginEstimate, marginWasChecked, minutesByRole, monthlyNet, quoteTotals, scaleRoleMinutes } from "./quote";

describe("quote totals", () => {
  const lines = [
    { quantity: 12, unitPriceVnd: 1_500_000, discountBp: 1000, months: null },
    { quantity: 1, unitPriceVnd: 25_000_000, discountBp: 0, months: 6 },
    { quantity: 2, unitPriceVnd: 8_000_000, discountBp: 500, months: null },
  ];

  it("charges a recurring line once a month and discounts each line", () => {
    expect(lineNet(lines[0])).toBe(16_200_000);
    expect(lineNet(lines[1])).toBe(150_000_000);
    expect(monthlyNet(lines[1])).toBe(25_000_000);
    expect(lineNet(lines[2])).toBe(15_200_000);
  });

  it("puts VAT on the net total, rounded once", () => {
    const totals = quoteTotals(lines, 1000);
    expect(totals.subtotalVnd).toBe(18_000_000 + 150_000_000 + 16_000_000);
    expect(totals.discountVnd).toBe(1_800_000 + 800_000);
    expect(totals.netVnd).toBe(181_400_000);
    expect(totals.vatVnd).toBe(18_140_000);
    expect(totals.totalVnd).toBe(199_540_000);
    expect(totals.oneOffNetVnd).toBe(31_400_000);
    expect(totals.monthlyNetVnd).toBe(25_000_000);
    expect(totals.months).toBe(6);
    expect(totals.maxDiscountBp).toBe(1000);
  });

  it("rounds VAT half up to the dong", () => {
    expect(quoteTotals([{ quantity: 1, unitPriceVnd: 1_005, discountBp: 0, months: null }], 1000).vatVnd).toBe(101);
    expect(quoteTotals([{ quantity: 1, unitPriceVnd: 1_004, discountBp: 0, months: null }], 1000).vatVnd).toBe(100);
  });

  it("an empty quote is zero everywhere", () => {
    expect(quoteTotals([], 800)).toMatchObject({ subtotalVnd: 0, vatVnd: 0, totalVnd: 0, months: null, maxDiscountBp: 0 });
  });

  it("sums hours by role and scales a service's per-unit hours", () => {
    expect(scaleRoleMinutes([{ role: "Design", minutes: 90 }], 12, null)).toEqual([{ role: "Design", minutes: 1080 }]);
    expect(scaleRoleMinutes([{ role: "Account", minutes: 600 }], 1, 6)).toEqual([{ role: "Account", minutes: 3600 }]);
    expect(
      minutesByRole([
        {
          roleMinutes: [
            { role: "Design", minutes: 60 },
            { role: "Content", minutes: 30 },
          ],
        },
        {
          roleMinutes: [
            { role: "Design", minutes: 30 },
            { role: "Idle", minutes: 0 },
          ],
        },
      ]),
    ).toEqual([
      { role: "Content", minutes: 30 },
      { role: "Design", minutes: 90 },
    ]);
  });
});

describe("quote approval and margin", () => {
  const rule = { discountThresholdBp: 1000, marginFloorBp: 3000 };
  it("asks for approval above the discount threshold, not at it", () => {
    expect(approvalReasons({ maxDiscountBp: 1000 }, null, rule)).toEqual([]);
    expect(approvalReasons({ maxDiscountBp: 1001 }, null, rule)).toEqual(["discount"]);
  });
  it("asks for approval when the estimated margin is under the floor", () => {
    const margin = marginEstimate(10_000_000, [{ roleMinutes: [{ role: "Design", minutes: 60 * 40 }] }], 200_000);
    expect(margin).toEqual({ minutes: 2400, costVnd: 8_000_000, marginVnd: 2_000_000, marginBp: 2000 });
    expect(approvalReasons({ maxDiscountBp: 0 }, margin, rule)).toEqual(["margin"]);
  });
  it("shows a drafter without pjm:cost the discount rule only, whatever the margin is (CRM-03)", () => {
    const thin = marginEstimate(10_000_000, [{ roleMinutes: [{ role: "Design", minutes: 60 * 40 }] }], 200_000);
    const healthy = marginEstimate(10_000_000, [{ roleMinutes: [{ role: "Design", minutes: 60 * 10 }] }], 200_000);
    // Either side of the floor, the same answer: nothing to vary a draft against.
    expect(draftApproval({ maxDiscountBp: 0 }, thin, rule, false)).toEqual({ reasons: [], next: "send" });
    expect(draftApproval({ maxDiscountBp: 0 }, healthy, rule, false)).toEqual({ reasons: [], next: "send" });
    expect(draftApproval({ maxDiscountBp: 1500 }, thin, rule, false)).toEqual({ reasons: ["discount"], next: "submit" });
    // A reader of margins keeps the live indicator.
    expect(draftApproval({ maxDiscountBp: 0 }, thin, rule, true)).toEqual({ reasons: ["margin"], next: "submit" });
    expect(draftApproval({ maxDiscountBp: 0 }, healthy, rule, true)).toEqual({ reasons: [], next: "send" });
  });
  it("makes no margin estimate without a cost rate, and says the margin was not checked", () => {
    expect(marginWasChecked(marginEstimate(10_000_000, [], 200_000))).toBe(true);
    expect(marginWasChecked(marginEstimate(10_000_000, [], null))).toBe(false);
    // Nothing to hold the cost against: a quote of no value has no margin to test either.
    expect(marginWasChecked(marginEstimate(0, [], 200_000))).toBe(false);
    expect(marginEstimate(10_000_000, [], null)).toBeNull();
  });
});

describe("won deal → project plan", () => {
  const deal = { title: "Tết campaign", nextStep: "Kick-off 5/1", oneOffVnd: null, monthlyVnd: null, months: null, serviceLines: ["social"] };
  it("turns one-off lines into the register and recurring lines into a retainer", () => {
    const plan = salePlanFrom(
      deal,
      [
        { title: "Facebook post", quantity: 12, unitPriceVnd: 1_500_000, discountBp: 0, months: null, format: "post", channel: "facebook", roleMinutes: [{ role: "Design", minutes: 1080 }] },
        { title: "Page management", quantity: 1, unitPriceVnd: 25_000_000, discountBp: 0, months: 3, format: null, channel: "facebook", roleMinutes: [{ role: "Account", minutes: 1800 }] },
      ],
      // Whatever the caller holds about the person, only the name and the role go into a brief.
      [{ name: "Chị Lan", role: "Brand manager", contact: "lan@client.vn" } as { name: string; role: string }],
      "2026-11",
    );
    expect(plan.kind).toBe("retainer");
    expect(plan.feeVnd).toBe(18_000_000);
    expect(plan.deliverables).toEqual([{ title: "Facebook post", quantity: 12, format: "post", channel: "facebook" }]);
    expect(plan.retainer).toEqual({ startMonth: "2026-11", endMonth: "2027-01", lines: [{ title: "Page management", quantity: 1, format: null, channel: "facebook" }], feePerMonthVnd: 25_000_000, minutesPerMonth: 600 });
    expect(plan.budgetByRole).toEqual([{ role: "Design", minutes: 1080 }]);
    expect(plan.brief.objective).toBe("Tết campaign — Kick-off 5/1");
    expect(plan.brief.scopeIn).toBe("12 × Facebook post\n1 × Page management / 3");
    expect(plan.brief.clientContacts).toEqual([{ name: "Chị Lan", role: "Brand manager" }]);
  });
  it("without a quote, takes the deal's own values", () => {
    expect(salePlanFrom({ ...deal, oneOffVnd: 90_000_000 }, [], [], "2026-11")).toMatchObject({ kind: "client", feeVnd: 90_000_000, deliverables: [], retainer: null });
    expect(salePlanFrom({ ...deal, monthlyVnd: 30_000_000, months: 12 }, [], [], "2026-11").retainer).toMatchObject({ startMonth: "2026-11", endMonth: "2027-10", feePerMonthVnd: 30_000_000 });
  });
  it("counts months across a year's end", () => {
    expect(addMonths("2026-11", 2)).toBe("2027-01");
    expect(addMonths("2026-01", 11)).toBe("2026-12");
    expect(addMonths("2026-12", 0)).toBe("2026-12");
  });
});

describe("deals", () => {
  it("values a deal as one-off plus the monthly over its months", () => {
    expect(dealValue({ oneOffVnd: 10, monthlyVnd: 5, months: 12 })).toBe(70);
    expect(dealValue({ oneOffVnd: null, monthlyVnd: 5, months: null })).toBe(5);
    expect(dealValue({ oneOffVnd: null, monthlyVnd: null, months: 6 })).toBe(0);
  });
  it("uses the stage's probability unless the deal has its own; won and lost are fixed", () => {
    expect(effectiveProbability({ probability: null }, { category: "open", probability: 25 })).toBe(25);
    expect(effectiveProbability({ probability: 60 }, { category: "open", probability: 25 })).toBe(60);
    expect(effectiveProbability({ probability: 60 }, { category: "won", probability: 100 })).toBe(100);
    expect(effectiveProbability({ probability: 60 }, { category: "lost", probability: 0 })).toBe(0);
    expect(weightedValue(1_000_001, 50)).toBe(500_001);
  });
  it("forecasts by close month and keeps undated and overdue deals visible", () => {
    const months = forecastByMonth(
      [
        { oneOffVnd: 100, monthlyVnd: null, months: null, expectedCloseOn: "2026-11-15", probability: 50 },
        { oneOffVnd: 200, monthlyVnd: null, months: null, expectedCloseOn: "2026-11-30", probability: 25 },
        { oneOffVnd: 300, monthlyVnd: null, months: null, expectedCloseOn: "2026-08-01", probability: 75 },
        { oneOffVnd: 400, monthlyVnd: null, months: null, expectedCloseOn: null, probability: 10 },
      ],
      "2026-10-01",
    );
    expect(months).toEqual([
      { month: "none", count: 2, value: 700, weighted: 265 },
      { month: "2026-11", count: 2, value: 300, weighted: 100 },
    ]);
  });
  it("lists the gates a deal does not meet", () => {
    const facts = { contacts: 0, expectedCloseOn: null, value: 0, quoteAccepted: false, contractSigned: true, pitchProject: false };
    expect(unmetGates(["contacts", "close_date", "value", "quote_accepted", "contract_signed", "pitch_project"], facts)).toEqual(["contacts", "close_date", "value", "quote_accepted", "pitch_project"]);
    expect(unmetGates([], facts)).toEqual([]);
  });
  it("is stale after the configured quiet days, and computes a win rate", () => {
    expect(isStale({ lastTouchedOn: "2026-09-15" }, "2026-09-30", 14)).toBe(true);
    expect(isStale({ lastTouchedOn: "2026-09-16" }, "2026-09-30", 14)).toBe(false);
    expect(winRate(3, 1)).toBe(75);
    expect(winRate(0, 0)).toBeNull();
  });
});

describe("accounts", () => {
  const today = "2026-09-30";
  it("proposes a lifecycle from the facts", () => {
    expect(proposeLifecycle({ openProjects: 1, lastWorkOn: null, lastWonOn: null, everBought: true }, today)).toBe("active");
    expect(proposeLifecycle({ openProjects: 0, lastWorkOn: null, lastWonOn: "2026-01-10", everBought: true }, today)).toBe("active");
    expect(proposeLifecycle({ openProjects: 0, lastWorkOn: null, lastWonOn: null, everBought: false }, today)).toBe("prospect");
    expect(proposeLifecycle({ openProjects: 0, lastWorkOn: "2026-02-01", lastWonOn: "2025-01-01", everBought: true }, today)).toBe("dormant");
    expect(proposeLifecycle({ openProjects: 0, lastWorkOn: "2025-06-01", lastWonOn: "2025-01-01", everBought: true }, today)).toBe("churned");
    expect(proposeLifecycle({ openProjects: 0, lastWorkOn: "2026-08-01", lastWonOn: "2025-01-01", everBought: true }, today)).toBe("active");
  });
  it("reads tax codes of a company and of a branch", () => {
    expect(normalizeTaxCode("0312 345 678")).toBe("0312345678");
    expect(normalizeTaxCode("0312345678-001")).toBe("0312345678-001");
    expect(normalizeTaxCode("031234567")).toBeNull();
    expect(normalizeTaxCode("ABC")).toBeNull();
  });
  it("finds a likely duplicate account by tax code or distinguishing name", () => {
    expect(companyKey("Công ty TNHH Thương mại Dịch vụ Hoàng Hà")).toBe("hoang ha");
    const existing = [
      { clientId: "a", name: "Hoàng Hà", legalName: "Công ty TNHH Hoàng Hà", taxCode: "0312345678" },
      { clientId: "b", name: "Vinamilk", legalName: null, taxCode: null },
    ];
    expect(likelyDuplicateAccounts({ name: "HOANG HA JSC", taxCode: null }, existing)).toEqual([{ clientId: "a", reason: "name" }]);
    expect(likelyDuplicateAccounts({ name: "Something else", taxCode: "0312 345 678" }, existing)).toEqual([{ clientId: "a", reason: "tax_code" }]);
    expect(likelyDuplicateAccounts({ name: "Masan", taxCode: null }, existing)).toEqual([]);
  });
  it("finds a likely duplicate contact by email, phone or name", () => {
    expect(phoneKey("+84 90 123 4567")).toBe("0901234567");
    const existing = [
      { id: "1", fullName: "Nguyễn Thị Lan", email: "lan@client.vn", phone: "0901234567" },
      { id: "2", fullName: "Trần Minh", email: null, phone: null },
    ];
    expect(likelyDuplicateContacts({ fullName: "Lan N.", email: "LAN@client.vn" }, existing)).toEqual(["1"]);
    expect(likelyDuplicateContacts({ fullName: "Someone", phone: "+84 901 234 567" }, existing)).toEqual(["1"]);
    expect(likelyDuplicateContacts({ fullName: "tran minh" }, existing)).toEqual(["2"]);
    expect(likelyDuplicateContacts({ fullName: "New Person", phone: "12" }, existing)).toEqual([]);
  });
});

describe("contracts and receivables", () => {
  const today = "2026-09-30";
  it("reads a contract's state from its dates", () => {
    expect(contractState({ status: "draft", startDate: null, endDate: null }, today)).toBe("draft");
    expect(contractState({ status: "signed", startDate: "2026-10-01", endDate: null }, today)).toBe("upcoming");
    expect(contractState({ status: "signed", startDate: "2026-01-01", endDate: "2026-12-31" }, today)).toBe("active");
    expect(contractState({ status: "signed", startDate: "2025-01-01", endDate: "2026-09-29" }, today)).toBe("expired");
    expect(contractState({ status: "terminated", startDate: "2025-01-01", endDate: "2027-01-01" }, today)).toBe("terminated");
  });
  it("opens a renewal within the lead time, never after the end", () => {
    expect(renewalDue("2026-11-14", today, 45)).toBe(true);
    expect(renewalDue("2026-11-15", today, 45)).toBe(false);
    expect(renewalDue("2026-09-29", today, 45)).toBe(false);
    expect(renewalDue(null, today, 45)).toBe(false);
    expect(monthEnd("2027-02")).toBe("2027-02-28");
    expect(monthEnd("2028-02")).toBe("2028-02-29");
  });
  it("takes the contract's payment terms, else the account's, else the default", () => {
    expect(paymentTerms(15, 45, 30)).toBe(15);
    expect(paymentTerms(null, 45, 30)).toBe(45);
    expect(paymentTerms(undefined, null, 30)).toBe(30);
  });
  it("ages unpaid invoices and reminds once per threshold, the highest crossed", () => {
    expect(daysPastDue("2026-10-01", today)).toBe(0);
    expect(agingBucket("2026-09-30", today)).toBe("current");
    expect(agingBucket("2026-09-29", today)).toBe("d1_30");
    expect(agingBucket("2026-08-01", today)).toBe("d31_60");
    expect(agingBucket("2026-07-01", today)).toBe("d90_plus");
    expect(reminderDue("2026-08-21", today, [1, 15, 30, 60], [])).toBe(30);
    expect(reminderDue("2026-08-21", today, [1, 15, 30, 60], [1, 15, 30])).toBeNull();
    expect(reminderDue("2026-09-30", today, [1, 15], [])).toBeNull();
  });
  it("puts VAT on an invoice like a quote, and reads its standing from payments", () => {
    expect(vatOf(18_000_000, 800)).toBe(1_440_000);
    expect(invoiceStanding(100, 0, "open")).toBe("open");
    expect(invoiceStanding(100, 40, "open")).toBe("part_paid");
    expect(invoiceStanding(100, 100, "open")).toBe("paid");
    expect(invoiceStanding(100, 0, "written_off")).toBe("written_off");
    // A draft is not owed yet and a voided invoice is not owed at all, whatever their figures say.
    expect(invoiceStanding(100, 0, "draft")).toBe("draft");
    expect(invoiceStanding(100, 0, "void")).toBe("void");
  });
});
