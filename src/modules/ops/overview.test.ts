// Reminders, escalation and the dashboard against a real Postgres (PGlite): who hears what, once,
// and which entities each kind of viewer gets on the dashboard and in the archive.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({ env: () => ({ BETTER_AUTH_URL: "https://suzu.one" }) }));
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

import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import type { Principal } from "../platform/rbac/policy";
import { NO_EVIDENCE } from "./enums";
import { completeInstance, listInstances } from "./instances";
import { buildHistoryExport, getDashboard, getHistory } from "./overview";
import { sendOpsReminders } from "./reminders";
import { generateInstances } from "./scheduler";
import { saveTemplate, type TemplateInput } from "./templates";

const ids = {} as Record<"szm" | "szc" | "fin" | "finance" | "accountant" | "head" | "hrSzm" | "ceo" | "owner" | "employee", string>;
const base: TemplateInput = { code: "VAT", name: "VAT return", category: "external", authority: "tax", recurrence: "monthly", dueRule: { type: "after_period", monthsAfter: 1, day: 20 }, shift: "none", eventType: null, entityIds: null, ownerRule: "person", ownerPersonId: null, reviewerRule: "person", reviewerPersonId: null, checklist: [], guidance: null, links: [], reminderLeadDays: [7, 3, 1], escalation: { managerAfterDays: 3, executiveAfterDays: 7 }, evidence: NO_EVIDENCE, penaltyNote: null, isActive: true };

const principal = (personId: string, grants: Principal["grants"]): { principal: Principal; personId: string } => ({ principal: { personId, workforceType: "employee", grants }, personId });
const noticesOf = async (kind: string) => (await db().select({ personId: schema.notification.recipientPersonId, params: schema.notification.params }).from(schema.notification).where(eq(schema.notification.kind, kind))).map((row) => ({ who: Object.entries(ids).find(([, id]) => id === row.personId)?.[0], count: (row.params as { count: number }).count }));
const clearNotices = () => db().delete(schema.notification);

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative" }).returning();
  const [fin] = await db().insert(schema.department).values({ code: "FIN", name: "Finance" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, fin: fin.id });
  for (const key of ["finance", "head", "accountant", "hrSzm", "ceo", "owner", "employee"] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, departmentId: key === "accountant" || key === "head" ? fin.id : null }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values([
    { personId: ids.finance, role: "finance", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
    { personId: ids.head, role: "department_head", scopeType: "department", scopeId: fin.id, validFrom: "2020-01-01" },
    { personId: ids.hrSzm, role: "hr_staff", scopeType: "entity", scopeId: szm.id, validFrom: "2020-01-01" },
    { personId: ids.ceo, role: "c_level", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
    { personId: ids.owner, role: "owner", scopeType: "group", scopeId: null, validFrom: "2020-01-01" },
  ]);
  // The accountant owns the VAT return, the finance lead reviews it; periods July–September 2026 for both entities.
  await saveTemplate(null, { ...base, ownerPersonId: ids.accountant, reviewerPersonId: ids.finance });
  await generateInstances("2026-08-01", { from: "2026-08-01", horizonDays: 90 });
});

describe("ops reminders and escalation", () => {
  it("reminds the owner once per lead time, in one notice however many items", async () => {
    // 13 August: the July return (due 20 August) is 7 days away, for both entities.
    expect(await sendOpsReminders("2026-08-13")).toEqual({ reminders: 2, overdue: 0, escalated: 0, people: 1 });
    expect(await noticesOf("ops.reminder")).toEqual([{ who: "accountant", count: 2 }]);
    expect(await sendOpsReminders("2026-08-13")).toEqual({ reminders: 0, overdue: 0, escalated: 0, people: 0 });
    expect(await sendOpsReminders("2026-08-14")).toEqual({ reminders: 0, overdue: 0, escalated: 0, people: 0 });
    expect((await sendOpsReminders("2026-08-17")).reminders).toBe(2);
  });

  it("the first day late tells the owner and the reviewer; then the department head; then finance, the CEO and the owner", async () => {
    await clearNotices();
    expect(await sendOpsReminders("2026-08-21")).toMatchObject({ overdue: 4, escalated: 0 });
    expect((await noticesOf("ops.overdue")).sort((a, b) => a.who!.localeCompare(b.who!))).toEqual([{ who: "accountant", count: 2 }, { who: "finance", count: 2 }]);
    expect(await sendOpsReminders("2026-08-22")).toMatchObject({ overdue: 0, escalated: 0 });

    await clearNotices();
    expect(await sendOpsReminders("2026-08-23")).toMatchObject({ escalated: 2, people: 1 });
    expect(await noticesOf("ops.escalated")).toEqual([{ who: "head", count: 2 }]);

    await clearNotices();
    expect(await sendOpsReminders("2026-08-27")).toMatchObject({ escalated: 6, people: 3 });
    expect((await noticesOf("ops.escalated")).map((row) => row.who).sort()).toEqual(["ceo", "finance", "owner"]);
    expect(await sendOpsReminders("2026-08-27")).toMatchObject({ escalated: 0, people: 0 });
  });

  it("shows the escalation level on the list and says nothing more once the item is closed", async () => {
    const viewer = principal(ids.finance, [{ role: "finance", scope: { type: "group" } }]);
    const july = (await listInstances(viewer, { open: true }, "2026-08-27")).filter((item) => item.periodKey === "2026-07");
    expect(july.map((item) => [item.colour, item.escalationLevel])).toEqual([["overdue", 2], ["overdue", 2]]);
    for (const item of july) await completeInstance(item.taskId, ids.accountant, "2026-08-27");
    await clearNotices();
    // 20 September: nothing about July any more; the August return is due in 0 days with no same-day lead time → the closest reached lead (1) goes out once.
    const result = await sendOpsReminders("2026-09-20");
    expect(result).toMatchObject({ overdue: 0, escalated: 0, reminders: 2 });
  });
});

