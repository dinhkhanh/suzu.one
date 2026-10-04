// The ceiling on the assistant, against a real Postgres (PGlite) and through the real action
// pipeline. The questions this file answers:
//   1. Is a person over their limit refused — and does the refused call reach a driver? (it must not)
//   2. Is the refusal audited once per window, not once per retry?
//   3. Is one person's limit another person's business? (no)
//   4. Does a draft count against the drafts' limit, all three kinds together?
//   5. Is what an answer cost kept, and totalled per day and per person in SQL?
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one", ANTHROPIC_MODEL: "claude-opus-5", EMBEDDINGS_MODEL: "@cf/baai/bge-m3" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => session.user, requireUser: async () => session.user }));
// Everything past the door, replaced by a counter: a call that gets this far has reached the
// assistant — retrieval, a tool, a driver. A refused call must leave these untouched.
vi.mock("./conversations", () => ({
  ask: vi.fn(async () => ({ conversationId: "c", messageId: "m", outcome: "answered", body: "…", citations: [], tool: null, score: 1, driver: "local-extractive", model: "local-extractive", usage: { inputTokens: 0, outputTokens: 0 }, audit: null })),
  deleteConversation: vi.fn(),
  resolveUnanswered: vi.fn(),
}));
vi.mock("./drafts", () => {
  const draft = { driver: "local-extractive", model: "local-extractive", extractive: true, usage: { inputTokens: 0, outputTokens: 0 } };
  return {
    draftEodNotes: vi.fn(async () => ({ ...draft, draft: "…" })),
    draftStatusSummary: vi.fn(async () => ({ ...draft, draft: { summary: "…", health: "on_track" } })),
    draftHandoffNote: vi.fn(async () => ({ ...draft, draft: { context: "…" } })),
  };
});

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant } from "../platform/rbac/policy";
import { askAssistantAction } from "./actions";
import { ask } from "./conversations";
import { draftEodNotesAction, draftHandoffNoteAction, draftStatusSummaryAction } from "./draft-actions";
import { draftEodNotes, draftHandoffNote, draftStatusSummary } from "./drafts";
import { AI_LIMITS } from "./engine/limits";
import { assistantUsage, countAiUse, purgeAiUsageHits } from "./limits";
import { canReadAssistantUsage } from "./policy";

const session = { user: null as CurrentUser | null };
const users = {} as Record<"huy" | "lan" | "mai" | "owner", CurrentUser>;
const TASK = "00000000-0000-4000-8000-000000000001";

const auditOf = (action: string) => db().select().from(schema.auditLog).where(eq(schema.auditLog.action, action));
const hitsOf = (personId: string) => db().select().from(schema.aiUsageHit).where(eq(schema.aiUsageHit.personId, personId));

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const grants: Record<string, Grant[]> = { owner: [{ role: "owner", scope: { type: "group" } }] };
  for (const [key, name] of [["huy", "Ho Gia Huy"], ["lan", "Tran Thi Lan"], ["mai", "Le Thi Mai"], ["owner", "Nguyen Thu Ha"]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: entity.id }).returning();
    users[key] = { userId: `user-${key}`, sessionId: `session-${key}`, reauthAt: null, preferences: { locale: null, theme: null, navPins: [] }, email: `${key}@suzu.group`, name, image: null, person: row, impersonator: null, principal: { personId: row.id, workforceType: "employee", grants: grants[key] ?? [] }, request: { ipAddress: null, userAgent: null } };
  }
});

// The actions read the clock themselves, so the tests hold it still: ten seconds into a minute,
// mid-morning in Vietnam. Only `Date` is faked — the database's own timers run as they are.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T03:00:10Z"));
  vi.mocked(ask).mockClear();
  for (const draft of [draftEodNotes, draftStatusSummary, draftHandoffNote]) vi.mocked(draft).mockClear();
});
afterEach(() => vi.useRealTimers());

