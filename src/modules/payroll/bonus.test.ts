// The year-end bonus run against a real database (PGlite): building it from published performance
// results, the owner's adjustment, the CEO's signature freezing the KPI months behind it, and
// paying it through an off-cycle payroll run.
//
// The phase's exit criterion is checked here: from a stored line you can reach the person's KPI
// month scores, their OKR figure and their review score, and the arithmetic in between.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/env", () => ({
  env: () => ({ allowedWorkspaceDomains: ["suzu.vn", "suzu.group"], bootstrapOwnerEmails: [], BETTER_AUTH_URL: "https://suzu.one", DATA_ENCRYPTION_KEYS: `k1:${Buffer.alloc(32, 7).toString("base64")}`, DATA_BLIND_INDEX_KEY: Buffer.alloc(32, 9).toString("base64") }),
}));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
}));

import { eq } from "drizzle-orm";
import { fieldCipher } from "@/lib/crypto";
import { db, schema } from "@/lib/db";
import { hirePerson } from "@/modules/core-hr/service";
import { DEFAULT_PERFORMANCE_WEIGHTING, finalResult, isMonthConsumed, isYearConsumed, reopenMonth } from "@/modules/performance/service";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import { migrateTestDb } from "../../../tests/helpers/db";
import { bonusHandoffState, createBonusRun, getBonusCost, getBonusLine, listBonusHandoffs, listBonusLines, listBonusRunEvents, overrideBonusLine, payBonusRun, simulateBonusRun, simulateWhatIf, stepBonusRun } from "./bonus";
import { bonusSchemeIssues, checkBonusSchemeValue, decideBonusScheme, getBonusScheme, proposeBonusScheme } from "./bonus-schemes";
import { DEFAULT_BONUS_SCHEME, DEFAULT_PAYROLL_POLICY } from "./enums";
import { salaryTermsContext } from "./field-contexts";
import { cancelRun, listRunInputs } from "./runs";
import { payComponentSeedRows } from "./seed-components";

const ids = {} as Record<"entity" | "actor" | "owner" | "star" | "steady" | "newcomer" | "partner", string>;

/** A write the database itself refuses. The driver wraps the trigger's message in the cause. */
async function refused(query: Promise<unknown>, reason: RegExp): Promise<void> {
  const error = await query.then(() => null).catch((thrown: unknown) => thrown);
  expect(error, "the write should have been refused").not.toBeNull();
  expect(String((error as { cause?: unknown })?.cause ?? error)).toMatch(reason);
}
const YEAR = 2026;

async function addStructure(personId: string, entityId: string, validFrom: string, baseSalary: number) {
  const [employment] = await db().select().from(schema.employment).where(eq(schema.employment.personId, personId)).limit(1);
  const id = crypto.randomUUID();
  const terms = { baseSalary, insuranceSalary: baseSalary, allowances: [] };
  await db().insert(schema.salaryStructure).values({ id, personId, employmentId: employment.id, entityId, validFrom, reason: "initial", termsEnc: fieldCipher().encrypt(JSON.stringify(terms), salaryTermsContext(id)) });
}

/** A closed KPI month with a stored score — the immutable snapshot the bonus is computed from. */
async function storeKpiScore(personId: string, month: string, scoreBp: number) {
  const [row] = await db()
    .insert(schema.kpiScore)
    .values({
      personId,
      entityId: ids.entity,
      month,
      revision: 1,
      scoreBp,
      inputsHash: `hash-${personId}-${month}`,
      trace: { version: 1, month, missingAs: "zero", lines: [], totalWeight: 1, scoreBp, notes: [] },
    })
    .returning();
  return row.id;
}