describe("dashboard, archive and export scoping", () => {
  const today = "2026-09-20";
  it("a group role sees every entity; an entity role its own; an employee none", async () => {
    const group = await getDashboard(principal(ids.ceo, [{ role: "c_level", scope: { type: "group" } }]), {}, today);
    expect(group.rows.map((row) => row.entity.code)).toEqual(["SZC", "SZM"]);
    expect(group.months).toEqual(["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"]);
    const august = group.rows[0].cells[1];
    expect(august).toMatchObject({ month: "2026-08", total: 1, counts: { done_late: 1 } });

    const entity = await getDashboard(principal(ids.hrSzm, [{ role: "hr_staff", scope: { type: "entity", id: ids.szm } }]), {}, today);
    expect(entity.rows.map((row) => row.entity.code)).toEqual(["SZM"]);

    const nobody = await getDashboard(principal(ids.employee, []), {}, today);
    expect(nobody.rows).toEqual([]);
    // The owner of an instance without an ops role still gets no dashboard — only their own items in the list.
    const accountant = principal(ids.accountant, []);
    expect((await getDashboard(accountant, {}, today)).rows).toEqual([]);
    expect((await listInstances(accountant, { open: true }, today)).length).toBeGreaterThan(0);
  });

  it("filters by authority, category and owner", async () => {
    const viewer = principal(ids.ceo, [{ role: "c_level", scope: { type: "group" } }]);
    const total = (dashboard: Awaited<ReturnType<typeof getDashboard>>) => dashboard.rows.flatMap((row) => row.cells).reduce((sum, cell) => sum + cell.total, 0);
    expect(total(await getDashboard(viewer, { authority: "tax" }, today))).toBeGreaterThan(0);
    expect(total(await getDashboard(viewer, { authority: "labour" }, today))).toBe(0);
    expect(total(await getDashboard(viewer, { category: "internal" }, today))).toBe(0);
    expect(total(await getDashboard(viewer, { ownerId: ids.finance }, today))).toBe(0);
    expect((await getDashboard(viewer, { ownerId: ids.finance }, today)).owners.map((owner) => owner.name)).toEqual(["accountant"]);
  });

  it("the archive lists past and closed periods in the viewer's reach, and the export holds the same rows", async () => {
    const entityViewer = principal(ids.hrSzm, [{ role: "hr_staff", scope: { type: "entity", id: ids.szm } }]);
    const rows = await getHistory(entityViewer, { year: 2026 }, today);
    expect(rows.map((row) => `${row.entityCode} ${row.periodKey} ${row.colour}`)).toEqual(["SZM 2026-07 done_late"]);
    expect(rows[0]).toMatchObject({ completedByName: "accountant", files: [] });
    const all = await getHistory(principal(ids.finance, [{ role: "finance", scope: { type: "group" } }]), {}, "2026-09-25");
    expect(all.map((row) => `${row.entityCode} ${row.periodKey} ${row.colour}`)).toEqual(["SZC 2026-08 overdue", "SZM 2026-08 overdue", "SZC 2026-07 done_late", "SZM 2026-07 done_late"]);
    const file = await buildHistoryExport(entityViewer, { year: 2026 }, "en");
    expect(file.rowCount).toBe(1);
    expect(file.csv).toContain("SZM,VAT,VAT return");
    expect(await db().select().from(schema.obligationNoticeSent).where(and(inArray(schema.obligationNoticeSent.key, ["escalate:executive"]))).then((sent) => sent.length)).toBe(2);
  });
});
