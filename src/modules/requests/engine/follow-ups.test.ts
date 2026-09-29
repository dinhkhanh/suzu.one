import { describe, expect, it } from "vitest";
import { REQUEST_TYPE_SEED } from "../seed-types";
import { carryOver, type FollowUpRule, followUpGate, followUpProblems } from "./follow-ups";
import type { FormDefinition, FormField } from "./form";

const field = (partial: Partial<FormField> & Pick<FormField, "key" | "type">): FormField => ({ labelVi: "Nhãn", labelEn: "Label", ...partial });
const form = (...fields: FormField[]): FormDefinition => ({ fields });

const trip = form(field({ key: "destination", type: "text" }), field({ key: "end_date", type: "date" }), field({ key: "amount", type: "money" }), field({ key: "purpose", type: "textarea" }));
const catalogue = [
  { code: "business_trip", followUps: [] },
  { code: "advance", followUps: [] },
  { code: "payment", followUps: [] },
];
const rule = (partial: Partial<FollowUpRule> = {}): FollowUpRule => ({ code: "advance", opensWhen: "approved", notBeforeField: null, max: null, ...partial });

describe("followUpProblems — what a designer may save", () => {
  it("accepts no rules, and rules naming other types", () => {
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [] }, catalogue)).toEqual([]);
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule(), rule({ code: "payment", notBeforeField: "end_date", max: 1 })] }, catalogue)).toEqual([]);
  });

  it("refuses an unknown type, the type itself, and the same type twice", () => {
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ code: "nope" })] }, catalogue)).toContain("follow_up_unknown_type");
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ code: "business_trip" })] }, catalogue)).toContain("follow_up_self");
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule(), rule()] }, catalogue)).toContain("follow_up_duplicate");
  });

  it("refuses a type that would end up under itself", () => {
    const looped = [...catalogue.filter((row) => row.code !== "advance"), { code: "advance", followUps: [rule({ code: "business_trip" })] }];
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule()] }, looped)).toContain("follow_up_cycle");
    // Deeper: trip → advance → payment → trip.
    const deep = [
      { code: "business_trip", followUps: [] },
      { code: "advance", followUps: [rule({ code: "payment" })] },
      { code: "payment", followUps: [rule({ code: "business_trip" })] },
    ];
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule()] }, deep)).toContain("follow_up_cycle");
    // A diamond is not a cycle: two parents may share a child.
    const diamond = [...catalogue, { code: "purchase", followUps: [rule({ code: "payment" })] }];
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ code: "payment" }), rule({ code: "purchase" })] }, diamond)).toEqual([]);
  });

  it("wants the opening day to be a date on the parent's own form, and a sensible limit", () => {
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ notBeforeField: "destination" })] }, catalogue)).toContain("follow_up_bad_date_field");
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ notBeforeField: "missing" })] }, catalogue)).toContain("follow_up_bad_date_field");
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ max: 0 })] }, catalogue)).toContain("follow_up_bad_max");
    expect(followUpProblems({ code: "business_trip", form: trip, followUps: [rule({ max: 1.5 })] }, catalogue)).toContain("follow_up_bad_max");
  });

  it("accepts the rules the seed ships", () => {
    const seeds = REQUEST_TYPE_SEED.map((seed) => ({ code: seed.code, followUps: seed.followUps ?? [] }));
    for (const seed of REQUEST_TYPE_SEED) expect(followUpProblems({ code: seed.code, form: seed.form, followUps: seed.followUps ?? [] }, seeds)).toEqual([]);
    expect(REQUEST_TYPE_SEED.find((seed) => seed.code === "business_trip")?.followUps?.map((entry) => entry.code)).toEqual(["advance", "payment"]);
  });
});

describe("followUpGate — may one more be filed today", () => {
  const values = { destination: "Đà Nẵng", end_date: "2026-10-14", amount: 6_000_000 };

  it("opens an approved-only rule once the parent is approved", () => {
    expect(followUpGate(rule(), { status: "pending", values }, 0, "2026-10-01")).toEqual({ open: false, reason: "parent_not_approved" });
    expect(followUpGate(rule(), { status: "approved", values }, 0, "2026-10-01")).toEqual({ open: true });
  });

  it("opens a submitted rule while the parent is waiting or returned", () => {
    expect(followUpGate(rule({ opensWhen: "submitted" }), { status: "pending", values }, 0, "2026-10-01")).toEqual({ open: true });
    expect(followUpGate(rule({ opensWhen: "submitted" }), { status: "returned", values }, 0, "2026-10-01")).toEqual({ open: true });
  });

  it("never opens under a parent that was rejected, withdrawn or cancelled", () => {
    for (const status of ["rejected", "withdrawn", "cancelled"]) expect(followUpGate(rule({ opensWhen: "submitted" }), { status, values }, 0, "2026-10-01")).toEqual({ open: false, reason: "parent_closed" });
  });

  it("waits for the day the parent names — the trip's last day counts as over", () => {
    const settle = rule({ code: "payment", notBeforeField: "end_date" });
    expect(followUpGate(settle, { status: "approved", values }, 0, "2026-10-13")).toEqual({ open: false, reason: "not_yet", opensOn: "2026-10-14" });
    expect(followUpGate(settle, { status: "approved", values }, 0, "2026-10-14")).toEqual({ open: true });
    // An empty date holds nothing back.
    expect(followUpGate(settle, { status: "approved", values: { ...values, end_date: null } }, 0, "2026-10-01")).toEqual({ open: true });
  });

  it("stops at the limit, counting only the children still alive", () => {
    const once = rule({ code: "payment", max: 1 });
    expect(followUpGate(once, { status: "approved", values }, 0, "2026-10-20")).toEqual({ open: true });
    expect(followUpGate(once, { status: "approved", values }, 1, "2026-10-20")).toEqual({ open: false, reason: "limit_reached", max: 1 });
    expect(followUpGate(rule(), { status: "approved", values }, 12, "2026-10-20")).toEqual({ open: true });
  });
});

describe("carryOver — what the child starts from", () => {
  const advance = form(field({ key: "amount", type: "money" }), field({ key: "purpose", type: "textarea" }), field({ key: "settle_by", type: "date" }), field({ key: "destination", type: "select", options: [] }));

  it("copies the fields both forms share by key and type, and nothing else", () => {
    const parentValues = { destination: "Đà Nẵng", end_date: "2026-10-14", amount: 6_000_000, purpose: "Quay TVC cho khách hàng" };
    expect(carryOver(trip, parentValues, advance)).toEqual({ amount: 6_000_000, purpose: "Quay TVC cho khách hàng" });
  });

  it("skips empty answers and never carries an attachment", () => {
    const withFile = form(field({ key: "quote", type: "file" }), field({ key: "purpose", type: "textarea" }));
    expect(carryOver(withFile, { quote: ["f1"], purpose: "" }, withFile)).toEqual({});
  });
});
