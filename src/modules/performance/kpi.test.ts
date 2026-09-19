// KPIs against a real Postgres (PGlite): templates → assignments, who may enter what, the close
// with blockers and override, the stored score that cannot change, reopen → revision 2, the year
// figure Phase 8 reads, and the import's checks.
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
import type { ParsedRow } from "../platform/import/engine/table";
import type { Grant, Principal } from "../platform/rbac/policy";
import type { Viewer } from "./goals";
import { commitKpiActualRows, type kpiActualColumns, resolveKpiActualRows } from "./kpi-import";
import { closeBlockers, closeMonth, getKpiResults, getScorecard, hashInputs, isKpiMonthClosed, loadMonthLines, peopleOfEntries, reopenMonth, saveActuals } from "./kpi-scores";
import { getEntryGrid, getOverview, getTeamDashboard, spreadOf } from "./kpi-views";
import { applyTemplates, createAssignment, endAssignment, listAssignments, saveKpi, savePositionKpi, updateAssignment } from "./kpis";
import { loadDirectory } from "./people";
import { canEnterActualsFor } from "./policy";
import { getPerformanceResults } from "./results";

type Who = "owner" | "mai" | "bao" | "long" | "tam" | "huy" | "linh" | "chi" | "khoi";
const ids = {} as Record<Who | "szm" | "szc" | "vid" | "des" | "editor" | "designer", string>;
const viewers = {} as Record<Who, Viewer>;
const kpis = {} as Record<"onTime" | "output" | "rounds" | "csat", string>;
const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error & { details?: unknown }) => error.message);
const TODAY = "2027-05-10";
const actor = (who: Who) => ({ principal: viewers[who].principal, personId: ids[who] });
const assignmentOf = async (who: Who, code: string) => (await listAssignments({ personIds: [ids[who]] })).find((row) => row.kpi.code === code && row.fromPeriod === "2027-01")!;
const entry = (assignmentId: string, periodKey: string, actual: string | null, extra: { notApplicable?: boolean; note?: string } = {}) => ({ assignmentId, periodKey, actual, notApplicable: extra.notApplicable ?? false, note: extra.note ?? null });

beforeAll(async () => {
  await migrateTestDb();
  const [szm] = await db().insert(schema.entity).values({ code: "SZM", legalName: "Suzu Media", shortName: "Media" }).returning();
  const [szc] = await db().insert(schema.entity).values({ code: "SZC", legalName: "Suzu Creative", shortName: "Creative" }).returning();
  const [vid] = await db().insert(schema.department).values({ code: "VID", name: "Video" }).returning();
  const [des] = await db().insert(schema.department).values({ code: "DES", name: "Design" }).returning();
  const [bod] = await db().insert(schema.department).values({ code: "BOD", name: "Board" }).returning();
  const [editor] = await db().insert(schema.position).values({ name: "Dựng phim", searchName: "dung phim" }).returning();
  const [designer] = await db().insert(schema.position).values({ name: "Thiết kế", searchName: "thiet ke" }).returning();
  Object.assign(ids, { szm: szm.id, szc: szc.id, vid: vid.id, des: des.id, editor: editor.id, designer: designer.id });

  // owner → long (head of VID) → tam → huy; linh also under long; mai is group HR, bao HR of SZM; chi heads DES at SZC, khoi under chi.
  const people: [Who, string, string, Who | null, Grant["role"] | null, "group" | "entity" | "department" | null, string | null][] = [
    ["owner", szm.id, bod.id, null, "owner", "group", null],
    ["mai", szm.id, bod.id, "owner", "hr_admin", "group", null],
    ["bao", szm.id, bod.id, "mai", "hr_staff", "entity", null],
    ["long", szm.id, vid.id, "owner", "department_head", "department", null],
    ["tam", szm.id, vid.id, "long", null, null, null],
    ["huy", szm.id, vid.id, "tam", null, null, editor.id],
    ["linh", szm.id, vid.id, "long", null, null, editor.id],
    ["chi", szc.id, des.id, "owner", "department_head", "department", null],
    ["khoi", szc.id, des.id, "chi", null, null, designer.id],
  ];
  let number = 0;
  for (const [key, entityId, departmentId, manager, role, scope, positionId] of people) {
    const [row] = await db().insert(schema.person).values({ fullName: key, searchName: key, workEmail: `${key}@suzu.group`, status: "active", primaryEntityId: entityId, departmentId, managerId: manager ? ids[manager] : null }).returning();
    ids[key] = row.id;
    const grants: Grant[] = role ? [{ role, scope: scope === "group" ? { type: "group" } : scope === "entity" ? { type: "entity", id: entityId } : { type: "department", id: departmentId } }] : [];
    viewers[key] = { principal: { personId: row.id, workforceType: "employee", grants } satisfies Principal, personId: row.id };
    const [employment] = await db().insert(schema.employment).values({ personId: row.id, entityId, employeeCode: `${entityId === szm.id ? "SZM" : "SZC"}-${String(++number).padStart(4, "0")}`, startDate: "2025-01-01", seniorityDate: "2025-01-01" }).returning();
    await db().insert(schema.assignment).values({ employmentId: employment.id, workforceType: "employee", departmentId, positionId, managerId: manager ? ids[manager] : null, validFrom: "2025-01-01" });
  }

  const library = [
    ["onTime", { code: "ON_TIME", name: "Đúng hạn", unit: "percent", direction: "higher_better", frequency: "monthly" }],
    ["output", { code: "OUTPUT", name: "Sản lượng", unit: "number", direction: "higher_better", frequency: "monthly" }],
    ["rounds", { code: "ROUNDS", name: "Số vòng sửa", unit: "number", direction: "lower_better", frequency: "monthly" }],
    ["csat", { code: "CSAT", name: "Hài lòng của khách", unit: "number", direction: "higher_better", frequency: "quarterly" }],
  ] as const;
  for (const [key, input] of library) kpis[key] = (await saveKpi(null, { ...input, description: null, capBp: 12000, floorBp: 0, isActive: true })).after.id;
  await savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.onTime, weight: 40, target: "95", sortOrder: 1 });
  await savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.output, weight: 30, target: "20", sortOrder: 2 });
  await savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.rounds, weight: 10, target: "2", sortOrder: 3 });
  await savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.csat, weight: 20, target: "4,5", sortOrder: 4 });
  await savePositionKpi({ positionId: ids.designer, entityId: null, kpiId: kpis.onTime, weight: 1, target: "90", sortOrder: 1 });
});