/** A settled (locked) performance result, computed by the real engine so the trace is genuine. */
async function storeResult(personId: string, figures: { reviewScoreBp: number | null; kpiScoreBp: number | null; okrProgressBp: number | null }, kpiScoreIds: string[], weightingVersionId: string) {
  const okrLevels = { individual: { progressBp: figures.okrProgressBp, goals: figures.okrProgressBp === null ? 0 : 2 }, team: { progressBp: null, goals: 0 }, department: { progressBp: null, goals: 0 }, entity: { progressBp: 9_500, goals: 1 }, group: { progressBp: null, goals: 0 } };
  const trace = finalResult({ reviewScoreBp: figures.reviewScoreBp, kpiScoreBp: figures.kpiScoreBp, okr: okrLevels, weightingVersionId }, DEFAULT_PERFORMANCE_WEIGHTING);
  const [row] = await db()
    .insert(schema.performanceResult)
    .values({
      personId,
      entityId: ids.entity,
      year: YEAR,
      weightingVersionId,
      reviewScoreBp: figures.reviewScoreBp,
      kpiScoreBp: figures.kpiScoreBp,
      okrScoreBp: trace.okr.scoreBp,
      computedScoreBp: trace.computedScoreBp,
      computedBand: trace.computedBand?.key ?? null,
      finalScoreBp: trace.finalScoreBp,
      finalBand: trace.finalBand?.key ?? null,
      multiplierBp: trace.multiplierBp,
      trace,
      kpiScoreIds,
      goalIds: [],
      status: "locked",
      lockedAt: new Date(),
    })
    .returning();
  return row;
}

beforeAll(async () => {
  await migrateTestDb();
  const [entity] = await db().insert(schema.entity).values({ code: "SZM", legalName: "SuZu Media", shortName: "Media", wageRegion: 1 }).returning();
  const [department] = await db().insert(schema.orgUnit).values({ code: "VID", name: "Video" }).returning();
  const [actor] = await db().insert(schema.person).values({ fullName: "Seed Actor", searchName: "seed actor", status: "offboarded" }).returning();
  ids.entity = entity.id;
  ids.actor = actor.id;

  const hire = async (name: string, startDate: string, workforceType: "employee" | "collaborator" = "employee") => {
    const { person } = await hirePerson(
      {
        fullName: name,
        workEmail: `${name.toLowerCase().replace(/\s+/g, ".")}@suzu.group`,
        profile: { dateOfBirth: null, gender: null, maritalStatus: null, nationality: null, phone: null, personalEmail: null, permanentAddress: null, currentAddress: null },
        entityId: entity.id,
        employeeCode: null,
        startDate,
        seniorityDate: null,
        placement: { workforceType, branchId: null, orgUnitId: department.id, positionName: null, seniorityLevel: null, positionLevel: null, managerId: null, dottedManagerId: null, workLocation: null },
      },
      actor.id,
      { onboarding: false },
    );
    return person.id;
  };
  // A star, a steady performer, somebody who joined in November, and a collaborator.
  ids.star = await hire("Le Minh Star", "2023-01-09");
  ids.steady = await hire("Tran Thi Steady", "2022-05-02");
  ids.newcomer = await hire("Pham Van Newcomer", "2026-11-02");
  ids.partner = await hire("Do Thi Partner", "2021-03-01", "collaborator");
  ids.owner = actor.id;

  await db().insert(schema.statutoryParameter).values(STATUTORY_SEED.map((seed) => ({ key: seed.key, value: seed.value, validFrom: seed.validFrom, status: "approved" as const, legalReference: seed.legalReference, note: seed.note ?? null })));
  await db().insert(schema.payComponent).values(payComponentSeedRows());
  await db().insert(schema.payrollPolicy).values({ entityId: null, value: DEFAULT_PAYROLL_POLICY, validFrom: "2026-01-01", status: "approved" });

  const employments = await db().select().from(schema.employment);
  const employmentOf = (personId: string) => employments.find((row) => row.personId === personId)!.id;
  await db()
    .insert(schema.payProfile)
    .values([ids.star, ids.steady, ids.newcomer, ids.partner].map((personId) => ({ personId, employmentId: employmentOf(personId), entityId: entity.id, profile: "statutory" as const, validFrom: "2021-01-01", status: "approved" as const })));

  await addStructure(ids.star, entity.id, "2023-01-09", 30_000_000);
  await addStructure(ids.steady, entity.id, "2022-05-02", 20_000_000);
  await addStructure(ids.newcomer, entity.id, "2026-11-02", 15_000_000);
  await addStructure(ids.partner, entity.id, "2021-03-01", 25_000_000);

  const [weighting] = await db().insert(schema.performanceWeighting).values({ entityId: null, value: DEFAULT_PERFORMANCE_WEIGHTING, validFrom: "2026-01-01", status: "approved" }).returning();

  // Twelve closed KPI months each for the two long-serving people.
  const starScores: string[] = [];
  const steadyScores: string[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const key = `${YEAR}-${String(month).padStart(2, "0")}`;
    await db().insert(schema.kpiPeriod).values({ entityId: entity.id, month: key, status: "closed", closedAt: new Date(), closedByPersonId: actor.id });
    starScores.push(await storeKpiScore(ids.star, key, 12_000));
    steadyScores.push(await storeKpiScore(ids.steady, key, 8_500));
  }

  // A closed month of the year before, which this run has nothing to do with: the freeze must be
  // targeted at the months that were paid from, not at the entity's KPI history as a whole.
  await db().insert(schema.kpiPeriod).values({ entityId: entity.id, month: "2025-12", status: "closed", closedAt: new Date(), closedByPersonId: actor.id });
  await storeKpiScore(ids.star, "2025-12", 9_000);

  await storeResult(ids.star, { reviewScoreBp: 11_500, kpiScoreBp: 12_000, okrProgressBp: 11_000 }, starScores, weighting.id);
  await storeResult(ids.steady, { reviewScoreBp: 8_000, kpiScoreBp: 8_500, okrProgressBp: 8_500 }, steadyScores, weighting.id);
  await storeResult(ids.partner, { reviewScoreBp: 10_500, kpiScoreBp: 10_000, okrProgressBp: 10_000 }, [], weighting.id);
  // The newcomer has no settled result at all.

  const proposed = await proposeBonusScheme({ entityId: null, value: DEFAULT_BONUS_SCHEME, validFrom: "2026-01-01", note: null }, actor.id);
  await decideBonusScheme(proposed.id, "approve", actor.id);
});

