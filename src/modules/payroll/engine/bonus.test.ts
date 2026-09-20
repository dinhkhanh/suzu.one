// The golden year-end bonus cases (FR-PAY-21). Every `.json` file in `bonus-golden/` is one
// person's bonus with the arithmetic derived by hand in its `derivation` field; see the README
// there for how to add one. Plus the properties that must hold whatever the scheme says.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bonusForPerson, type BonusPersonInput, type BonusTrace, sumBonus } from "./bonus";
import { type BonusSchemeValue, bonusSchemeSchema, DEFAULT_BONUS_SCHEME } from "../enums";

type Expectation = Partial<{
  eligible: boolean;
  exclusion: string | null;
  serviceFactorBp: number;
  performanceMultiplierBp: number;
  unitOkrMultiplierBp: number;
  combinedMultiplierBp: number;
  capApplied: boolean;
  cappedMultiplierBp: number;
  beforeRoundingVnd: number;
  computedAmountVnd: number;
  finalAmountVnd: number;
}>;

type Fixture = { file: string; name: string; source: string; derivation: string[]; schemePatch?: Partial<BonusSchemeValue>; person: BonusPersonInput; expect: Expectation };

const DIRECTORY = join(__dirname, "bonus-golden");

function loadFixtures(): Fixture[] {
  return readdirSync(DIRECTORY)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => ({ file, ...(JSON.parse(readFileSync(join(DIRECTORY, file), "utf8")) as Omit<Fixture, "file">) }));
}

const schemeOf = (fixture: Fixture): BonusSchemeValue => bonusSchemeSchema.parse({ ...DEFAULT_BONUS_SCHEME, ...(fixture.schemePatch ?? {}) });

const fixtures = loadFixtures();

describe("golden year-end bonus cases", () => {
  it("finds the fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(13);
  });

  it("ships a starter scheme that is itself valid configuration", () => {
    expect(() => bonusSchemeSchema.parse(DEFAULT_BONUS_SCHEME)).not.toThrow();
  });

  for (const fixture of fixtures) {
    describe(`${fixture.file} — ${fixture.name}`, () => {
      const scheme = schemeOf(fixture);
      const trace = bonusForPerson(fixture.person, scheme);

      it("says where its expected figures come from", () => {
        expect(fixture.derivation.join(" ").length).toBeGreaterThan(80);
        expect(fixture.source).toMatch(/synthetic|anonymised|run|sheet/i);
      });

      const checks: [keyof Expectation, () => unknown][] = [
        ["eligible", () => trace.eligible],
        ["exclusion", () => trace.exclusion],
        ["serviceFactorBp", () => trace.service.factorBp],
        ["performanceMultiplierBp", () => trace.performance.multiplierBp],
        ["unitOkrMultiplierBp", () => trace.unitOkr.multiplierBp],
        ["combinedMultiplierBp", () => trace.combinedMultiplierBp],
        ["capApplied", () => trace.cap.applied],
        ["cappedMultiplierBp", () => trace.cap.multiplierBp],
        ["beforeRoundingVnd", () => trace.rounding.beforeVnd],
        ["computedAmountVnd", () => trace.computedAmountVnd],
        ["finalAmountVnd", () => trace.finalAmountVnd],
      ];
      for (const [key, actual] of checks) {
        if (fixture.expect[key] === undefined) continue;
        it(`${key} = ${JSON.stringify(fixture.expect[key])}`, () => {
          expect({ [key]: actual() }).toEqual({ [key]: fixture.expect[key] });
        });
      }

      it("is whole đồng, never negative, and a multiple of the rounding unit", () => {
        expect(Number.isSafeInteger(trace.computedAmountVnd)).toBe(true);
        expect(trace.computedAmountVnd).toBeGreaterThanOrEqual(0);
        expect(trace.computedAmountVnd % scheme.roundingVnd).toBe(0);
      });

      it("is reproducible: the same input gives byte-identical output", () => {
        expect(JSON.stringify(bonusForPerson(fixture.person, scheme))).toBe(JSON.stringify(trace));
      });

      it("explains itself: every step carries an expression and a running figure", () => {
        expect(trace.steps.length).toBeGreaterThan(0);
        for (const step of trace.steps) {
          expect(step.expression.trim()).not.toBe("");
          expect(Number.isSafeInteger(step.valueVnd)).toBe(true);
        }
        // The last step is always what is actually paid: the trace never ends somewhere else.
        expect(trace.steps.at(-1)!.valueVnd).toBe(trace.finalAmountVnd);
      });

      it("never hides an override: the computed figure survives beside it", () => {
        if (!trace.override) return;
        expect(trace.notes).toContain("overridden");
        expect(trace.override.reason.trim()).not.toBe("");
        expect(trace.finalAmountVnd).toBe(trace.override.amountVnd);
      });
    });
  }
});

