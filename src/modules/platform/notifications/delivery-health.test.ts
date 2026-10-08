// The failed-delivery tile on Admin → Jobs (ENG-05) against a real Postgres (PGlite).
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));

import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { countFailedDeliveries } from "./delivery-health";

beforeAll(async () => {
  await migrateTestDb();
});

it("counts the deliveries each outbox gave up on since a moment, and nothing else", async () => {
  const [person] = await db().insert(schema.person).values({ fullName: "An", searchName: "an", status: "active" }).returning();
  const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const email = { toEmail: "an@suzu.vn", subject: "s", bodyText: "b" };
  await db()
    .insert(schema.emailOutbox)
    .values([
      { ...email, status: "failed" },
      { ...email, status: "failed" },
      { ...email, status: "sent" },
      { ...email, status: "pending" },
      { ...email, status: "failed", createdAt: lastMonth },
    ]);
  await db().insert(schema.chatDelivery).values({ personId: person.id, kind: "approvals.requested", title: "t", body: "b", status: "failed" });

  expect(await countFailedDeliveries(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))).toEqual({ email: 2, push: 0, chat: 1, messenger: 0, telegram: 0 });
});