describe("library and templates", () => {
  it("refuses a second KPI with the same code, a floor above the cap and an impossible target", async () => {
    expect(await fails(saveKpi(null, { code: "ON_TIME", name: "x", description: null, unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 12000, floorBp: 0, isActive: true }))).toBe("kpi_code_taken");
    expect(await fails(saveKpi(null, { code: "NEW", name: "x", description: null, unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 5000, floorBp: 6000, isActive: true }))).toBe("kpi_floor_above_cap");
    expect(await fails(savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.onTime, weight: 40, target: "0", sortOrder: 1 }))).toBe("target_must_be_positive");
    expect(await fails(savePositionKpi({ positionId: ids.editor, entityId: null, kpiId: kpis.onTime, weight: 40, target: "abc", sortOrder: 1 }))).toBe("kpi_bad_value");
  });

  it("applies a position's template once: a second run changes nothing", async () => {
    // HR of SZM reaches the editors (huy, linh) — not the designer at SZC.
    const first = await applyTemplates(actor("bao"), { fromPeriod: "2027-01", positionId: null, personId: null }, TODAY);
    expect(first).toMatchObject({ holders: 2, created: 8, skipped: 0 });
    expect(await listAssignments({ personIds: [ids.khoi] })).toEqual([]);
    const second = await applyTemplates(actor("bao"), { fromPeriod: "2027-01", positionId: null, personId: null }, TODAY);
    expect(second).toMatchObject({ holders: 2, created: 0, skipped: 8 });
    const huy = await listAssignments({ personIds: [ids.huy] });
    expect(huy.map((row) => [row.kpi.code, row.weight, row.targetValue, row.fromPeriod, row.toPeriod, row.sourcePositionId === ids.editor])).toEqual([
      ["CSAT", 20, 450, "2027-01", null, true],
      ["ON_TIME", 40, 9500, "2027-01", null, true],
      ["OUTPUT", 30, 2000, "2027-01", null, true],
      ["ROUNDS", 10, 200, "2027-01", null, true],
    ]);
    // Group HR reaches everyone: the designer gets his line, the editors keep theirs untouched.
    expect(await applyTemplates(actor("mai"), { fromPeriod: "2027-01", positionId: null, personId: null }, TODAY)).toMatchObject({ holders: 3, created: 1, skipped: 8 });
  });

  it("an entity's own template replaces the group's", async () => {
    await savePositionKpi({ positionId: ids.designer, entityId: ids.szm, kpiId: kpis.output, weight: 5, target: "7", sortOrder: 1 });
    const { listPositionTemplates, templateFor } = await import("./kpis");
    const templates = await listPositionTemplates();
    expect(templateFor(templates, ids.designer, ids.szm)?.lines.map((line) => line.kpi.code)).toEqual(["OUTPUT"]);
    expect(templateFor(templates, ids.designer, ids.szc)?.lines.map((line) => line.kpi.code)).toEqual(["ON_TIME"]);
    expect(templateFor(templates, ids.editor, ids.szm)?.totalWeight).toBe(100);
  });

  it("refuses two overlapping assignments of one KPI", async () => {
    expect(await fails(createAssignment(ids.mai, { personId: ids.huy, kpiId: kpis.onTime, weight: 10, target: "90", fromPeriod: "2027-06", toPeriod: null }))).toBe("kpi_assignment_overlaps");
    expect(await fails(createAssignment(ids.mai, { personId: ids.huy, kpiId: kpis.onTime, weight: 10, target: "90", fromPeriod: "2026-01", toPeriod: "2027-01" }))).toBe("kpi_assignment_overlaps");
    // Before it starts is fine.
    const earlier = await createAssignment(ids.mai, { personId: ids.huy, kpiId: kpis.onTime, weight: 10, target: "90", fromPeriod: "2026-10", toPeriod: "2026-12" });
    expect(earlier.entityId).toBe(ids.szm);
    expect(await fails(createAssignment(ids.mai, { personId: ids.huy, kpiId: kpis.onTime, weight: 10, target: "90", fromPeriod: "2026-12", toPeriod: "2026-11" }))).toBe("kpi_bad_period");
  });
});

