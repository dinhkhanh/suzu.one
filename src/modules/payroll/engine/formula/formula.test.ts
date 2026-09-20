import { describe, expect, it } from "vitest";
import { checkFormula, computeFormula, evaluateFormula, FORMULA_LIMITS, FormulaError, type FormulaErrorCode, parseFormula, variablesOf } from "./index";
import { allowedFormulaVariables, componentVariable } from "./variables";

const evaluate = (source: string, values: Record<string, number> = {}) => computeFormula(source, values);
const codeOf = (work: () => unknown): FormulaErrorCode | "no error" => {
  try {
    work();
    return "no error";
  } catch (error) {
    if (error instanceof FormulaError) return error.code;
    throw error;
  }
};

describe("formula language: arithmetic", () => {
  it("follows precedence and associativity", () => {
    expect(evaluate("1 + 2 * 3")).toBe(7);
    expect(evaluate("(1 + 2) * 3")).toBe(9);
    expect(evaluate("10 - 3 - 2")).toBe(5);
    expect(evaluate("-2 * -3")).toBe(6);
    expect(evaluate("--5")).toBe(5);
    expect(evaluate("1_000_000 * 2")).toBe(2_000_000);
  });

  it("divides only through a function that says how it rounds", () => {
    expect(evaluate("div_half_up(5, 2)")).toBe(3);
    expect(evaluate("div_down(5, 2)")).toBe(2);
    expect(evaluate("div_up(5, 2)")).toBe(3);
    expect(evaluate("div_half_up(-5, 2)")).toBe(-3);
    expect(codeOf(() => evaluate("5 / 2"))).toBe("division_operator");
  });

  it("has min, max, abs, clamp, pct and rounding to a step", () => {
    expect(evaluate("min(3, 1, 2)")).toBe(1);
    expect(evaluate("max(3, 1, 2)")).toBe(3);
    expect(evaluate("abs(-7)")).toBe(7);
    expect(evaluate("clamp(15, 0, 10)")).toBe(10);
    expect(evaluate("clamp(-1, 0, 10)")).toBe(0);
    expect(evaluate("pct(12_345_678, 150)")).toBe(185_185);
    expect(evaluate("round_half_up_to(1_234_500, 1000)")).toBe(1_235_000);
    expect(evaluate("round_down_to(1_234_999, 1000)")).toBe(1_234_000);
    expect(evaluate("round_up_to(1_234_001, 1000)")).toBe(1_235_000);
  });

  it("compares and branches", () => {
    expect(evaluate("if(3 > 2, 10, 20)")).toBe(10);
    expect(evaluate("if(3 > 2 and not (1 == 1), 10, 20)")).toBe(20);
    expect(evaluate("if(false or 2 <= 2, 1, 0)")).toBe(1);
    expect(evaluate("if(1 != 1, 1, 0)")).toBe(0);
  });

  it("reads variables: a responsibility allowance of 10% of base, pro-rated, to the thousand", () => {
    const values = { base_salary: 20_000_000, paid_days_centi: 1750, standard_days: 22 };
    // 20,000,000 × 10% = 2,000,000; × 17.5 / 22 = 1,590,909.09 → 1,590,909 → to the thousand 1,591,000
    expect(evaluate("round_half_up_to(div_half_up(pct(base_salary, 1000) * paid_days_centi, standard_days * 100), 1000)", values)).toBe(1_591_000);
  });

  it("is exact beyond what a double holds", () => {
    expect(evaluateFormula(parseFormula("a * 3 - a * 2"), new Map([["a", 9_007_199_254_740_993n]]))).toBe(9_007_199_254_740_993n);
  });
});