describe("the bonus scheme is configuration with a history", () => {
  it("resolves the version in force at the end of the bonus year", async () => {
    const scheme = await getBonusScheme(ids.entity, `${YEAR}-12-31`);
    expect(scheme.value.payComponentCode).toBe("THIRTEENTH_MONTH");
    expect(scheme.validFrom).toBe("2026-01-01");
  });

  it("says which field of a scheme is wrong, not only that something is", () => {
    // The editor is raw JSON: each problem carries the path to the field and a message key.
    expect(bonusSchemeIssues(DEFAULT_BONUS_SCHEME)).toEqual([]);

    const noBottomBand = { ...DEFAULT_BONUS_SCHEME, serviceBands: DEFAULT_BONUS_SCHEME.serviceBands.filter((band) => band.minMonths !== 0) };
    expect(bonusSchemeIssues(noBottomBand)).toEqual([{ path: "serviceBands", code: "no_bottom_service_band" }]);

    const twoAlike = { ...DEFAULT_BONUS_SCHEME, performanceMultiplier: { ...DEFAULT_BONUS_SCHEME.performanceMultiplier, bands: [...DEFAULT_BONUS_SCHEME.performanceMultiplier.bands, { key: "meets", label: "Đạt (lần hai)", minScoreBp: 9_000, multiplierBp: 11_000 }] } };
    expect(bonusSchemeIssues(twoAlike)).toEqual([{ path: "performanceMultiplier.bands", code: "duplicate_performance_band" }]);

    const badFigure = { ...DEFAULT_BONUS_SCHEME, serviceBands: DEFAULT_BONUS_SCHEME.serviceBands.map((band, index) => (index === 2 ? { ...band, factorBp: -1 } : band)), referenceDay: "31/12" };
    expect(bonusSchemeIssues(badFigure).map((issue) => issue.path).sort()).toEqual(["referenceDay", "serviceBands.2.factorBp"]);
    expect(() => checkBonusSchemeValue(badFigure)).toThrow("bonus_scheme_invalid");
    const thrown = (() => {
      try {
        checkBonusSchemeValue(noBottomBand);
      } catch (error) {
        return error as { details?: { issues: { path: string; code: string }[] } };
      }
    })();
    expect(thrown?.details?.issues).toEqual([{ path: "serviceBands", code: "no_bottom_service_band" }]);
  });

  it("refuses a second approved version starting on the same day", async () => {
    const clash = await proposeBonusScheme({ entityId: null, value: DEFAULT_BONUS_SCHEME, validFrom: "2026-01-01", note: null }, ids.actor);
    await expect(decideBonusScheme(clash.id, "approve", ids.actor)).rejects.toThrow("rule_version_exists");
  });
});

