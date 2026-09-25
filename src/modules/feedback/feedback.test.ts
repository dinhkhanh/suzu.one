// Feedback against a real Postgres (PGlite): sending notifies whoever triages for the sender and
// nobody else, the inbox's SQL reach agrees with the pure policy, the counts are one aggregate,
// and triage tells the sender only when there is something for them.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));

import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Grant, Principal } from "../platform/rbac/policy";
import { FEEDBACK_SCREENSHOT_OWNER_TYPE } from "./enums";
import { canReadFeedback, feedbackReach } from "./policy";
import { countFeedbackByStatus, getFeedback, listFeedbackAreas, listFeedbackInbox, listMyFeedback, submitFeedback, triageFeedback } from "./service";

type Who = "hrA" | "ceo" | "lan" | "khoi";
const ids = {} as Record<Who | "a" | "b" | "design" | "video", string>;
const principals = {} as Record<Who, Principal>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const submitter = (who: "lan" | "khoi") => ({ personId: ids[who], entityId: who === "lan" ? ids.a : ids.b, unitPath: [who === "lan" ? ids.design : ids.video] });
const noticesOf = async (who: Who, kind: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, ids[who]), eq(schema.notification.kind, kind)));
const base = { blocking: false, pagePath: null, screenshotFileId: null } as const;

beforeAll(async () => {
  await migrateTestDb();
  const [a] = await db().insert(schema.entity).values({ code: "SZA", legalName: "SuZu A", shortName: "A" }).returning();
  const [b] = await db().insert(schema.entity).values({ code: "SZB", legalName: "SuZu B", shortName: "B" }).returning();
  const [design] = await db().insert(schema.orgUnit).values({ code: "DES", name: "Design" }).returning();
  const [video] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  Object.assign(ids, { a: a.id, b: b.id, design: design.id, video: video.id });

  const people: [Who, string, string, Grant["role"] | null, "group" | "entity" | null][] = [
    ["hrA", a.id, design.id, "hr_admin", "entity"],
    ["ceo", a.id, design.id, "c_level", "group"],
    ["lan", a.id, design.id, null, null],
    ["khoi", b.id, video.id, null, null],
  ];
  for (const [key, entityId, unitId, role, scope] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, primaryEntityId: entityId, orgUnitId: unitId }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : { type: "entity", id: entityId } }] : [];
    principals[key] = { personId: row.id, workforceType: "employee", grants };
    if (role) await db().insert(schema.roleAssignment).values({ personId: row.id, role, scopeType: scope!, scopeId: scope === "group" ? null : entityId, validFrom: "2020-01-01" });
  }
});

describe("sending feedback", () => {
  it("records it with the page's area and tells the HR admin over the sender, not the read-only CEO", async () => {
    const row = await submitFeedback(submitter("lan"), { ...base, category: "bug", message: "Nút lưu không phản hồi", blocking: true, pagePath: "/attendance/check-in" }, "Mozilla/5.0");
    expect(row).toMatchObject({ status: "new", priority: "normal", area: "attendance", blocking: true, entityId: ids.a });
    const [notice] = await noticesOf("hrA", "feedback.received");
    expect(notice).toMatchObject({ link: `/feedback/${row.id}`, params: { feedbackCategory: "bug", area: "/attendance" } });
    // The text never travels in a notification.
    expect(JSON.stringify(notice.params)).not.toContain("Nút lưu");
    expect(await noticesOf("ceo", "feedback.received")).toHaveLength(0);
  });

  it("tells nobody in entity A about feedback from entity B", async () => {
    const before = (await noticesOf("hrA", "feedback.received")).length;
    await submitFeedback(submitter("khoi"), { ...base, category: "idea", message: "Thêm chế độ tối", pagePath: "/projects/x" }, null);
    expect(await noticesOf("hrA", "feedback.received")).toHaveLength(before);
  });

  it("keeps only app paths", async () => {
    const offsite = await submitFeedback(submitter("lan"), { ...base, category: "other", message: "Một đường dẫn lạ", pagePath: "//evil.example/x" }, null);
    expect(offsite).toMatchObject({ pagePath: null, area: null });
  });

  it("refuses a screenshot that is not the sender's own finished upload", async () => {
    const [file] = await db()
      .insert(schema.storedFile)
      .values({ bucket: "b", objectPath: "feedback/khoi.png", fileName: "khoi.png", contentType: "image/png", sizeBytes: 10, ownerType: FEEDBACK_SCREENSHOT_OWNER_TYPE, ownerId: ids.khoi, tier: "compensation", status: "ready" })
      .returning();
    expect(await fails(submitFeedback(submitter("lan"), { ...base, category: "bug", message: "Ảnh của người khác", screenshotFileId: file.id }, null))).toBe("feedback_screenshot_invalid");
    const mine = await submitFeedback(submitter("khoi"), { ...base, category: "bug", message: "Ảnh của tôi", pagePath: "/projects", screenshotFileId: file.id }, null);
    expect((await getFeedback(mine.id))?.screenshotName).toBe("khoi.png");
  });
});

