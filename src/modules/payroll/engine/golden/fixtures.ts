// Loading and completing the golden payroll cases. Pure; used only by `golden.test.ts`.
//
// A fixture is a JSON file in this folder. It says only what makes its case different — the
// statutory snapshot, the component catalogue and the pay policy come from what `pnpm db:seed`
// actually seeds, so a fixture cannot drift away from the values the running system uses. Add a
// case by dropping a file in; nothing here has to change. See README.md.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DEFAULT_PAYROLL_POLICY, payrollPolicySchema, salaryTermsSchema } from "../../enums";
import { payComponentSeedRows } from "../../seed-components";
import { STATUTORY_SEED } from "@/modules/platform/statutory/seed-values";
import type { ComponentDefinition } from "../components";
import { payPeriodOf } from "../period";
import { isRoundingRule } from "../rounding";
import { STATUTORY_KEYS, type PersonPayInput, type StatutoryParams } from "../types";

// ── The seeded world a fixture starts from ──────────────────────────────────────────────────

/**
 * The statutory snapshot as `pnpm db:seed` seeds it, on `date`. Built from the same
 * `STATUTORY_SEED` the database gets, so when the chief accountant corrects a value the golden
 * cases fail until their arithmetic is redone — which is the point.
 */
export function seededStatutory(date: string): StatutoryParams {
  const params: Record<string, unknown> = {};
  for (const [name, key] of Object.entries(STATUTORY_KEYS)) {
    const versions = STATUTORY_SEED.filter((seed) => seed.key === key && seed.validFrom <= date).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
    const chosen = versions.at(-1);
    if (!chosen) throw new Error(`no seeded statutory value for ${key} on ${date}`);
    params[name] = chosen.value;
  }
  return params as StatutoryParams;
}

/** The starter pay component catalogue, as the engine sees it. */
export function seededComponents(): ComponentDefinition[] {
  return payComponentSeedRows().map((row) => {
    if (!isRoundingRule(row.roundingRule)) throw new Error(`seeded component ${row.code} has an unknown rounding rule`);
    return {
      versionId: `seed:${row.code}`,
      code: row.code,
      name: row.name,
      kind: row.kind,
      category: row.category,
      source: row.source,
      taxTreatment: row.taxTreatment,
      exemptCap: row.exemptCap,
      subjectToInsurance: row.subjectToInsurance,
      proration: row.proration,
      roundingRule: row.roundingRule,
      formula: row.formula,
      sortOrder: row.sortOrder,
    };
  });
}

// ── The fixture file ────────────────────────────────────────────────────────────────────────

const money = z.number().int();
const overtimeSide = z.object({ day: z.number().int().nonnegative().default(0), night: z.number().int().nonnegative().default(0) });
const overtimeShape = z.object({ weekday: overtimeSide.prefault({}), restDay: overtimeSide.prefault({}), holiday: overtimeSide.prefault({}) });