describe("building and simulating a run", () => {
  it("costs the whole group before anything is committed", async () => {
    const run = await createBonusRun({ year: YEAR, name: "Thưởng cuối năm 2026", entityIds: [ids.entity], payrollMonth: "2027-01" }, ids.actor);
    const { run: simulated, cost } = await simulateBonusRun(run.id, ids.actor);

    expect(simulated.status).toBe("simulated");
    expect(cost.totals.headcount).toBe(4);
    // The star and the steady performer qualify; the newcomer and the collaborator do not.
    expect(cost.totals.eligible).toBe(2);
    expect(cost.byEntity).toHaveLength(1);
    expect(cost.byEntity[0].totals.totalVnd).toBe(cost.totals.totalVnd);
  });

  it("explains the star's amount back to their KPI months, OKR figure and review", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const line = await getBonusLine(run.id, ids.star);
    expect(line).not.toBeNull();
    const { trace, row } = line!;

    // Provenance: the exact stored month scores, and the settled result they rolled up into.
    expect(row.kpiScoreIds).toHaveLength(12);
    expect(row.resultId).not.toBeNull();
    const scores = await db().select().from(schema.kpiScore).where(eq(schema.kpiScore.personId, ids.star));
    expect(row.kpiScoreIds.every((id) => scores.some((score) => score.id === id))).toBe(true);

    // The three figures the band came from are on the trace itself.
    expect(trace.performance.kpiScoreBp).toBe(12_000);
    expect(trace.performance.reviewScoreBp).toBe(11_500);
    expect(trace.performance.okrScoreBp).not.toBeNull();
    expect(trace.performance.bandKey).toBe("outstanding");
    expect(trace.performance.multiplierBp).toBe(15_000);

    // 30.000.000 × 1,0000 (full year) × 1,5000 (outstanding) × 1,0000 (entity on target).
    expect(trace.service.factorBp).toBe(10_000);
    expect(trace.unitOkr.multiplierBp).toBe(10_000);
    expect(trace.combinedMultiplierBp).toBe(15_000);
    expect(trace.computedAmountVnd).toBe(45_000_000);

    // And the arithmetic reads back in order, ending at what is actually paid.
    expect(trace.steps.map((step) => step.key)).toEqual(["base", "service", "performance", "unit_okr"]);
    expect(trace.steps.at(-1)!.valueVnd).toBe(trace.finalAmountVnd);
  });

  it("keeps the people it pays nothing, each with the reason on their line", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const newcomer = await getBonusLine(run.id, ids.newcomer);
    const partner = await getBonusLine(run.id, ids.partner);

    expect(newcomer!.trace.exclusion).toBe("service_too_short");
    expect(newcomer!.trace.finalAmountVnd).toBe(0);
    expect(partner!.trace.exclusion).toBe("workforce_type");
    expect(partner!.row.eligible).toBe(false);
  });

  it("answers the what-if without storing anything", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const before = await getBonusCost(run.id);
    const generous = { ...DEFAULT_BONUS_SCHEME, performanceMultiplier: { source: "scheme_bands" as const, bands: [{ key: "all", label: "Mọi người", minScoreBp: 0, multiplierBp: 20_000 }] } };
    const simulation = await simulateWhatIf(run.id, generous);

    expect(simulation.cost.totals.totalVnd).toBeGreaterThan(before.totals.totalVnd);
    // Nothing moved: the stored run is exactly as it was.
    expect((await getBonusCost(run.id)).totals).toEqual(before.totals);
  });
});

