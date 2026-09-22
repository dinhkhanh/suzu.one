// KPI actuals proposed from work (FR-PJM-62) against a real Postgres (PGlite): a proposal is written
// once and told to the scorer, it never moves a score until the scorer confirms or corrects it,
// a dismissed proposal stays dismissed, the person never confirms their own, and a closed month is
// never touched.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
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
import type { Principal } from "../platform/rbac/policy";
import { closeBlockers, closeMonth, getScorecard, saveActuals } from "./kpi-scores";
import { getEntryGrid } from "./kpi-views";
import { createAssignment, saveKpi } from "./kpis";
import { loadDirectory } from "./people";
import { canEnterActualsFor } from "./policy";
import { listWorkKpiDue, proposeWorkActuals } from "./work-actuals";

const ids = {} as Record<"szm" | "tam" | "huy" | "lan" | "hr" | "onTime" | "output" | "manual" | "huyOnTime" | "huyOutput" | "huyManual" | "lanOnTime", string>;
const MONTH = "2027-04";
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const actualOf = async (assignmentId: string) => (await db().select().from(schema.kpiActual).where(and(eq(schema.kpiActual.assignmentId, assignmentId), eq(schema.kpiActual.periodKey, MONTH))))[0];
const noticesOf = async (personId: string) => db().select().from(schema.notification).where(and(eq(schema.notification.recipientPersonId, personId), eq(schema.notification.kind, "projects.kpi_proposed")));
const entry = (assignmentId: string, actual: string | null) => ({ assignmentId, periodKey: MONTH, actual, notApplicable: false, note: null });

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media" }).returning();
  ids.szm = szm.id;
  // tam manages huy; lan has no manager (her scorer is HR); hr holds performance:manage over SZM.
  for (const [key, manager] of [["tam", null], ["huy", "tam"], ["lan", null], ["hr", null]] as const) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: szm.id, managerId: manager ? ids[manager] : null }).returning();
    ids[key] = row.id;
  }
  await db().insert(schema.roleAssignment).values({ personId: ids.hr, role: "hr_admin", scopeType: "entity", scopeId: szm.id, validFrom: "2025-01-01" });

  ids.onTime = (await saveKpi(null, { code: "ON_TIME", name: "Đúng hạn", description: null, unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true, workMetric: "on_time_rate" })).after.id;
  ids.output = (await saveKpi(null, { code: "ACCEPTED", name: "Sản phẩm được duyệt", description: null, unit: "number", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true, workMetric: "deliverables_accepted" })).after.id;
  ids.manual = (await saveKpi(null, { code: "CSAT", name: "Hài lòng", description: null, unit: "number", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true })).after.id;
  const assign = (personId: string, kpiId: string, target: string) => createAssignment(ids.tam, { personId, kpiId, weight: 1, target, fromPeriod: "2027-01", toPeriod: null }).then((row) => row.id);
  ids.huyOnTime = await assign(ids.huy, ids.onTime, "90");
  ids.huyOutput = await assign(ids.huy, ids.output, "10");
  ids.huyManual = await assign(ids.huy, ids.manual, "4");
  ids.lanOnTime = await assign(ids.lan, ids.onTime, "90");
});

describe("the library (FR-PJM-62)", () => {
  it("takes a work metric only on a KPI of the metric's unit", async () => {
    expect(await fails(saveKpi(null, { code: "BAD", name: "x", description: null, unit: "number", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true, workMetric: "on_time_rate" }))).toBe("kpi_work_metric_unit");
    const [row] = await db().select().from(schema.kpiDefinition).where(eq(schema.kpiDefinition.id, ids.onTime));
    expect(row.workMetric).toBe("on_time_rate");
  });
});

describe("proposing", () => {
  it("lists the work-sourced lines still waiting, and writes them as proposals once", async () => {
    const due = await listWorkKpiDue(MONTH);
    expect(due.map((line) => line.assignmentId).sort()).toEqual([ids.huyOnTime, ids.huyOutput, ids.lanOnTime].sort());
    const value = (assignmentId: string) => ({ [ids.huyOnTime]: 8750, [ids.huyOutput]: 700, [ids.lanOnTime]: 9500 })[assignmentId]!;
    expect(await proposeWorkActuals(due.map((line) => ({ line, value: value(line.assignmentId) })))).toMatchObject({ proposed: 3 });
    expect(await actualOf(ids.huyOnTime)).toMatchObject({ status: "proposed", source: "work", actualValue: 8750, proposedValue: 8750, enteredByPersonId: null });

    // Again: nothing waits any more, and a stray second write changes nothing.
    expect(await listWorkKpiDue(MONTH)).toEqual([]);
    expect(await proposeWorkActuals(due.map((line) => ({ line, value: 1 })))).toMatchObject({ proposed: 0 });
    expect((await actualOf(ids.huyOnTime)).actualValue).toBe(8750);
  });

  it("tells the scorer — the manager above, or HR for someone without one — and never the person", async () => {
    const [tam] = await noticesOf(ids.tam);
    expect(await noticesOf(ids.tam)).toHaveLength(2);
    expect(tam.params).toMatchObject({ period: MONTH });
    expect(await noticesOf(ids.hr)).toHaveLength(1);
    expect(await noticesOf(ids.huy)).toHaveLength(0);
    expect(await noticesOf(ids.lan)).toHaveLength(0);
  });
});

