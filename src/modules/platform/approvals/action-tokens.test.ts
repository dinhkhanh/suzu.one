import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { findActionToken, issueActionToken, purgeExpiredActionTokens, spendActionToken, voidActionTokens } from "./action-tokens";

const ids: { person: string; other: string; request: string } = { person: "", other: "", request: "" };

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "T1", shortName: "T1", legalName: "T1" }).returning();
  const [person] = await db().insert(schema.person).values({ fullName: "Người duyệt", searchName: "nguoi duyet", status: "active" }).returning();
  const [other] = await db().insert(schema.person).values({ fullName: "Người khác", searchName: "nguoi khac", status: "active" }).returning();
  const [request] = await db()
    .insert(schema.approvalRequest)
    .values({ type: "request:purchase", entityId: entity.id, requesterPersonId: other.id, summary: "x", flowSnapshot: {}, status: "pending" })
    .returning();
  Object.assign(ids, { person: person.id, other: other.id, request: request.id });
});

beforeEach(async () => {
  await db().delete(schema.approvalActionToken);
});

describe("approve-from-notification tokens (FR-PLT-24)", () => {
  it("is usable once, and is a shortcut only: the token says whose it is", async () => {
    const { token } = await issueActionToken(db(), ids.request, ids.person);
    const found = await findActionToken(token);
    expect(found.ok && found.row.personId).toBe(ids.person);
    expect(found.ok && found.row.action).toBe("approve");

    expect(await spendActionToken((found as { row: { id: string } }).row.id)).toBe(true);
    // The second press of the same button loses the race and changes nothing.
    expect(await spendActionToken((found as { row: { id: string } }).row.id)).toBe(false);
    expect(await findActionToken(token)).toEqual({ ok: false, reason: "used" });
  });

  it("stores only a hash, never the token itself", async () => {
    const { token } = await issueActionToken(db(), ids.request, ids.person);
    const rows = await db().select().from(schema.approvalActionToken).where(eq(schema.approvalActionToken.requestId, ids.request));
    expect(rows).toHaveLength(1);
    expect(rows[0].tokenHash).not.toBe(token);
    expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("says nothing at all about a token that was never issued", async () => {
    expect(await findActionToken("not-a-token-at-all-but-long-enough-to-pass")).toEqual({ ok: false, reason: "unknown" });
  });

  it("expires", async () => {
    const { token } = await issueActionToken(db(), ids.request, ids.person, new Date("2026-01-01T00:00:00Z"));
    expect(await findActionToken(token, new Date("2026-01-02T00:00:00Z"))).toMatchObject({ ok: true });
    expect(await findActionToken(token, new Date("2026-02-01T00:00:00Z"))).toEqual({ ok: false, reason: "expired" });
  });

  it("is voided in bulk when the request moves on, so a stale link does nothing", async () => {
    const first = await issueActionToken(db(), ids.request, ids.person);
    const second = await issueActionToken(db(), ids.request, ids.other);
    await voidActionTokens(db(), ids.request);
    expect(await findActionToken(first.token)).toEqual({ ok: false, reason: "used" });
    expect(await findActionToken(second.token)).toEqual({ ok: false, reason: "used" });
  });

  it("is swept away once it has expired", async () => {
    await issueActionToken(db(), ids.request, ids.person, new Date("2026-01-01T00:00:00Z"));
    expect(await purgeExpiredActionTokens(new Date("2026-02-01T00:00:00Z"))).toBe(1);
    expect(await db().select().from(schema.approvalActionToken)).toHaveLength(0);
  });
});