describe("counting a use", () => {
  it("allows up to the limit, refuses the next, and marks the one call that crossed the line", async () => {
    const at = new Date("2026-10-05T03:00:10Z");
    const { max } = AI_LIMITS.ask_burst;
    for (let use = 0; use < max; use++) expect(await countAiUse("ask", users.mai.person.id, at)).toEqual({ ok: true });
    expect(await countAiUse("ask", users.mai.person.id, at)).toEqual({ ok: false, scope: "burst", retryAfterSeconds: 50, first: true });
    expect(await countAiUse("ask", users.mai.person.id, at)).toMatchObject({ ok: false, scope: "burst", first: false });
    // The next minute is a new window; the day goes on counting.
    expect(await countAiUse("ask", users.mai.person.id, new Date("2026-10-05T03:01:00Z"))).toEqual({ ok: true });
    const day = (await hitsOf(users.mai.person.id)).find((row) => row.bucket === "ask_day");
    expect(day?.hits).toBe(max + 3);
    // 03:00 UTC is 10:00 in Vietnam: the day's window began at Vietnamese midnight.
    expect(day?.windowStart.toISOString()).toBe("2026-10-04T17:00:00.000Z");
  });

  it("refuses for the rest of the Vietnamese day once the day's allowance is spent, whatever the minute", async () => {
    const day = AI_LIMITS.ask_day;
    const start = new Date("2026-10-06T17:00:00Z").getTime();
    // Spread over the day so no minute's window is ever full: only the day can refuse.
    for (let use = 0; use < day.max; use++) expect(await countAiUse("ask", users.mai.person.id, new Date(start + use * 61_000))).toEqual({ ok: true });
    const late = new Date(start + 20 * 60 * 60 * 1000);
    expect(await countAiUse("ask", users.mai.person.id, late)).toEqual({ ok: false, scope: "day", retryAfterSeconds: 4 * 60 * 60, first: true });
    // Tomorrow, in Vietnam, is a new day.
    expect(await countAiUse("ask", users.mai.person.id, new Date(start + 24 * 60 * 60 * 1000 + 1000))).toEqual({ ok: true });
  });

  it("sweeps the windows nobody can still be inside", async () => {
    const before = (await hitsOf(users.mai.person.id)).length;
    expect(before).toBeGreaterThan(0);
    expect(await purgeAiUsageHits(new Date("2026-10-06T00:00:00Z"))).toBeGreaterThan(0);
    const left = await hitsOf(users.mai.person.id);
    expect(left.length).toBeLessThan(before);
    expect(left.every((row) => row.windowStart >= new Date("2026-10-06T00:00:00Z"))).toBe(true);
  });
});

describe("the door on ai.ask", () => {
  it("lets the allowance through, then refuses without reaching the assistant, and audits the refusal once", async () => {
    session.user = users.huy;
    const { max } = AI_LIMITS.ask_burst;
    const results = [];
    for (let call = 0; call < max + 3; call++) results.push(await askAssistantAction({ question: "Một năm được bao nhiêu ngày phép?", locale: "vi" }));
    expect(results.slice(0, max).every((result) => result.ok)).toBe(true);
    const refused = results.slice(max);
    for (const result of refused) expect(result).toEqual({ ok: false, error: "failed", message: "ai_limit_burst", details: { retryAfterSeconds: 50 } });
    // Every refused call stopped at the door: the assistant ran `max` times and no more.
    expect(vi.mocked(ask)).toHaveBeenCalledTimes(max);
    expect(await auditOf("ai.ask")).toHaveLength(max);
    // Three refusals, ONE audit entry: the call that crossed the line, not each retry after it.
    const limited = await auditOf("ai.ask.limit_reached");
    expect(limited).toHaveLength(1);
    expect(limited[0]).toMatchObject({ actorPersonId: users.huy.person.id, resourceType: "person", resourceId: users.huy.person.id, after: { scope: "burst", max, windowSeconds: 60 } });
    // Nothing of the question is kept in it.
    expect(`${limited[0].summary} ${JSON.stringify(limited[0].after)}`).not.toContain("ngày phép");

    // The next minute the door opens again.
    vi.setSystemTime(new Date("2026-10-07T03:01:05Z"));
    expect(await askAssistantAction({ question: "Một năm được bao nhiêu ngày phép?", locale: "vi" })).toMatchObject({ ok: true });
    expect(vi.mocked(ask)).toHaveBeenCalledTimes(max + 1);
  });

  it("is each person's own: a colleague asks freely while the first is over the limit", async () => {
    session.user = users.lan;
    expect(await askAssistantAction({ question: "Ngày trả lương là ngày nào?", locale: "vi" })).toMatchObject({ ok: true });
    expect(vi.mocked(ask)).toHaveBeenCalledTimes(1);
  });
});