describe("the owner's adjustment", () => {
  it("needs a reason, keeps the computed figure, and moves the total", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    await expect(overrideBonusLine({ runId: run.id, personId: ids.steady, amountVnd: 25_000_000, reason: "   " }, ids.owner)).rejects.toThrow("reason_required");

    const before = await getBonusCost(run.id);
    const { after } = await overrideBonusLine({ runId: run.id, personId: ids.steady, amountVnd: 25_000_000, reason: "Gánh mảng khách hàng lớn sau khi trưởng nhóm nghỉ" }, ids.owner);

    expect(after.override?.amountVnd).toBe(25_000_000);
    expect(after.finalAmountVnd).toBe(25_000_000);
    // The formula's own answer is still there, beside it.
    expect(after.computedAmountVnd).toBe(20_000_000);
    expect(after.notes).toContain("overridden");

    const now = await getBonusCost(run.id);
    expect(now.totals.totalVnd).toBe(before.totals.totalVnd + 5_000_000);
    expect(now.totals.overridden).toBe(1);
  });

  it("survives a rebuild: recomputing the inputs does not drop the decision", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    await simulateBonusRun(run.id, ids.actor);
    const line = await getBonusLine(run.id, ids.steady);
    expect(line!.trace.override?.reason).toContain("trưởng nhóm nghỉ");
    expect(line!.trace.finalAmountVnd).toBe(25_000_000);
  });

  it("is refused once the run has been proposed", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    await stepBonusRun(run.id, "propose", ids.actor);
    await expect(overrideBonusLine({ runId: run.id, personId: ids.steady, amountVnd: 1_000_000, reason: "quá muộn" }, ids.owner)).rejects.toThrow("bonus_run_not_editable");
    await stepBonusRun(run.id, "return", ids.actor, { comment: "xem lại phòng video" });
  });
});

describe("approval freezes the KPI months it was computed from", () => {
  it("leaves the months alone until the CEO has signed", async () => {
    expect(await isMonthConsumed(ids.entity, `${YEAR}-03`)).toBe(false);
    expect(await isYearConsumed(ids.entity, YEAR)).toBe(false);
  });

  it("refuses a reopen of a month the run has been approved off (Phase 3.5 → Phase 8)", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    await stepBonusRun(run.id, "propose", ids.actor);
    await stepBonusRun(run.id, "approve", ids.actor, { comment: "duyệt" });

    const uses = await db().select().from(schema.kpiScoreUse);
    // Twelve months each for the two people whose results the run used.
    expect(uses.length).toBe(24);
    expect(uses.every((use) => use.consumerType === "bonus_run" && use.consumerId === run.id)).toBe(true);
    expect(await isYearConsumed(ids.entity, YEAR)).toBe(true);

    await expect(reopenMonth(ids.actor, { entityId: ids.entity, month: `${YEAR}-03`, reason: "sửa lại" }, db())).rejects.toThrow("kpi_month_consumed");
  });

  it("freezes only the months it was paid from, not the entity's whole KPI history", async () => {
    // December 2025 is closed and belongs to no bonus run: HR may still take it back.
    expect(await isMonthConsumed(ids.entity, "2025-12")).toBe(false);
    const reopened = await reopenMonth(ids.actor, { entityId: ids.entity, month: "2025-12", reason: "sai số liệu quý IV" }, db());
    expect(reopened.superseded).toBe(1);
  });

  it("releases the months again if the run is sent back before it is paid", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    await stepBonusRun(run.id, "return", ids.actor, { comment: "tính lại phần thưởng nhóm" });
    expect(await db().select().from(schema.kpiScoreUse)).toHaveLength(0);
    expect(await isMonthConsumed(ids.entity, `${YEAR}-04`)).toBe(false);

    // Back up to approved for the payment test below.
    await stepBonusRun(run.id, "propose", ids.actor);
    await stepBonusRun(run.id, "approve", ids.actor, { comment: "duyệt lại" });
  });

  it("keeps every step as a signature", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const events = await listBonusRunEvents(run.id);
    expect(events.map((event) => event.toStatus)).toContain("proposed");
    expect(events.filter((event) => event.toStatus === "simulated" && event.comment).map((event) => event.comment)).toContain("xem lại phòng video");
  });
});