describe("bonus engine properties", () => {
  const scheme = bonusSchemeSchema.parse(DEFAULT_BONUS_SCHEME);
  const person = (patch: Partial<BonusPersonInput>): BonusPersonInput => ({
    baseSalaryVnd: 20_000_000,
    serviceMonths: 24,
    workforceType: "employee",
    activeOnReferenceDay: true,
    unitOkrProgressBp: 9_000,
    result: { resultId: "r", finalScoreBp: 8_500, bandKey: "meets", bandMultiplierBp: 10_000, bandLabel: "Đạt", reviewScoreBp: 8_000, kpiScoreBp: 8_800, okrScoreBp: 8_200, overridden: false, overrideReason: null },
    ...patch,
  });

  it("never pays more than the cap allows", () => {
    for (const multiplierBp of [10_000, 20_000, 50_000, 120_000]) {
      const trace = bonusForPerson(person({ result: { ...person({}).result!, bandMultiplierBp: multiplierBp } }), scheme);
      expect(trace.computedAmountVnd).toBeLessThanOrEqual((20_000_000 * scheme.capMultiplierBp) / 10_000 + scheme.roundingVnd);
    }
  });

  it("is monotonic in the performance multiplier", () => {
    const amounts = [0, 5_000, 10_000, 12_500, 15_000].map((bp) => bonusForPerson(person({ result: { ...person({}).result!, bandMultiplierBp: bp } }), scheme).computedAmountVnd);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
  });

  it("is monotonic in service time", () => {
    const amounts = [0, 3, 6, 12, 36].map((months) => bonusForPerson(person({ serviceMonths: months }), scheme).computedAmountVnd);
    expect([...amounts].sort((a, b) => a - b)).toEqual(amounts);
  });

  it("an excluded person is in the run with a reason, not missing from it", () => {
    const trace = bonusForPerson(person({ workforceType: "collaborator" }), scheme);
    expect(trace.eligible).toBe(false);
    expect(trace.exclusion).toBe("workforce_type");
    expect(trace.finalAmountVnd).toBe(0);
    expect(trace.notes).toContain("excluded_workforce_type");
  });

  it("a person with no unit figure is not punished for it: the collective multiplier is neutral", () => {
    const withUnit = bonusForPerson(person({ unitOkrProgressBp: 10_500 }), scheme);
    const without = bonusForPerson(person({ unitOkrProgressBp: null }), scheme);
    expect(without.unitOkr.multiplierBp).toBe(10_000);
    expect(without.computedAmountVnd).toBeGreaterThan(0);
    expect(withUnit.computedAmountVnd).toBeGreaterThan(without.computedAmountVnd);
  });

  it("totals add the final amounts, and keep the computed ones beside them", () => {
    const traces: BonusTrace[] = [
      bonusForPerson(person({}), scheme),
      bonusForPerson(person({ override: { amountVnd: 1_000_000, reason: "vì thế", byPersonId: null, at: null } }), scheme),
      bonusForPerson(person({ workforceType: "collaborator" }), scheme),
    ];
    const totals = sumBonus(traces);
    expect(totals).toEqual({ headcount: 3, eligible: 2, excluded: 1, overridden: 1, totalVnd: traces[0].finalAmountVnd + 1_000_000, computedTotalVnd: traces[0].computedAmountVnd * 2 });
  });

  it("refuses a scheme whose bands have no floor", () => {
    expect(bonusSchemeSchema.safeParse({ ...DEFAULT_BONUS_SCHEME, serviceBands: [{ minMonths: 6, label: "x", factorBp: 10_000 }] }).success).toBe(false);
    expect(bonusSchemeSchema.safeParse({ ...DEFAULT_BONUS_SCHEME, unitOkr: { level: "entity", bands: [{ label: "x", minProgressBp: 5_000, multiplierBp: 10_000 }] } }).success).toBe(false);
  });
});