describe("the inbox", () => {
  it("lists only what the reader's grant reaches, in agreement with the policy", async () => {
    for (const who of ["hrA", "ceo"] as const) {
      const { rows } = await listFeedbackInbox(feedbackReach(principals[who]), { status: undefined });
      const all = await db().select().from(schema.appFeedback);
      const expected = await Promise.all(all.map(async (row) => ((await getFeedback(row.id)) && canReadFeedback(principals[who], (await getFeedback(row.id))!.target) ? row.id : null)));
      expect(rows.map((row) => row.id).sort(), who).toEqual(expected.filter(Boolean).sort());
    }
    const hrRows = (await listFeedbackInbox(feedbackReach(principals.hrA), {})).rows;
    expect(hrRows.every((row) => row.personId === ids.lan)).toBe(true);
  });

  it("counts by status in one aggregate and lists the areas", async () => {
    const counts = await countFeedbackByStatus(feedbackReach(principals.ceo), {});
    expect(counts).toMatchObject({ new: 4, in_progress: 0, resolved: 0, declined: 0, blockingOpen: 1 });
    expect(await countFeedbackByStatus(feedbackReach(principals.ceo), { category: "idea" })).toMatchObject({ new: 1, blockingOpen: 0 });
    expect(await listFeedbackAreas(feedbackReach(principals.ceo))).toEqual([
      { area: "projects", count: 2 },
      { area: "attendance", count: 1 },
    ]);
  });

  it("puts blocking and urgent items first among the open ones", async () => {
    const { rows } = await listFeedbackInbox(feedbackReach(principals.ceo), { status: "open" });
    expect(rows[0]).toMatchObject({ blocking: true, category: "bug" });
  });
});

describe("triage", () => {
  it("tells the sender about a reply and about closing, and not about a priority change", async () => {
    const [mine] = await listMyFeedback(ids.khoi);
    await triageFeedback(mine.id, ids.hrA, { status: "new", priority: "high", reply: null, internalNote: "xem sau" });
    expect(await noticesOf("khoi", "feedback.answered")).toHaveLength(0);

    const { after } = await triageFeedback(mine.id, ids.hrA, { status: "resolved", priority: "high", reply: "Đã sửa, cảm ơn bạn!", internalNote: "xem sau" });
    expect(after.closedAt).not.toBeNull();
    expect(after.repliedAt).not.toBeNull();
    const [notice] = await noticesOf("khoi", "feedback.answered");
    expect(notice).toMatchObject({ link: `/feedback/${mine.id}`, params: { feedbackStatus: "resolved" } });

    const reopened = await triageFeedback(mine.id, ids.hrA, { status: "in_progress", priority: "high", reply: "Đã sửa, cảm ơn bạn!", internalNote: null });
    expect(reopened.after.closedAt).toBeNull();
    expect(await noticesOf("khoi", "feedback.answered")).toHaveLength(2);
  });

  it("refuses an item that does not exist", async () => {
    expect(await fails(triageFeedback("00000000-0000-4000-8000-000000000000", ids.hrA, { status: "resolved", priority: "normal", reply: null, internalNote: null }))).toBe("feedback_not_found");
  });
});