describe("paying it", () => {
  it("creates one off-cycle payroll run per entity, with the scheme's pay component", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const lines = await listBonusLines(run.id);
    const payable = lines.filter((line) => line.trace.finalAmountVnd > 0);

    const result = await payBonusRun(run.id, ids.actor);
    expect(result.payrollRuns).toHaveLength(1);
    expect(result.payrollRuns[0].headcount).toBe(payable.length);

    const [payrollRun] = await db().select().from(schema.payrollRun).where(eq(schema.payrollRun.id, result.payrollRuns[0].payrollRunId));
    expect(payrollRun.kind).toBe("off_cycle");
    expect(payrollRun.month).toBe("2027-01");

    // The amounts that reached payroll are the final ones, override included.
    const inputs = await listRunInputs(payrollRun.id);
    for (const line of payable) {
      expect(inputs.get(line.row.personId)).toEqual([{ code: "THIRTEENTH_MONTH", amount: line.trace.finalAmountVnd, note: String(YEAR) }]);
    }
    // Nobody is paid a zero line.
    expect(inputs.has(ids.partner)).toBe(false);
  });

  it("records which payroll run paid each line — and leaves the unpaid ones alone", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const star = await getBonusLine(run.id, ids.star);
    expect(star!.row.payrollRunId).not.toBeNull();
    // Found over HTTP: an excluded person was claiming to have been paid through the run.
    for (const personId of [ids.partner, ids.newcomer]) {
      const line = await getBonusLine(run.id, personId);
      expect({ personId, paidThrough: line!.row.payrollRunId }).toEqual({ personId, paidThrough: null });
    }
  });

  it("is safe to repeat: a second call finds the entity's payroll run and creates nothing (PAY-09)", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    const before = await db().select().from(schema.payrollRun);
    const [handoff] = await listBonusHandoffs(run.id);
    expect(handoff.entityId).toBe(ids.entity);

    const again = await payBonusRun(run.id, ids.actor);
    expect(again.payrollRuns).toEqual([{ entityId: ids.entity, payrollRunId: handoff.payrollRunId, headcount: handoff.headcount, created: false }]);
    expect(await db().select().from(schema.payrollRun)).toHaveLength(before.length);
    expect(await listBonusHandoffs(run.id)).toHaveLength(1);
  });

  it("is evidence once paid: the database itself refuses a change", async () => {
    const [run] = await db().select().from(schema.bonusRun);
    expect(run.status).toBe("paid");
    await refused(db().update(schema.bonusRun).set({ note: "sửa trộm" }).where(eq(schema.bonusRun.id, run.id)), /paid and cannot be changed/);
    await refused(db().update(schema.bonusRunLine).set({ overrideReason: "sửa trộm" }).where(eq(schema.bonusRunLine.runId, run.id)), /is paid/);
  });

  it("keeps the step log append-only", async () => {
    const [event] = await db().select().from(schema.bonusRunEvent);
    await refused(db().update(schema.bonusRunEvent).set({ comment: "sửa trộm" }).where(eq(schema.bonusRunEvent.id, event.id)), /append-only/);
    await refused(db().delete(schema.bonusRunEvent).where(eq(schema.bonusRunEvent.id, event.id)), /append-only/);
  });
});