describe("entering actuals", () => {
  it("is for the line above and HR in scope — never oneself, a colleague or another entity's HR", async () => {
    const directory = await loadDirectory();
    const may = (who: Who, about: Who) => canEnterActualsFor(viewers[who].principal, directory.get(ids[about])!);
    expect([may("tam", "huy"), may("long", "huy"), may("bao", "huy"), may("mai", "huy"), may("owner", "huy")]).toEqual([true, true, true, true, true]);
    expect([may("huy", "huy"), may("linh", "huy"), may("chi", "huy"), may("bao", "khoi"), may("bao", "bao"), may("mai", "mai")]).toEqual([false, false, false, false, false, false]);
    // The grid offers exactly those people.
    expect((await getEntryGrid(viewers.tam, "2027-01")).map((row) => row.fullName)).toEqual(["huy"]);
    expect((await getEntryGrid(viewers.long, "2027-01")).map((row) => row.fullName)).toEqual(["huy", "linh"]);
    expect(await getEntryGrid(viewers.huy, "2027-01")).toEqual([]);
    expect((await getEntryGrid(viewers.bao, "2027-01")).map((row) => row.fullName)).toEqual(["huy", "linh"]);
    expect(await peopleOfEntries(["00000000-0000-4000-8000-000000000000"])).toBeNull();
  });

  it("saves, changes and clears — with the figure on the KPI's own scale", async () => {
    const onTime = await assignmentOf("huy", "ON_TIME");
    const rounds = await assignmentOf("huy", "ROUNDS");
    const first = await saveActuals(ids.tam, [entry(onTime.id, "2027-01", "90,25"), entry(rounds.id, "2027-01", "2.5")], "manual");
    expect(first).toMatchObject({ saved: 2, cleared: 0, unchanged: 0, personIds: [ids.huy] });
    expect(first.after.map((item) => item.actualValue)).toEqual([9025, 250]);
    expect(await saveActuals(ids.tam, [entry(onTime.id, "2027-01", "90,25")], "manual")).toMatchObject({ saved: 0, unchanged: 1 });
    const changed = await saveActuals(ids.tam, [entry(onTime.id, "2027-01", "95")], "manual");
    expect([changed.before[0].actualValue, changed.after[0].actualValue]).toEqual([9025, 9500]);
    expect(await saveActuals(ids.tam, [entry(rounds.id, "2027-01", null)], "manual")).toMatchObject({ cleared: 1 });
    await saveActuals(ids.tam, [entry(rounds.id, "2027-01", "2.5")], "manual");
  });

  it("refuses what cannot be scored", async () => {
    const onTime = await assignmentOf("huy", "ON_TIME");
    const csat = await assignmentOf("huy", "CSAT");
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2027-Q1", "90")], "manual"))).toBe("kpi_wrong_period_kind");
    expect(await fails(saveActuals(ids.tam, [entry(csat.id, "2027-01", "4")], "manual"))).toBe("kpi_wrong_period_kind");
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2026-12", "90")], "manual"))).toBe("kpi_not_assigned_then");
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2027-01", "ninety")], "manual"))).toBe("kpi_bad_value");
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2027-01", null, { notApplicable: true })], "manual"))).toBe("kpi_not_applicable_needs_note");
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2027-02", "90"), entry(onTime.id, "2027-02", "91")], "manual"))).toBe("kpi_duplicate_entry");
    // All or nothing: the good line of a refused batch is not there.
    expect(await fails(saveActuals(ids.tam, [entry(onTime.id, "2027-02", "90"), entry(onTime.id, "2027-03", "x")], "manual"))).toBe("kpi_bad_value");
    expect((await loadMonthLines({ personIds: [ids.huy] }, "2027-02")).get(ids.huy)!.every((line) => line.actualValue === null)).toBe(true);
  });
});