describe("a proposal is never scored until a person decides", () => {
  it("reads as missing on the scorecard and blocks the close like an empty line", async () => {
    const card = await getScorecard(ids.huy, MONTH);
    expect(card.trace.lines.every((line) => line.actualValue === null)).toBe(true);
    expect(card.missing).toBe(3);
    expect(card.trace.scoreBp).toBeNull();
    expect((await closeBlockers(ids.szm, MONTH)).map((blocker) => blocker.kpiCode).sort()).toEqual(["ACCEPTED", "CSAT", "ON_TIME", "ON_TIME"]);
    expect(await fails(closeMonth(ids.hr, { entityId: ids.szm, month: MONTH, overrideReason: null }, "2027-05-10"))).toBe("kpi_month_blocked");
  });

  it("shows the scorer what was proposed, beside an empty box", async () => {
    const tam: Principal = { personId: ids.tam, workforceType: "employee", grants: [] };
    const [huy] = await getEntryGrid({ principal: tam, personId: ids.tam }, MONTH);
    expect(huy.personId).toBe(ids.huy);
    expect(huy.proposals).toEqual({ [ids.huyOnTime]: 8750, [ids.huyOutput]: 700 });
    expect(huy.lines.find((line) => line.assignmentId === ids.huyOnTime)?.actualValue).toBeNull();
  });

  it("is confirmed by the scorer as proposed (source stays work) or corrected (source manual)", async () => {
    await saveActuals(ids.tam, [entry(ids.huyOnTime, "87,5"), entry(ids.huyOutput, "6"), entry(ids.huyManual, "4")], "manual");
    expect(await actualOf(ids.huyOnTime)).toMatchObject({ status: "confirmed", source: "work", actualValue: 8750, proposedValue: 8750, enteredByPersonId: ids.tam });
    expect(await actualOf(ids.huyOutput)).toMatchObject({ status: "confirmed", source: "manual", actualValue: 600, proposedValue: 700 });
    const card = await getScorecard(ids.huy, MONTH);
    expect(card.missing).toBe(0);
    expect(card.trace.scoreBp).not.toBeNull();
  });

  it("stays dismissed when the scorer turns it down, however often the grid is saved", async () => {
    await saveActuals(ids.hr, [entry(ids.lanOnTime, null)], "manual");
    expect(await actualOf(ids.lanOnTime)).toMatchObject({ status: "dismissed", actualValue: null, proposedValue: 9500 });
    await saveActuals(ids.hr, [entry(ids.lanOnTime, null)], "manual");
    expect(await actualOf(ids.lanOnTime)).toMatchObject({ status: "dismissed" });
    // Nothing waits: the job will not propose it again.
    expect(await listWorkKpiDue(MONTH)).toEqual([]);
    expect((await getScorecard(ids.lan, MONTH)).missing).toBe(1);
  });

  it("is never the person's own to confirm", async () => {
    const person = (await loadDirectory()).get(ids.huy)!;
    expect(canEnterActualsFor({ personId: ids.huy, workforceType: "employee", grants: [{ role: "owner", scope: { type: "group" } }] }, person)).toBe(false);
    expect(canEnterActualsFor({ personId: ids.tam, workforceType: "employee", grants: [] }, person)).toBe(true);
  });

  it("leaves a closed month alone", async () => {
    await saveActuals(ids.hr, [entry(ids.lanOnTime, "95")], "manual");
    await closeMonth(ids.hr, { entityId: ids.szm, month: MONTH, overrideReason: null }, "2027-05-10");
    await db().delete(schema.kpiActual).where(eq(schema.kpiActual.assignmentId, ids.lanOnTime));
    // The row is gone, but the month is closed: nothing is listed to propose.
    expect(await listWorkKpiDue(MONTH)).toEqual([]);
  });
});