describe("formula language: refusals", () => {
  it.each<[string, FormulaErrorCode]>([
    ["", "empty"],
    ["   ", "empty"],
    ["1.5", "decimal_not_allowed"],
    ["1e9", "decimal_not_allowed"],
    ["1 +", "unexpected_end"],
    ["(1 + 2", "unexpected_end"],
    ["1 2", "unexpected_token"],
    ["1 + * 2", "unexpected_token"],
    [")", "unexpected_token"],
    ["2 ** 3", "unexpected_token"],
    ["and", "unexpected_token"],
    ["nope(1)", "unknown_function"],
    ["min()", "wrong_argument_count"],
    ["abs(1, 2)", "wrong_argument_count"],
    ["if(1, 2)", "wrong_argument_count"],
    ["99999999999999999999", "overflow"],
  ])("parse %j → %s", (source, code) => {
    expect(codeOf(() => parseFormula(source))).toBe(code);
  });

  it.each<[string, FormulaErrorCode]>([
    ["salary * 2", "unknown_variable"],
    ["1 + true", "type_mismatch"],
    ["if(1, 2, 3)", "type_mismatch"],
    ["not 1", "type_mismatch"],
    ["1 < 2 < 3", "unexpected_token"],
    ["(1 < 2) == (2 < 3)", "type_mismatch"],
    ["-(1 < 2)", "type_mismatch"],
    ["1 < 2", "result_not_number"],
    ["true", "result_not_number"],
  ])("check %j → %s", (source, code) => {
    const result = checkFormula(source, ["base_salary"]);
    expect(result.ok ? "no error" : result.error.code).toBe(code);
  });

  it("reports division by zero, a missing value and overflow at run time", () => {
    expect(codeOf(() => evaluate("div_down(1, 0)"))).toBe("division_by_zero");
    expect(codeOf(() => evaluate("round_half_up_to(10, 0)"))).toBe("division_by_zero");
    expect(codeOf(() => evaluate("div_half_up(base_salary, standard_days)", { base_salary: 1, standard_days: 0 }))).toBe("division_by_zero");
    expect(codeOf(() => evaluate("base_salary"))).toBe("missing_value");
    expect(codeOf(() => evaluate("a * a * a", { a: 9_000_000_000_000 }))).toBe("overflow");
    expect(codeOf(() => computeFormula("a", { a: 1.5 }))).toBe("missing_value");
  });

  it("never puts a value into an error", () => {
    try {
      evaluate("a * a * a", { a: 9_000_000_000_123 });
    } catch (error) {
      expect(String((error as Error).message)).not.toContain("9000000000123");
      expect(JSON.stringify(error)).not.toContain("9000000000123");
    }
  });
});

describe("formula language: hostile input", () => {
  it.each(["__proto__", "_x", "$x", "a.b", "a[0]", "a['b']", '"x"', "`x`", "a;b", "a = 1", "{}", "x => x", "a ? b : c", "a\u0000b", "BASE", "ａ", "1 // comment", "a % b", "a | b", "a & b", "~a", "!a", "\\u0061"])("does not tokenize %j", (source) => {
    expect(["bad_character", "division_operator"]).toContain(codeOf(() => parseFormula(source)));
  });

  it.each(["constructor", "prototype", "tostring", "valueof", "hasownproperty", "process", "globalthis", "require", "eval", "function"])("treats %j as an unknown name, as a variable and as a function", (name) => {
    const asVariable = checkFormula(name, ["base_salary"]);
    expect(asVariable.ok ? "no error" : asVariable.error.code).toBe("unknown_variable");
    expect(codeOf(() => parseFormula(`${name}(1)`))).toBe("unknown_function");
    // Even past the static check, evaluation looks names up in a Map.
    expect(codeOf(() => evaluateFormula(parseFormula(name), new Map()))).toBe("missing_value");
  });

  it("bounds length, nesting and node count", () => {
    expect(codeOf(() => parseFormula("1+".repeat(300) + "1"))).toBe("too_long");
    expect(codeOf(() => parseFormula("(".repeat(100) + "1" + ")".repeat(100)))).toBe("too_deep");
    expect(codeOf(() => parseFormula("-".repeat(100) + "1"))).toBe("too_deep");
    expect(codeOf(() => parseFormula("not ".repeat(100) + "true"))).toBe("too_deep");
    expect(codeOf(() => parseFormula("min(".repeat(40) + "1" + ")".repeat(40)))).toBe("too_deep");
    expect(codeOf(() => parseFormula(Array.from({ length: 120 }, () => "1").join("+")))).toBe("too_many_nodes");
    expect(FORMULA_LIMITS.nodes).toBeLessThanOrEqual(200);
    // At the limit it still works.
    expect(evaluate("(".repeat(30) + "1" + ")".repeat(30))).toBe(1);
  });

  it("cannot blow up through repeated multiplication", () => {
    const source = Array.from({ length: 60 }, () => "a").join("*");
    expect(codeOf(() => evaluate(source, { a: 1_000_000 }))).toBe("overflow");
  });
});

describe("formula variables", () => {
  it("lists what a formula reads, and lets components be read as c_<code>", () => {
    expect([...variablesOf(parseFormula("max(base_salary, c_meal) + base_salary"))].sort()).toEqual(["base_salary", "c_meal"]);
    expect(componentVariable("PHONE_ALLOWANCE")).toBe("c_phone_allowance");
    const allowed = allowedFormulaVariables(["MEAL"]);
    expect(checkFormula("c_meal + base_salary", allowed).ok).toBe(true);
    expect(checkFormula("c_phone + base_salary", allowed).ok).toBe(false);
  });
});