describe("closing a month", () => {
  it("shows a provisional figure while the month is open", async () => {
    // ON_TIME 95 of 95 → 100 % (w 40); ROUNDS 2 / 2.5 → 80 % (w 10); OUTPUT missing → left out: (40 × 10000 + 10 × 8000) / 50 = 9600
    const card = await getScorecard(ids.huy, "2027-01");
    expect(card).toMatchObject({ state: "open", missing: 1, stored: null });
    expect(card.trace.scoreBp).toBe(9600);
    expect(card.trace.lines.map((line) => line.kpiCode)).toEqual(["ON_TIME", "OUTPUT", "ROUNDS"]); // the quarterly CSAT is not due in January
  });

  it("is refused while actuals are missing, then closes over them with a reason — scoring them zero", async () => {
    expect(await fails(closeMonth(ids.bao, { entityId: ids.szm, month: "2027-05", overrideReason: null }, TODAY))).toBe("kpi_month_not_over");
    const blockers = await closeBlockers(ids.szm, "2027-01");
    expect(blockers.map((item) => `${item.personName}:${item.kpiCode}`)).toEqual(["huy:OUTPUT", "linh:ON_TIME", "linh:OUTPUT", "linh:ROUNDS"]);
    const refused = await closeMonth(ids.bao, { entityId: ids.szm, month: "2027-01", overrideReason: null }, TODAY).catch((error: Error & { details?: { blockers: unknown[] } }) => error);
    expect(refused).toMatchObject({ message: "kpi_month_blocked" });
    expect((refused as { details: { blockers: unknown[] } }).details.blockers).toHaveLength(4);

    // Linh gets her figures; Huy's OUTPUT stays missing and is overridden.
    for (const [code, value] of [["ON_TIME", "76"], ["OUTPUT", "20"], ["ROUNDS", "0"]] as const) await saveActuals(ids.long, [entry((await assignmentOf("linh", code)).id, "2027-01", value)], "manual");
    const closed = await closeMonth(ids.bao, { entityId: ids.szm, month: "2027-01", overrideReason: "Chưa có số liệu sản lượng của Huy, chốt để kịp xét thưởng" }, TODAY);
    expect(closed).toMatchObject({ people: 2, scored: 2 });
    expect(closed.exceptions.map((item) => item.kpiCode)).toEqual(["OUTPUT"]);
    expect(closed.period).toMatchObject({ status: "closed", closedByPersonId: ids.bao, exceptions: [{ personId: ids.huy, kpiCode: "OUTPUT", periodKey: "2027-01" }] });
    expect(await isKpiMonthClosed(ids.szm, "2027-01")).toBe(true);
    expect(await isKpiMonthClosed(ids.szc, "2027-01")).toBe(false);

    // Huy: (40 × 10000 + 30 × 0 + 10 × 8000) / 80 = 6000. Linh: 76 / 95 = 80 %, 100 %, no revision rounds → cap 120 %: (40 × 8000 + 30 × 10000 + 10 × 12000) / 80 = 9250.
    const huy = await getScorecard(ids.huy, "2027-01");
    expect(huy).toMatchObject({ state: "closed", missing: 1, stored: { revision: 1 } });
    expect(huy.trace.scoreBp).toBe(6000);
    expect(huy.trace.lines.find((line) => line.kpiCode === "OUTPUT")).toMatchObject({ finalBp: 0, flags: ["missing"] });
    expect((await getScorecard(ids.linh, "2027-01")).trace.scoreBp).toBe(9250);
    expect(closed.averageBp).toBe(7625);
    // The hash is over the inputs the trace carries: anyone can redo it.
    expect(huy.stored!.inputsHash).toBe(hashInputs("2027-01", huy.trace.lines, "zero"));
  });

  it("nothing a closed month was computed from can change afterwards", async () => {
    const output = await assignmentOf("huy", "OUTPUT");
    expect(await fails(saveActuals(ids.tam, [entry(output.id, "2027-01", "25")], "manual"))).toBe("kpi_month_closed");
    expect(await fails(updateAssignment(output.id, { weight: 50, target: "10" }))).toBe("kpi_assignment_has_closed_months");
    expect(await fails(createAssignment(ids.mai, { personId: ids.tam, kpiId: kpis.output, weight: 1, target: "5", fromPeriod: "2027-01", toPeriod: null }))).toBe("kpi_month_closed");
    expect(await fails(applyTemplates(actor("mai"), { fromPeriod: "2026-12", positionId: ids.editor, personId: null }, TODAY))).toBe("no error"); // everything already assigned: nothing to add, nothing refused
    expect(await fails(endAssignment(output.id, "2026-12"))).toBe("kpi_bad_period");
    expect(await fails(closeMonth(ids.bao, { entityId: ids.szm, month: "2027-01", overrideReason: "again" }, TODAY))).toBe("kpi_month_already_closed");
    // The stored row itself is immutable — the database says so, whatever the code does.
    await expect(db().update(schema.kpiScore).set({ scoreBp: 10000 }).where(eq(schema.kpiScore.personId, ids.huy))).rejects.toThrow();
    await expect(db().delete(schema.kpiScore).where(eq(schema.kpiScore.personId, ids.huy))).rejects.toThrow();
    // February is open: the next month goes on as usual, and an assignment can end after the closed month.
    expect(await saveActuals(ids.tam, [entry(output.id, "2027-02", "18")], "manual")).toMatchObject({ saved: 1 });
    expect(await fails(endAssignment((await assignmentOf("huy", "ROUNDS")).id, "2027-03"))).toBe("no error");
    expect(await fails(endAssignment(output.id, "2027-01"))).toBe("kpi_actuals_after_end");
  });

  it("reopen keeps the old score as superseded and the next close writes revision 2", async () => {
    expect(await fails(reopenMonth(ids.mai, { entityId: ids.szc, month: "2027-01", reason: "x" }))).toBe("kpi_month_not_closed");
    const reopened = await reopenMonth(ids.mai, { entityId: ids.szm, month: "2027-01", reason: "Bổ sung sản lượng của Huy" });
    expect(reopened).toMatchObject({ superseded: 2, after: { status: "open", reopenedByPersonId: ids.mai, reopenReason: "Bổ sung sản lượng của Huy" } });
    // Open again: no stored figure counts, for the scorecard or for Phase 8.
    expect((await getScorecard(ids.huy, "2027-01")).state).toBe("open");
    expect((await getKpiResults({ personId: ids.huy, year: 2027 })).closedMonths).toEqual([]);

    await saveActuals(ids.tam, [entry((await assignmentOf("huy", "OUTPUT")).id, "2027-01", "18")], "manual");
    const closed = await closeMonth(ids.bao, { entityId: ids.szm, month: "2027-01", overrideReason: null }, TODAY);
    expect(closed.exceptions).toEqual([]);
    expect(closed.period.overrideReason).toBeNull();
    // (40 × 10000 + 30 × 9000 + 10 × 8000) / 80 = 9375
    const card = await getScorecard(ids.huy, "2027-01");
    expect(card).toMatchObject({ state: "closed", stored: { revision: 2 } });
    expect(card.trace.scoreBp).toBe(9375);
    expect(card.superseded.map((row) => [row.revision, row.scoreBp])).toEqual([[1, 6000]]);
    const rows = await db().select().from(schema.kpiScore).where(and(eq(schema.kpiScore.personId, ids.huy), eq(schema.kpiScore.month, "2027-01"))).orderBy(schema.kpiScore.revision);
    expect(rows.map((row) => [row.revision, row.scoreBp, row.supersededAt !== null])).toEqual([[1, 6000, true], [2, 9375, false]]);
  });
});

