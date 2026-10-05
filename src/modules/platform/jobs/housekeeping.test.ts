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
import { DELIVERY_LOG_RETENTION_DAYS, NOTIFICATION_RETENTION_DAYS } from "../notifications/retention";
import { housekeepingJob } from "./housekeeping";
import { JOB_RUN_RETENTION_DAYS } from "./service";

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

  expect(await housekeepingJob.run({ today: todayInVietnam() })).toMatchObject({ approvalTokens: 1, importBatchesDeleted: 1, importBatchesEmptied: 0 });
  expect(await db().select().from(schema.approvalActionToken)).toHaveLength(1);
  expect(await db().select().from(schema.importBatch)).toHaveLength(1);

  // Safe to run again the same night.
  expect(await housekeepingJob.run({ today: todayInVietnam() })).toMatchObject({ approvalTokens: 0, importBatchesDeleted: 0, importBatchesEmptied: 0 });
});

it("sweeps expired sessions, old notifications, finished deliveries and old job runs (ENG-04), and keeps what is owed or recent", async () => {
  // A session that expired a week ago and one in use; a sign-in that was started and never finished.
  await db().insert(schema.user).values({ id: "u1", name: "Người duyệt", email: "duyet@suzu.vn" });
  await db().insert(schema.session).values([
    { id: "s-old", token: "tok-old", userId: "u1", expiresAt: daysAgo(7) },
    { id: "s-live", token: "tok-live", userId: "u1", expiresAt: daysAgo(-2) },
  ]);
  await db().insert(schema.verification).values({ id: "v-old", identifier: "state", value: "x", expiresAt: daysAgo(3) });
  await db().insert(schema.authEndpointHit).values({ bucket: "sign_in", keyHash: "k", windowStart: daysAgo(2) });
  // A notice from last year and one from today.
  await db().insert(schema.notification).values([
    { recipientPersonId: ids.person, kind: "system.job_failed", createdAt: daysAgo(NOTIFICATION_RETENTION_DAYS + 5) },
    { recipientPersonId: ids.person, kind: "system.job_failed" },
  ]);
  // An email sent long ago, one that failed long ago, and one still owed from long ago: the last stays.
  const email = { toEmail: "a@suzu.vn", subject: "s", bodyText: "b", createdAt: daysAgo(DELIVERY_LOG_RETENTION_DAYS + 1) };
  await db().insert(schema.emailOutbox).values([
    { ...email, status: "sent" },
    { ...email, status: "failed" },
    { ...email, status: "pending" },
  ]);
  await db().insert(schema.jobRun).values({ job: "old", status: "succeeded", startedAt: daysAgo(JOB_RUN_RETENTION_DAYS + 1), finishedAt: daysAgo(JOB_RUN_RETENTION_DAYS + 1) });

  expect(await housekeepingJob.run({ today: todayInVietnam() })).toMatchObject({ sessionsExpired: 1, signInStatesExpired: 1, authHits: 1, notifications: 1, deliveries: 2, jobRuns: 1 });
  expect((await db().select().from(schema.session)).map((row) => row.id)).toEqual(["s-live"]);
  expect(await db().select().from(schema.notification)).toHaveLength(1);
  expect((await db().select().from(schema.emailOutbox)).map((row) => row.status)).toEqual(["pending"]);

  expect(await housekeepingJob.run({ today: todayInVietnam() })).toMatchObject({ sessionsExpired: 0, signInStatesExpired: 0, authHits: 0, notifications: 0, deliveries: 0, jobRuns: 0 });
});