const fixtureSchema = z.object({
  name: z.string().min(1),
  /** "synthetic — …" until a real, anonymised case replaces it. */
  source: z.string().min(1),
  requirements: z.array(z.string()).default([]),
  /** The arithmetic, line by line, as a person did it by hand. Read by humans, not by the test. */
  derivation: z.array(z.string()).min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  /** Working days the month asks of a full-time person — the divisor. */
  monthStandardDays: z.number().int().positive(),
  wageRegion: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).default(1),
  policy: payrollPolicySchema.partial().prefault({}),
  profile: z
    .object({
      profile: z.enum(["statutory", "simple"]).default("statutory"),
      taxResidency: z.enum(["resident", "non_resident"]).default("resident"),
      pitMethod: z.enum(["progressive", "flat_without_contract", "flat_non_resident"]).default("progressive"),
      pitCommitment: z.boolean().default(false),
      insuranceExemption: z.enum(["probation", "retiree", "insured_elsewhere", "foreigner", "other"]).nullable().default(null),
      unionMember: z.boolean().default(false),
    })
    .prefault({}),
  employment: z
    .object({
      startDate: z.string().nullable().default(null),
      endDate: z.string().nullable().default(null),
      dependents: z.number().int().nonnegative().default(0),
      serviceMonths: z.number().int().nonnegative().default(12),
      kpiScoreBp: z.number().int().nonnegative().default(0),
    })
    .prefault({}),
  segments: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        terms: salaryTermsSchema,
        standardDays: z.number().int().nonnegative(),
        paidDaysCenti: z.number().int().nonnegative(),
        unpaidDaysCenti: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1),
  timesheet: z
    .object({
      standardDays: z.number().int().nonnegative(),
      standardMinutes: z.number().int().nonnegative().default(0),
      paidDaysCenti: z.number().int().nonnegative(),
      unpaidDaysCenti: z.number().int().nonnegative().default(0),
      workedMinutes: z.number().int().nonnegative().default(0),
      nightMinutes: z.number().int().nonnegative().default(0),
      overtime: overtimeShape.prefault({}),
    })
    .prefault({ standardDays: 0, paidDaysCenti: 0 }),
  insuranceLeaveDays: z.number().int().nonnegative().default(0),
  unpaidWorkingDays: z.number().int().nonnegative().default(0),
  inputs: z.array(z.object({ code: z.string(), amount: money, note: z.string().nullable().default(null) })).default([]),
  /** Differences from months already paid, carried into this run (FR-PAY-17). */
  retro: z
    .array(
      z.object({
        sourceMonth: z.string().regex(/^\d{4}-\d{2}$/),
        amount: money,
        kind: z.enum(["salary_change", "timesheet_adjustment", "manual"]).default("manual"),
        reason: z.string().nullable().default(null),
        insuranceBaseChanged: z.boolean().default(false),
      }),
    )
    .default([]),
  /** An off-cycle run: what the month's regular run already taxed and withheld (FR-PAY-19). */
  priorInMonth: z
    .object({ runId: z.string().nullable().default(null), taxableIncome: money, employeeInsurance: money.default(0), otherDeductions: money.default(0), tax: money })
    .nullable()
    .default(null),
  runKind: z.enum(["regular", "off_cycle"]).default("regular"),
  otherPitDeductions: z.number().int().nonnegative().default(0),
  /** What the case must produce. Only the keys given are checked, so a case can be narrow. */
  expect: z.object({
    lines: z.record(z.string(), money).prefault({}),
    totals: z
      .object({
        grossEarnings: money.optional(),
        taxableIncome: money.optional(),
        employeeInsurance: money.optional(),
        employerInsurance: money.optional(),
        unionDues: money.optional(),
        unionFund: money.optional(),
        pit: money.optional(),
        net: money.optional(),
        employerCost: money.optional(),
      })
      .prefault({}),
    insurance: z.object({ covered: z.boolean().optional(), reason: z.string().nullable().optional(), bhxhBhytBase: money.optional(), bhtnBase: money.optional() }).prefault({}),
    pit: z.object({ method: z.string().optional(), assessableIncome: money.optional(), dependentDeduction: money.optional(), tax: money.optional() }).prefault({}),
    warnings: z.array(z.string()).optional(),
  }),
});

export type GoldenFixture = z.output<typeof fixtureSchema> & { file: string };

export const FIXTURE_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));

/** Every `.json` file beside this one, in name order. Dropping a file in adds a case. */
export function loadFixtures(directory: string = FIXTURE_DIRECTORY): GoldenFixture[] {
  const files = readdirSync(directory).filter((name) => name.endsWith(".json")).sort();
  return files.map((file) => {
    const parsed = fixtureSchema.safeParse(JSON.parse(readFileSync(join(directory, file), "utf8")));
    if (!parsed.success) throw new Error(`${file} is not a valid golden fixture:\n${z.prettifyError(parsed.error)}`);
    return { ...parsed.data, file };
  });
}

/** The fixture as the engine wants it: its own facts on top of the seeded catalogue, policy and law. */
export function toEngineInput(fixture: GoldenFixture): PersonPayInput {
  const period = payPeriodOf(fixture.month, fixture.monthStandardDays);
  return {
    personId: `golden:${fixture.file}`,
    entityId: "golden-entity",
    period,
    wageRegion: fixture.wageRegion,
    employment: fixture.employment,
    profile: fixture.profile,
    segments: fixture.segments,
    timesheet: fixture.timesheet,
    insuranceLeaveDays: fixture.insuranceLeaveDays,
    unpaidWorkingDays: fixture.unpaidWorkingDays,
    components: seededComponents(),
    inputs: fixture.inputs,
    retro: fixture.retro,
    priorInMonth: fixture.priorInMonth,
    runKind: fixture.runKind,
    otherPitDeductions: fixture.otherPitDeductions,
    policy: { ...DEFAULT_PAYROLL_POLICY, ...fixture.policy },
    statutory: seededStatutory(period.end),
  };
}