describe("the year, for Phase 8", () => {
  it("comes from the stored months only, quarterly lines weighing three months", async () => {
    // February: ON_TIME 85.5 of 95 → 90 %, OUTPUT 18 of 20 → 90 %, ROUNDS 2 of 2 → 100 %: (40 × 9000 + 30 × 9000 + 10 × 10000) / 80 = 9125
    await saveActuals(ids.tam, [entry((await assignmentOf("huy", "ON_TIME")).id, "2027-02", "85,5"), entry((await assignmentOf("huy", "ROUNDS")).id, "2027-02", "2")], "manual");
    for (const code of ["ON_TIME", "OUTPUT", "ROUNDS"]) await saveActuals(ids.long, [entry((await assignmentOf("linh", code)).id, "2027-02", "1", code === "ROUNDS" ? {} : {})], "manual");
    expect(await closeBlockers(ids.szm, "2027-02")).toEqual([]);
    await closeMonth(ids.bao, { entityId: ids.szm, month: "2027-02", overrideReason: null }, TODAY);
    // March carries the quarter: ON_TIME 95 → 100 %, OUTPUT n/a, ROUNDS 4 → 50 %, CSAT 4.05 of 4.5 → 90 %: (40 × 10000 + 10 × 5000 + 20 × 9000) / 70 = 9000
    await saveActuals(ids.tam, [entry((await assignmentOf("huy", "ON_TIME")).id, "2027-03", "95"), entry((await assignmentOf("huy", "OUTPUT")).id, "2027-03", null, { notApplicable: true, note: "Nghỉ phép nửa tháng" }), entry((await assignmentOf("huy", "ROUNDS")).id, "2027-03", "4"), entry((await assignmentOf("huy", "CSAT")).id, "2027-Q1", "4,05")], "manual");
    expect((await getScorecard(ids.huy, "2027-03")).trace.scoreBp).toBe(9000);

    // March is still open: the year is January and February.
    // Σ w·m·a = 40 × (10000 + 9000) + 30 × (9000 + 9000) + 10 × (8000 + 10000) = 1 480 000; Σ w·m = 160 → 9250
    const year = await getKpiResults({ personId: ids.huy, year: 2027 });
    expect(year).toMatchObject({ scoreBp: 9250, closedMonths: ["2027-01", "2027-02"], final: false });
    expect(year.openMonths).toEqual(["2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12"]);
    expect(year.months.map((month) => [month.month, month.scoreBp, month.revision])).toEqual([["2027-01", 9375, 2], ["2027-02", 9125, 1]]);

    // Changing the library afterwards changes nothing that is stored.
    await db().update(schema.kpiDefinition).set({ capBp: 10000, name: "Renamed" }).where(eq(schema.kpiDefinition.id, kpis.rounds));
    expect((await getKpiResults({ personId: ids.huy, year: 2027 })).scoreBp).toBe(9250);

    const both = await getPerformanceResults({ personId: ids.huy, year: 2027 });
    expect(both.kpi.scoreBp).toBe(9250);
    expect(both.okr.individual).toEqual({ progressBp: null, goals: [] });
    expect((await getKpiResults({ personId: ids.tam, year: 2027 }))).toMatchObject({ scoreBp: null, closedMonths: [], openMonths: [], final: false });
  });
});

