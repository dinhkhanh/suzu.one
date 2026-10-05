// The nightly housekeeping job against a real Postgres (PGlite): each sweep has its own tests in
// its own module; what is tested here is that the job *calls* them — an expired approval link and a
// staged import nobody committed were both "deleted after a while" in a comment and in no schedule.
import { beforeAll, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({}) }));
vi.mock("@/modules/platform/auth/session", () => ({ getCurrentUser: async () => null }));

import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../../tests/helpers/db";
import { issueActionToken } from "../approvals/action-tokens";
import { housekeepingJob } from "./housekeeping";

const ids = { person: "", request: "" };
const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "T1", shortName: "T1", legalName: "T1" }).returning();
  const [person] = await db().insert(schema.person).values({ fullName: "Người duyệt", searchName: "nguoi duyet", status: "active" }).returning();
  const [request] = await db().insert(schema.approvalRequest).values({ type: "request:purchase", entityId: entity.id, requesterPersonId: person.id, summary: "x", flowSnapshot: {}, status: "pending" }).returning();
  Object.assign(ids, { person: person.id, request: request.id });
});

it("sweeps expired approval links and stale import batches, and leaves what is still in use", async () => {
  // A link issued a month ago (expired after 72 hours) and one issued just now.
  await issueActionToken(db(), ids.request, ids.person, daysAgo(30));
  await issueActionToken(db(), ids.request, ids.person);
  // A spreadsheet staged two days ago and never committed, and one staged today.
  const batch = { kind: "sample", fileName: "people.csv", rowCount: 1, rows: [{ row: 2, values: { name: "Nguyễn Văn A", phone: "0901234567" } }], problems: [], createdByPersonId: ids.person };
  await db().insert(schema.importBatch).values([
    { ...batch, status: "ready", createdAt: daysAgo(2) },
    { ...batch, status: "ready" },
  ]);

  expect(await housekeepingJob.run({ today: todayInVietnam() })).toEqual({ approvalTokens: 1, importBatchesDeleted: 1, importBatchesEmptied: 0 });
  expect(await db().select().from(schema.approvalActionToken)).toHaveLength(1);
  expect(await db().select().from(schema.importBatch)).toHaveLength(1);

  // Safe to run again the same night.
  expect(await housekeepingJob.run({ today: todayInVietnam() })).toEqual({ approvalTokens: 0, importBatchesDeleted: 0, importBatchesEmptied: 0 });
});
