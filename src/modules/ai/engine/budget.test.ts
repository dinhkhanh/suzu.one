// The money ceilings' arithmetic (SRS D35): prices, bands, windows and the verdict. Golden values.
import { describe, expect, it } from "vitest";
import type { Principal } from "@/modules/platform/rbac/policy";
import { bandOf, budgetVerdict, crossedMonthWarning, vietnamDayStart, vietnamMonthStart } from "./budget";
import { costMicroUsd, microUsdOf, modelUsageOf, priceOf } from "./pricing";

const person = (roles: Principal["grants"][number]["role"][]): Principal => ({ personId: "p", workforceType: "employee", grants: roles.map((role) => ({ role, scope: { type: "group" } })) });

describe("what a call cost", () => {
  it("prices each kind of token at its own rate, in micro-dollars", () => {
    // Haiku 4.5: $1 in, $5 out, $0.10 cache read, $1.25 cache write — per million.
    expect(costMicroUsd("claude-haiku-4-5", { inputTokens: 3000, outputTokens: 500, cacheReadTokens: 8000, cacheWriteTokens: 0 })).toBe(3000 + 2500 + 800);
    // Sonnet 5.5: $2 / $10; Opus 5.5: $4 / $20.
    expect(costMicroUsd("claude-sonnet-5-5", { inputTokens: 3000, outputTokens: 500, cacheReadTokens: 0, cacheWriteTokens: 1000 })).toBe(6000 + 5000 + 2500);
    expect(costMicroUsd("claude-opus-5-5", { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(24_000);
  });

  it("rounds up, so a month of calls never sums to less than it cost", () => {
    expect(costMicroUsd("claude-haiku-4-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1, cacheWriteTokens: 0 })).toBe(1);
  });

  it("reads a dated snapshot as its alias, and an unknown model at the dearest price", () => {
    expect(priceOf("claude-haiku-4-5-20251001")).toEqual(priceOf("claude-haiku-4-5"));
    expect(priceOf("claude-something-new").output).toBeGreaterThanOrEqual(priceOf("claude-opus-5-5").output);
  });

  it("keeps the provider's usage as non-negative integers, each kind apart", () => {
    expect(modelUsageOf({ input_tokens: 10, output_tokens: 2.4, cache_read_input_tokens: -1, cache_creation_input_tokens: "x" })).toEqual({ inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 });
    expect(modelUsageOf(null)).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});

describe("who costs how much a day (D35)", () => {
  it("puts HR, payroll, finance, directors, C-level and the owner in the office band", () => {
    for (const role of ["owner", "c_level", "entity_director", "hr_admin", "hr_staff", "payroll", "finance"] as const) expect(bandOf(person([role]), false), role).toBe("office");
  });

  it("puts whoever leads work in the lead band — by role or by leading a team or a project", () => {
    expect(bandOf(person(["department_head"]), false)).toBe("lead");
    expect(bandOf(person([]), true)).toBe("lead");
  });

  it("puts everybody else, and roles that read no company figures, in the everyone band", () => {
    expect(bandOf(person([]), false)).toBe("everyone");
    expect(bandOf(person(["recruiter", "sales", "marketing"]), false)).toBe("everyone");
  });
});

describe("the verdict before a call", () => {
  const budget = { monthMicroUsd: microUsdOf(150), dayMicroUsd: { everyone: microUsdOf(0.3), lead: microUsdOf(0.75), office: microUsdOf(1.5) } };

  it("lets a call through while both ceilings have room", () => {
    expect(budgetVerdict({ monthMicroUsd: microUsdOf(149.99), dayMicroUsd: microUsdOf(0.29) }, "everyone", budget)).toEqual({ ok: true });
  });

  it("refuses at the person's allowance for their band", () => {
    expect(budgetVerdict({ monthMicroUsd: 0, dayMicroUsd: microUsdOf(0.3) }, "everyone", budget)).toEqual({ ok: false, reason: "day" });
    expect(budgetVerdict({ monthMicroUsd: 0, dayMicroUsd: microUsdOf(0.3) }, "lead", budget)).toEqual({ ok: true });
    expect(budgetVerdict({ monthMicroUsd: 0, dayMicroUsd: microUsdOf(1.5) }, "office", budget)).toEqual({ ok: false, reason: "day" });
  });

  it("names the month first when both are spent", () => {
    expect(budgetVerdict({ monthMicroUsd: microUsdOf(150), dayMicroUsd: microUsdOf(5) }, "everyone", budget)).toEqual({ ok: false, reason: "month" });
  });

  it("refuses everything when a budget is set to zero", () => {
    expect(budgetVerdict({ monthMicroUsd: 0, dayMicroUsd: 0 }, "office", { ...budget, monthMicroUsd: 0 })).toEqual({ ok: false, reason: "month" });
  });

  it("warns once: on the call that carries the month across 80 %", () => {
    const cap = microUsdOf(150);
    expect(crossedMonthWarning(microUsdOf(119.99), microUsdOf(120.01), cap)).toBe(true);
    expect(crossedMonthWarning(microUsdOf(120.01), microUsdOf(121), cap)).toBe(false);
    expect(crossedMonthWarning(microUsdOf(100), microUsdOf(110), cap)).toBe(false);
    expect(crossedMonthWarning(0, 10, 0)).toBe(false);
  });
});

describe("the windows, in Vietnamese time", () => {
  it("starts the day at midnight in Vietnam, which is 17:00 UTC the day before", () => {
    expect(vietnamDayStart(new Date("2026-10-07T16:59:59Z")).toISOString()).toBe("2026-10-06T17:00:00.000Z");
    expect(vietnamDayStart(new Date("2026-10-07T17:00:00Z")).toISOString()).toBe("2026-10-07T17:00:00.000Z");
  });

  it("starts the month on the 1st in Vietnam — 31 October 17:30 UTC is already November", () => {
    expect(vietnamMonthStart(new Date("2026-10-31T17:30:00Z")).toISOString()).toBe("2026-10-31T17:00:00.000Z");
    expect(vietnamMonthStart(new Date("2026-10-15T03:00:00Z")).toISOString()).toBe("2026-09-30T17:00:00.000Z");
  });
});