describe("dashboards", () => {
  it("the manager sees the line below; the overview only whole entities in reach", async () => {
    const team = await getTeamDashboard(viewers.long, "2027-01");
    expect(team.map((row) => [row.fullName, row.kpi?.state ?? null, row.kpi?.scoreBp ?? null, row.canEnter])).toEqual([["huy", "closed", 9375, true], ["linh", "closed", 9250, true], ["tam", null, null, true]]);
    expect((await getTeamDashboard(viewers.huy, "2027-01"))).toEqual([]);
    expect((await getTeamDashboard(viewers.chi, "2027-01")).map((row) => row.fullName)).toEqual(["khoi"]);

    expect(await getOverview(viewers.long, "2027-01", ["2027-01", "2027-02"])).toBeNull();
    const szm = await getOverview(viewers.bao, "2027-01", ["2027-01", "2027-02", "2027-03"]);
    expect(szm!.entities.map((entity) => entity.code)).toEqual(["SZM"]);
    expect(szm!.entities[0]).toMatchObject({ state: "closed", spread: { people: 2, averageBp: 9313, minBp: 9250, maxBp: 9375 }, months: [{ month: "2027-01", status: "closed", overridden: false }, { month: "2027-02", status: "closed" }, { month: "2027-03", status: "open" }] });
    const all = await getOverview(viewers.owner, "2027-03", ["2027-03"]);
    expect(all!.entities.map((entity) => [entity.code, entity.state])).toEqual([["SZC", "open"], ["SZM", "open"]].sort());
    expect(spreadOf([1000, null, 3000, 2000, 4000])).toEqual({ people: 4, averageBp: 2500, minBp: 1000, medianBp: 2500, maxBp: 4000 });
  });
});

