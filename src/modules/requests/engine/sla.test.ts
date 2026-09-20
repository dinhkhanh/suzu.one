import { describe, expect, it } from "vitest";
import { daysWaiting, slaActionFor, type SlaPolicy } from "./sla";

const now = new Date("2026-09-20T09:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
const policy = (partial: Partial<SlaPolicy> = {}): SlaPolicy => ({ remindAfterDays: 2, escalateAfterDays: 5, hasEscalationTarget: true, ...partial });

describe("slaActionFor", () => {
  it("leaves a fresh turn alone", () => {
    expect(slaActionFor(policy(), { waitingSince: daysAgo(1), remindedAt: null, escalatedAt: null }, now)).toBe("none");
  });

  it("nudges once the reminder day has come, and only once", () => {
    const turn = { waitingSince: daysAgo(2), remindedAt: null, escalatedAt: null };
    expect(slaActionFor(policy(), turn, now)).toBe("remind");
    expect(slaActionFor(policy(), { ...turn, remindedAt: daysAgo(0) }, now)).toBe("none");
  });

  it("escalates once the escalation day has come, and only once", () => {
    const turn = { waitingSince: daysAgo(6), remindedAt: daysAgo(4), escalatedAt: null };
    expect(slaActionFor(policy(), turn, now)).toBe("escalate");
    expect(slaActionFor(policy(), { ...turn, escalatedAt: daysAgo(0) }, now)).toBe("none");
  });

  it("escalates a request that is already that late even though nobody was ever nudged", () => {
    expect(slaActionFor(policy({ remindAfterDays: 0 }), { waitingSince: daysAgo(9), remindedAt: null, escalatedAt: null }, now)).toBe("escalate");
  });

  it("does nothing when the type asks for nothing, or has nobody to escalate to", () => {
    expect(slaActionFor(policy({ remindAfterDays: 0, escalateAfterDays: 0 }), { waitingSince: daysAgo(30), remindedAt: null, escalatedAt: null }, now)).toBe("none");
    expect(slaActionFor(policy({ hasEscalationTarget: false }), { waitingSince: daysAgo(30), remindedAt: daysAgo(28), escalatedAt: null }, now)).toBe("none");
  });

  it("counts the wait in whole and part days", () => {
    expect(daysWaiting({ waitingSince: daysAgo(3) }, now)).toBeCloseTo(3);
    expect(daysWaiting({ waitingSince: new Date(now.getTime() - 12 * 60 * 60 * 1000) }, now)).toBeCloseTo(0.5);
  });
});
