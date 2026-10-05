// The SLA job against a real database (PGlite): a nudge goes to an approver who can still answer,
// once — and to nobody when the approver is suspended or has left.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ allowedWorkspaceDomains: ["suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one" }) }));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { runRequestSla } from "./jobs";
import { REQUEST_TYPE_SEED } from "./seed-types";
import { fileRequest } from "./service";

const ids = {} as Record<"entity" | "boss" | "huy", string>;
const DAY = 24 * 60 * 60 * 1000;
const purchase = { item: "Ổ cứng 4TB", quantity: 1, amount: 3_000_000, category: "it", needed_by: "2099-01-01", reason: "Lưu trữ dự án quay phim" };

const reminders = async () => (await db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids.boss), eq(schema.notification.kind, "approvals.sla_reminder")))).length;

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "SZM" }).returning();
  ids.entity = entity.id;
  const person = async (name: string, managerId: string | null) => {
    const [row] = await db().insert(schema.person).values({ fullName: name, searchName: name.toLowerCase(), workEmail: `${name.toLowerCase()}@suzu.group`, primaryEntityId: entity.id, managerId }).returning();
    return row.id;
  };
  ids.boss = await person("Boss", null);
  ids.huy = await person("Huy", ids.boss);
  const seed = REQUEST_TYPE_SEED.find((entry) => entry.code === "purchase")!;
  await db().insert(schema.requestType).values({ ...seed, flow: undefined, slaRemindAfterDays: 1, slaEscalateAfterDays: 0, slaEscalateTo: null } as typeof schema.requestType.$inferInsert);
  await db().insert(schema.approvalFlow).values({ requestType: "request:purchase", entityId: null, definition: { steps: [{ key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] }] } });
});

describe("the SLA job", () => {
  it("does not nudge a suspended approver, and nudges once when they are back", async () => {
    await fileRequest({ code: "purchase", values: purchase }, { personId: ids.huy, entityId: ids.entity, unitPath: [], managerId: ids.boss }, (amount) => `${amount} đ`);
    const later = new Date(Date.now() + 2 * DAY);

    await db().update(schema.person).set({ status: "suspended" }).where(eq(schema.person.id, ids.boss));
    expect(await runRequestSla(later)).toMatchObject({ checked: 1, reminded: 0 });
    expect(await reminders()).toBe(0);

    await db().update(schema.person).set({ status: "active" }).where(eq(schema.person.id, ids.boss));
    expect(await runRequestSla(later)).toMatchObject({ reminded: 1 });
    expect(await runRequestSla(later)).toMatchObject({ reminded: 0 });
    expect(await reminders()).toBe(1);
  });
});