describe("import", () => {
  const row = (line: number, employeeCode: string, kpiCode: string, period: string, actual: string): ParsedRow<typeof kpiActualColumns> => ({ row: line, values: { employeeCode, kpiCode, period, actual, note: null } });
  const codeOf = async (who: Who) => (await db().select({ code: schema.employment.employeeCode }).from(schema.employment).where(eq(schema.employment.personId, ids[who])))[0].code!;

  it("reports everything wrong with a file in one go", async () => {
    const [huy, khoi, bao] = [await codeOf("huy"), await codeOf("khoi"), await codeOf("bao")];
    const user = { principal: viewers.bao.principal, person: { id: ids.bao } };
    const { problems } = await resolveKpiActualRows(
      [row(2, huy, "ON_TIME", "2027-04", "91,5"), row(3, khoi, "ON_TIME", "2027-04", "90"), row(4, "SZM-9999", "ON_TIME", "2027-04", "90"), row(5, huy, "NOPE", "2027-04", "1"), row(6, huy, "CSAT", "2027-04", "4"), row(7, huy, "ON_TIME", "2027-Q2", "90"), row(8, huy, "ON_TIME", "2027-01", "90"), row(9, huy, "ON_TIME", "2027-04", "92"), row(10, huy, "ROUNDS", "2027-04", "1"), row(11, bao, "ON_TIME", "2027-04", "90")],
      user,
    );
    expect(problems.map((problem) => [problem.row, problem.code])).toEqual([
      [3, "person_not_found"], // another entity: looks like nobody
      [4, "person_not_found"],
      [5, "kpi_unknown"],
      [6, "kpi_period_must_be_quarter"],
      [7, "kpi_period_must_be_month"],
      [8, "kpi_month_closed"],
      [9, "duplicate_in_file"],
      [10, "kpi_not_assigned"], // ended in March
      [11, "person_not_found"], // the importer's own row
    ]);
  });

  it("commits into the open month and overwrites on a re-import", async () => {
    const huy = await codeOf("huy");
    const user = { principal: viewers.bao.principal, person: { id: ids.bao } };
    const first = await db().transaction((tx) => commitKpiActualRows([row(2, huy, "ON_TIME", "2027-04", "91,5"), row(3, huy, "CSAT", "2027-Q2", "4,2")], tx as never, user));
    expect(first).toEqual({ saved: 2, unchanged: 0, people: 1 });
    const again = await db().transaction((tx) => commitKpiActualRows([row(2, huy, "ON_TIME", "2027-04", "93"), row(3, huy, "CSAT", "2027-Q2", "4,2")], tx as never, user));
    expect(again).toEqual({ saved: 1, unchanged: 1, people: 1 });
    const [actual] = await db().select().from(schema.kpiActual).where(and(eq(schema.kpiActual.personId, ids.huy), eq(schema.kpiActual.periodKey, "2027-04"), eq(schema.kpiActual.kpiId, kpis.onTime)));
    expect(actual).toMatchObject({ actualValue: 9300, source: "import", enteredByPersonId: ids.bao });
    expect(await db().select().from(schema.kpiActual).where(eq(schema.kpiActual.periodKey, "2027-Q2"))).toHaveLength(1);
  });
});