// Inspection PAY-09: the hand-over looped over the entities with no transaction and no lock, and
// an off-cycle payroll run has no uniqueness — so a failure on the second entity, or a double
// click, left the first entity with two runs. A run over two entities shows all of it.
describe("handing a run over two entities to payroll is all-or-nothing and safe to repeat (PAY-09)", () => {
  const NEXT_YEAR = 2027;
  let second = "";
  let outsider = "";

  /** An approved run for 2027 over both entities, one person in each granted an amount by the owner. */
  async function approvedRun(payrollMonth: string) {
    const run = await createBonusRun({ year: NEXT_YEAR, name: `Thưởng Tết ${payrollMonth}`, entityIds: [ids.entity, second], payrollMonth }, ids.actor);
    await simulateBonusRun(run.id, ids.actor);
    // Nobody has a settled 2027 result, so the formula pays nothing; the owner grants two amounts.
    await overrideBonusLine({ runId: run.id, personId: ids.star, amountVnd: 10_000_000, reason: "Thưởng Tết theo quyết định của chủ sở hữu" }, ids.owner);
    await overrideBonusLine({ runId: run.id, personId: outsider, amountVnd: 8_000_000, reason: "Thưởng Tết theo quyết định của chủ sở hữu" }, ids.owner);
    await stepBonusRun(run.id, "propose", ids.actor);
    await stepBonusRun(run.id, "approve", ids.actor, { comment: "duyệt" });
    return run.id;
  }
  const offCycleRuns = async (month: string) => (await db().select().from(schema.payrollRun)).filter((run) => run.kind === "off_cycle" && run.month === month);
  const stateOf = async (runId: string) => {
    const [run] = await db().select().from(schema.bonusRun).where(eq(schema.bonusRun.id, runId));
    const lines = await listBonusLines(runId);
    return bonusHandoffState(run, lines.map((line) => ({ entityId: line.row.entityId, finalAmountVnd: line.trace.finalAmountVnd })), await listBonusHandoffs(runId));
  };

  beforeAll(async () => {
    const [entity] = await db().insert(schema.entity).values({ code: "SZC", legalName: "SuZu Creative", shortName: "Creative", wageRegion: 1 }).returning();
    second = entity.id;
    const [person] = await db().insert(schema.person).values({ fullName: "Vu Thi Creative", searchName: "vu thi creative", status: "active", primaryEntityId: entity.id }).returning();
    await db().insert(schema.employment).values({ personId: person.id, entityId: entity.id, employeeCode: "SZC-1", startDate: "2024-01-01", seniorityDate: "2024-01-01" });
    outsider = person.id;
  });

  it("leaves nothing behind when the second entity fails", async () => {
    // Creative's January 2028 is already closed: its off-cycle run is refused — after Media's was made.
    await db().insert(schema.payrollRun).values({ entityId: second, month: "2028-01", kind: "regular", status: "locked" });
    const runId = await approvedRun("2028-01");

    await expect(payBonusRun(runId, ids.actor)).rejects.toThrow("payroll_period_locked");
    // Media's run went with it: no off-cycle run, no hand-over, and the bonus run is still approved.
    expect(await offCycleRuns("2028-01")).toEqual([]);
    expect(await listBonusHandoffs(runId)).toEqual([]);
    const [run] = await db().select().from(schema.bonusRun).where(eq(schema.bonusRun.id, runId));
    expect(run.status).toBe("approved");
    expect((await getBonusLine(runId, ids.star))!.row.payrollRunId).toBeNull();

    await stepBonusRun(runId, "cancel", ids.actor);
  });

  it("gives each entity exactly one payroll run, however many times it is asked", async () => {
    const runId = await approvedRun("2028-02");
    // A double click: two calls at once. The second waits for the run's row, then finds the work done.
    const [first, repeat] = await Promise.all([payBonusRun(runId, ids.actor), payBonusRun(runId, ids.actor)]);
    expect(first.payrollRuns.map((run) => [run.entityId, run.created])).toEqual([
      [ids.entity, true],
      [second, true],
    ]);
    expect(repeat.payrollRuns.map((run) => [run.entityId, run.payrollRunId, run.created])).toEqual(first.payrollRuns.map((run) => [run.entityId, run.payrollRunId, false]));
    expect(await offCycleRuns("2028-02")).toHaveLength(2);
    expect(await listBonusHandoffs(runId)).toHaveLength(2);
    // Paid once, signed once.
    expect((await listBonusRunEvents(runId)).filter((event) => event.toStatus === "paid")).toHaveLength(1);
    await expect(payBonusRun(runId, ids.actor, { entityIds: [crypto.randomUUID()] })).rejects.toThrow("bonus_entity_not_in_run");
  });

  it("shows an entity as not handed over once payroll cancels its run, and hands over that entity alone", async () => {
    const [run] = (await db().select().from(schema.bonusRun)).filter((row) => row.payrollMonth === "2028-02");
    const before = await stateOf(run.id);
    const creative = before.find((entity) => entity.entityId === second)!;
    const media = before.find((entity) => entity.entityId === ids.entity)!;
    expect(creative.payrollRunId).not.toBeNull();

    // Payroll cancels Creative's off-cycle run (it is still open for editing).
    await cancelRun(creative.payrollRunId!);
    const cancelled = await stateOf(run.id);
    expect(cancelled.find((entity) => entity.entityId === second)).toMatchObject({ payrollRunId: null, cancelledPayrollRunId: creative.payrollRunId, payable: 1 });
    expect(cancelled.find((entity) => entity.entityId === ids.entity)!.payrollRunId).toBe(media.payrollRunId);

    // The bonus run is paid and frozen; the hand-over is repeated for that entity alone.
    const again = await payBonusRun(run.id, ids.actor, { entityIds: [second] });
    expect(again.payrollRuns).toHaveLength(1);
    expect(again.payrollRuns[0]).toMatchObject({ entityId: second, created: true });
    expect(again.payrollRuns[0].payrollRunId).not.toBe(creative.payrollRunId);

    const after = await stateOf(run.id);
    expect(after.find((entity) => entity.entityId === second)!.payrollRunId).toBe(again.payrollRuns[0].payrollRunId);
    expect(after.find((entity) => entity.entityId === ids.entity)!.payrollRunId).toBe(media.payrollRunId);
    // The line follows its entity's new run — the one thing a paid run's line may still change…
    expect((await getBonusLine(run.id, outsider))!.row.payrollRunId).toBe(again.payrollRuns[0].payrollRunId);
    expect((await getBonusLine(run.id, ids.star))!.row.payrollRunId).toBe(media.payrollRunId);
    // …and the amounts that reach the new payroll run are the ones that were approved.
    expect((await listRunInputs(again.payrollRuns[0].payrollRunId)).get(outsider)).toEqual([{ code: "THIRTEENTH_MONTH", amount: 8_000_000, note: String(NEXT_YEAR) }]);
    await refused(db().update(schema.bonusRunLine).set({ overrideReason: "sửa trộm", payrollRunId: media.payrollRunId }).where(eq(schema.bonusRunLine.runId, run.id)), /is paid/);

    // Asked once more for everything: both entities have a standing run, nothing is created.
    const settled = await payBonusRun(run.id, ids.actor);
    expect(settled.payrollRuns.map((entity) => entity.created)).toEqual([false, false]);
    expect((await offCycleRuns("2028-02")).filter((row) => row.status !== "cancelled")).toHaveLength(2);
  });
});