describe("the door on the drafts", () => {
  it("counts the three kinds together, and a refused draft reads nothing", async () => {
    session.user = users.lan;
    const { max } = AI_LIMITS.draft_burst;
    const calls = [
      () => draftEodNotesAction({ date: "2026-10-05", locale: "vi" }),
      () => draftStatusSummaryAction({ projectId: TASK, locale: "vi" }),
      () => draftHandoffNoteAction({ taskId: TASK, locale: "vi" }),
    ];
    const results = [];
    for (let call = 0; call < max + 3; call++) results.push(await calls[call % calls.length]());
    expect(results.slice(0, max).every((result) => result.ok)).toBe(true);
    for (const result of results.slice(max)) expect(result).toMatchObject({ ok: false, error: "failed", message: "ai_limit_burst" });
    const reached = [draftEodNotes, draftStatusSummary, draftHandoffNote].reduce((sum, draft) => sum + vi.mocked(draft).mock.calls.length, 0);
    expect(reached).toBe(max);
    expect(await auditOf("ai.draft.limit_reached")).toHaveLength(1);
    // A draft's audit entry says what it cost; the limit on drafts never touched the questions'.
    const [entry] = await auditOf("ai.draft.eod_notes");
    expect(entry.after).toMatchObject({ driver: "local-extractive", inputTokens: 0, outputTokens: 0 });
    expect((await hitsOf(users.lan.person.id)).filter((row) => row.bucket.startsWith("ask_")).every((row) => row.hits === 1)).toBe(true);
  });
});

describe("what the assistant cost", () => {
  it("is totalled per Vietnamese day and per person, in SQL, over the last thirty days", async () => {
    const now = new Date("2026-10-05T05:00:00Z");
    const turn = async (who: "huy" | "lan", at: string, tokens: [number, number] | null, driver = "claude") => {
      const personId = users[who].person.id;
      const [conversation] = await db().insert(schema.aiConversation).values({ personId, title: "…" }).returning();
      await db()
        .insert(schema.aiMessage)
        .values([
          { conversationId: conversation.id, personId, role: "user", body: "…", createdAt: new Date(at) },
          { conversationId: conversation.id, personId, role: "assistant", body: "…", outcome: "answered", driver, model: driver, inputTokens: tokens?.[0] ?? null, outputTokens: tokens?.[1] ?? null, createdAt: new Date(at) },
        ]);
    };
    await turn("huy", "2026-10-04T16:30:00Z", [5000, 200]); // 23:30 on the 4th in Vietnam
    await turn("huy", "2026-10-04T17:30:00Z", [7000, 300]); // 00:30 on the 5th
    await turn("lan", "2026-10-05T02:00:00Z", [0, 0], "local-extractive");
    await turn("lan", "2026-10-05T03:00:00Z", null, "local-extractive"); // stored before usage was kept
    await turn("lan", "2026-08-01T03:00:00Z", [9_000_000, 9_000_000]); // older than the window

    const usage = await assistantUsage(30, now);
    expect(usage.total).toEqual({ answers: 4, modelAnswers: 2, inputTokens: 12_000, outputTokens: 500 });
    expect(usage.byDay).toEqual([
      { day: "2026-10-05", answers: 3, modelAnswers: 1, inputTokens: 7000, outputTokens: 300 },
      { day: "2026-10-04", answers: 1, modelAnswers: 1, inputTokens: 5000, outputTokens: 200 },
    ]);
    // The dearest first.
    expect(usage.byPerson).toEqual([
      { personId: users.huy.person.id, fullName: "Ho Gia Huy", answers: 2, modelAnswers: 2, inputTokens: 12_000, outputTokens: 500 },
      { personId: users.lan.person.id, fullName: "Tran Thi Lan", answers: 2, modelAnswers: 0, inputTokens: 0, outputTokens: 0 },
    ]);
  });

  it("is the owner's to read, and nobody else's", () => {
    expect(canReadAssistantUsage(users.owner.principal)).toBe(true);
    expect(canReadAssistantUsage(users.huy.principal)).toBe(false);
    // The keepers of the knowledge base read the unanswered log, not the bill.
    expect(canReadAssistantUsage({ personId: "p", workforceType: "employee", grants: [{ role: "hr_admin", scope: { type: "group" } }] })).toBe(false);
    expect(canReadAssistantUsage({ personId: "p", workforceType: "employee", grants: [{ role: "c_level", scope: { type: "group" } }] })).toBe(false);
  });
});
