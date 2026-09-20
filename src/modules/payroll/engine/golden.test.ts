// The golden payroll cases (development plan, Phase 5 week 2). Every `.json` file in `golden/`
// is one person's month with the figures worked out by hand; see golden/README.md for how to add
// a real, anonymised case.
import { describe, expect, it } from "vitest";
import { calculatePerson } from "./calculate";
import { loadFixtures, toEngineInput } from "./golden/fixtures";

const fixtures = loadFixtures();

describe("golden payroll cases", () => {
  it("finds the fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(13);
  });

  for (const fixture of fixtures) {
    describe(`${fixture.file} — ${fixture.name}`, () => {
      const result = calculatePerson(toEngineInput(fixture));

      it("says where its expected figures come from", () => {
        // A case whose arithmetic nobody wrote down cannot be reviewed, and a synthetic case must
        // say it is synthetic so it is replaced rather than trusted.
        expect(fixture.derivation.join(" ").length).toBeGreaterThan(80);
        expect(fixture.source).toMatch(/synthetic|anonymised|spreadsheet|sheet|row/i);
      });

      if (Object.keys(fixture.expect.lines).length > 0) {
        it("produces each expected line", () => {
          const amounts = Object.fromEntries(result.lines.map((line) => [line.code, line.amount]));
          for (const [code, amount] of Object.entries(fixture.expect.lines)) expect({ code, amount: amounts[code] ?? 0 }).toEqual({ code, amount });
        });
      }

      for (const [key, expected] of Object.entries(fixture.expect.totals)) {
        it(`total ${key} = ${expected.toLocaleString("en-US")}`, () => {
          expect(result.totals[key as keyof typeof result.totals]).toBe(expected);
        });
      }

      for (const [key, expected] of Object.entries(fixture.expect.insurance)) {
        it(`insurance ${key}`, () => {
          expect(result.insurance[key as keyof typeof result.insurance]).toEqual(expected);
        });
      }

      for (const [key, expected] of Object.entries(fixture.expect.pit)) {
        it(`PIT ${key}`, () => {
          expect(result.pit[key as keyof typeof result.pit]).toEqual(expected);
        });
      }

      if (fixture.expect.warnings) {
        it("raises exactly the expected warnings", () => {
          expect([...result.warnings].sort()).toEqual([...fixture.expect.warnings!].sort());
        });
      }

      it("balances: gross − deductions = net, and every line is a whole đồng", () => {
        const sum = (kind: string) => result.lines.filter((line) => line.kind === kind).reduce((total, line) => total + line.amount, 0);
        expect(sum("earning")).toBe(result.totals.grossEarnings);
        expect(sum("deduction")).toBe(result.totals.totalDeductions);
        expect(result.totals.grossEarnings - result.totals.totalDeductions).toBe(result.totals.net);
        for (const line of result.lines) expect(Number.isSafeInteger(line.amount)).toBe(true);
      });

      it("is reproducible: the same input gives byte-identical output (FR-PAY-20)", () => {
        expect(JSON.stringify(calculatePerson(toEngineInput(fixture)))).toBe(JSON.stringify(result));
      });

      it("explains every line", () => {
        for (const line of result.lines) {
          expect(line.rule).not.toBe("");
          expect(Object.keys(line.inputs).length).toBeGreaterThan(0);
        }
        expect(result.trace.length).toBeGreaterThan(0);
      });
    });
  }
});
