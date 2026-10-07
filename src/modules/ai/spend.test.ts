// The money ceilings against a real Postgres (PGlite). The questions this file answers:
//   1. Is every call written down with its price, and summed per month and per person-day in SQL?
//   2. Does the door refuse a person whose day is spent — and only that person?
//   3. Does the door refuse everybody once the month is spent, and nobody when it rolls over?
//   4. Are the owners told once, on the call that crosses 80 % of the month?
//   5. Does the kill switch, or a missing key, refuse before anything is read?
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
const settings = vi.hoisted(() => ({
  values: {
    BETTER_AUTH_URL: "https://suzu.one",
    ANTHROPIC_API_KEY: "not-a-key" as string | undefined,
    AI_AGENT_ENABLED: "on" as "on" | "off",
    AI_MONTHLY_BUDGET_USD: 1,
    AI_DAILY_BUDGET_USD_EVERYONE: 0.3,
    AI_DAILY_BUDGET_USD_LEADS: 0.75,
    AI_DAILY_BUDGET_USD_OFFICE: 1.5,
  },
}));
vi.mock("@/lib/env", () => ({ env: () => settings.values }));
vi.mock("@/modules/platform/notifications/service", () => ({ notify: vi.fn(async () => undefined) }));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { notify } from "../platform/notifications/service";
import type { Grant } from "../platform/rbac/policy";
import { admitModelCall, monthToDateQuery, recordModelCall, spendSummary, spentSoFar, spentSoFarQuery } from "./spend";

const people = {} as Record<"huy" | "lan" | "owner", { person: { id: string; primaryEntityId: string | null }; principal: { personId: string; workforceType: "employee"; grants: Grant[] } }>;

// 10:00 on 7 October in Vietnam.
const NOW = new Date("2026-10-07T03:00:00Z");
const haiku = (outputTokens: number) => ({ inputTokens: 0, outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0 });
const spend = (personId: string, usd: number, at: Date = NOW) => recordModelCall({ personId, purpose: "ask", tier: "simple", model: "claude-haiku-4-5", usage: haiku(Math.round(usd * 200_000)), stopReason: "end_turn" }, at);

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  for (const [key, grants] of [["huy", []], ["lan", []], ["owner", [{ role: "owner", scope: { type: "group" } }]]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: entity.id }).returning();
    people[key] = { person: { id: row.id, primaryEntityId: entity.id }, principal: { personId: row.id, workforceType: "employee", grants: [...grants] as Grant[] } };
  }
  await db().insert(schema.roleAssignment).values({ personId: people.owner.person.id, role: "owner", scopeType: "group", validFrom: "2026-01-01" });
});

beforeEach(async () => {
  await db().delete(schema.aiModelCall);
  settings.values.AI_AGENT_ENABLED = "on";
  settings.values.ANTHROPIC_API_KEY = "not-a-key";
  vi.mocked(notify).mockClear();
});

describe("what was spent", () => {
  it("writes each call down at its price and sums the month and one person's day in SQL", async () => {
    // Haiku output is $5 per million: 200,000 tokens per dollar.
    expect(await spend(people.huy.person.id, 0.1)).toBe(100_000);
    await spend(people.lan.person.id, 0.05);
    // Yesterday, in Vietnam: in the month, not in today.
    await spend(people.huy.person.id, 0.2, new Date("2026-10-06T16:00:00Z"));
    // Last month: in neither.
    await spend(people.huy.person.id, 0.4, new Date("2026-09-30T16:00:00Z"));
    expect(await spentSoFar(people.huy.person.id, NOW)).toEqual({ monthMicroUsd: 350_000, dayMicroUsd: 100_000 });
    expect((await spendSummary(NOW)).byModel).toEqual([{ model: "claude-haiku-4-5", tier: "simple", calls: 3, costMicroUsd: 350_000 }]);
  });
});

describe("the door", () => {
  it("refuses a person whose day is spent, and not their colleague", async () => {
    await spend(people.huy.person.id, 0.3);
    expect(await admitModelCall(people.huy, NOW)).toEqual({ ok: false, notice: "day" });
    expect(await admitModelCall(people.lan, NOW)).toEqual({ ok: true });
  });

  it("gives the office band a larger day", async () => {
    await spend(people.owner.person.id, 0.3);
    expect(await admitModelCall(people.owner, NOW)).toEqual({ ok: true });
  });

  it("refuses everybody once the month is spent, and opens again on the 1st", async () => {
    await spend(people.lan.person.id, 1, new Date("2026-10-02T03:00:00Z"));
    expect(await admitModelCall(people.huy, NOW)).toEqual({ ok: false, notice: "month" });
    expect(await admitModelCall(people.huy, new Date("2026-10-31T17:00:00Z"))).toEqual({ ok: true });
  });

  it("refuses before reading anything when switched off or without a key", async () => {
    settings.values.AI_AGENT_ENABLED = "off";
    expect(await admitModelCall(people.huy, NOW)).toEqual({ ok: false, notice: "off" });
    settings.values.AI_AGENT_ENABLED = "on";
    settings.values.ANTHROPIC_API_KEY = undefined;
    expect(await admitModelCall(people.huy, NOW)).toEqual({ ok: false, notice: "no_key" });
  });
});

describe("the owners' warning", () => {
  it("tells the owners once, on the call that crosses 80 % of the month", async () => {
    await spend(people.huy.person.id, 0.5);
    expect(notify).not.toHaveBeenCalled();
    await spend(people.lan.person.id, 0.31);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify).mock.calls[0][0]).toMatchObject({ recipients: [people.owner.person.id], kind: "system.ai_budget_warning", params: { spent: "0.81", budget: "1.00" } });
    await spend(people.lan.person.id, 0.1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("what reaches Postgres", () => {
  // PGlite reads a JavaScript Date passed as a raw parameter; Postgres gets it as
  // "Wed Oct 07 2026 00:00:00 GMT+0700" and refuses it. The tests run on PGlite, so they say it here:
  // every parameter these statements send is something Postgres reads.
  it("sends no raw Date — every instant goes through the column's encoder", () => {
    for (const query of [spentSoFarQuery(people.huy.person.id, NOW), monthToDateQuery(NOW)]) {
      const { params } = query.toSQL();
      expect(params.some((param) => param instanceof Date), JSON.stringify(params)).toBe(false);
    }
  });
});
