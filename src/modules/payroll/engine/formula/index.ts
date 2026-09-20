// The safe formula language of pay components (FR-PAY-02). Pure, no I/O.
//
//   source → tokens → AST → (check against a variable whitelist) → evaluate over integers
//
// What makes it safe: there is no `eval` and no `Function` anywhere — the evaluator is a switch
// over node kinds this file created itself. The language has no strings, no member access, no
// assignment, no loops and no way to define anything. Identifiers are lowercase words looked up
// in a Map the caller supplies (never on an object, so `constructor` is just an unknown name and
// `__proto__` does not even tokenize). Functions are a fixed table. Numbers are BigInt: no floats,
// no precision loss. There is no "/" operator on purpose — a division must say how it rounds
// (`div_half_up`, `div_down`, `div_up`). Source length, nesting depth, node count and the size of
// every intermediate value are bounded, so a formula cannot hang or exhaust the server.
//
//   expr    := or
//   or      := and ("or" and)*
//   and     := not ("and" not)*
//   not     := "not" not | compare
//   compare := sum (("==" | "!=" | "<" | "<=" | ">" | ">=") sum)?
//   sum     := product (("+" | "-") product)*
//   product := unary ("*" unary)*
//   unary   := "-" unary | primary
//   primary := NUMBER | NAME | NAME "(" (expr ("," expr)*)? ")" | "(" expr ")"
import { divideDown, divideHalfUp, divideUp } from "../rounding";

export const FORMULA_LIMITS = { sourceLength: 500, depth: 32, nodes: 200, magnitude: 10n ** 18n } as const;

export type FormulaErrorCode =
  | "too_long"
  | "empty"
  | "bad_character"
  | "decimal_not_allowed"
  | "division_operator"
  | "unexpected_token"
  | "unexpected_end"
  | "too_deep"
  | "too_many_nodes"
  | "unknown_variable"
  | "unknown_function"
  | "wrong_argument_count"
  | "type_mismatch"
  | "result_not_number"
  | "division_by_zero"
  | "overflow"
  | "missing_value";

export class FormulaError extends Error {
  constructor(
    readonly code: FormulaErrorCode,
    /** Character offset in the source, when the problem has a place. */
    readonly position: number | null = null,
    /** The offending name or symbol. Never a value: formulas run on salaries. */
    readonly subject: string | null = null,
  ) {
    super(subject ? `${code}: ${subject}` : code);
  }
}

// ── Tokens ──────────────────────────────────────────────────────────────────────────────────

type Token = { kind: "number"; value: bigint; at: number } | { kind: "name"; value: string; at: number } | { kind: "symbol"; value: string; at: number };

const SYMBOLS = ["==", "!=", "<=", ">=", "<", ">", "+", "-", "*", "(", ")", ","] as const;
const KEYWORDS = new Set(["and", "or", "not", "true", "false"]);

function tokenize(source: string): Token[] {
  if (source.length > FORMULA_LIMITS.sourceLength) throw new FormulaError("too_long");
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (char === " " || char === "\t" || char === "\n" || char === "\r") {
      at++;
      continue;
    }
    if (char >= "0" && char <= "9") {
      let end = at;
      while (end < source.length && ((source[end] >= "0" && source[end] <= "9") || source[end] === "_")) end++;
      if (source[end] === "." || source[end] === "e" || source[end] === "E") throw new FormulaError("decimal_not_allowed", end);
      const digits = source.slice(at, end).replaceAll("_", "");
      if (digits.length > 19) throw new FormulaError("overflow", at);
      tokens.push({ kind: "number", value: BigInt(digits), at });
      at = end;
      continue;
    }
    if (char >= "a" && char <= "z") {
      let end = at;
      while (end < source.length && ((source[end] >= "a" && source[end] <= "z") || (source[end] >= "0" && source[end] <= "9") || source[end] === "_")) end++;
      tokens.push({ kind: "name", value: source.slice(at, end), at });
      at = end;
      continue;
    }
    if (char === "/") throw new FormulaError("division_operator", at, "/");
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, at));
    if (!symbol) throw new FormulaError("bad_character", at, char);
    tokens.push({ kind: "symbol", value: symbol, at });
    at += symbol.length;
  }
  if (tokens.length === 0) throw new FormulaError("empty");
  return tokens;
}

// ── AST ─────────────────────────────────────────────────────────────────────────────────────

export type FormulaNode =
  | { kind: "number"; value: bigint }
  | { kind: "boolean"; value: boolean }
  | { kind: "variable"; name: string; at: number }
  | { kind: "negate"; operand: FormulaNode }
  | { kind: "not"; operand: FormulaNode; at: number }
  | { kind: "binary"; operator: "+" | "-" | "*" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "and" | "or"; left: FormulaNode; right: FormulaNode; at: number }
  | { kind: "call"; name: FunctionName; args: FormulaNode[]; at: number };

type ValueType = "number" | "boolean";

type FunctionSpec = { args: readonly ValueType[] | "numbers"; returns: ValueType; apply: (args: (bigint | boolean)[]) => bigint | boolean };

const nonZero = (value: bigint): bigint => {
  if (value === 0n) throw new FormulaError("division_by_zero");
  return value;
};
const abs = (value: bigint) => (value < 0n ? -value : value);
const n = (value: bigint | boolean) => value as bigint;

// A Map, not an object: a formula naming `constructor` or `toString` finds nothing.
const FUNCTIONS = new Map<string, FunctionSpec>([
  ["min", { args: "numbers", returns: "number", apply: (args) => args.map(n).reduce((a, b) => (b < a ? b : a)) }],
  ["max", { args: "numbers", returns: "number", apply: (args) => args.map(n).reduce((a, b) => (b > a ? b : a)) }],
  ["abs", { args: ["number"], returns: "number", apply: ([a]) => abs(n(a)) }],
  ["clamp", { args: ["number", "number", "number"], returns: "number", apply: ([value, low, high]) => (n(value) < n(low) ? n(low) : n(value) > n(high) ? n(high) : n(value)) }],
  // Both branches are evaluated by design (no side effects exist), so a division by zero in the
  // branch not taken is still reported: guard the divisor with max(…, 1) instead.
  ["if", { args: ["boolean", "number", "number"], returns: "number", apply: ([condition, then, otherwise]) => (condition ? n(then) : n(otherwise)) }],
  ["div_half_up", { args: ["number", "number"], returns: "number", apply: ([a, b]) => divideHalfUp(n(a), nonZero(n(b))) }],
  ["div_down", { args: ["number", "number"], returns: "number", apply: ([a, b]) => divideDown(n(a), nonZero(n(b))) }],
  ["div_up", { args: ["number", "number"], returns: "number", apply: ([a, b]) => divideUp(n(a), nonZero(n(b))) }],
  // amount × basis points / 10,000, halves up: pct(base_salary, 850) = 8.5% of the base salary.
  ["pct", { args: ["number", "number"], returns: "number", apply: ([amount, basisPoints]) => divideHalfUp(n(amount) * n(basisPoints), 10_000n) }],
  ["round_half_up_to", { args: ["number", "number"], returns: "number", apply: ([value, step]) => divideHalfUp(n(value), nonZero(n(step))) * n(step) }],
  ["round_down_to", { args: ["number", "number"], returns: "number", apply: ([value, step]) => divideDown(n(value), nonZero(n(step))) * n(step) }],
  ["round_up_to", { args: ["number", "number"], returns: "number", apply: ([value, step]) => divideUp(n(value), nonZero(n(step))) * n(step) }],
]);
type FunctionName = string;

export const FORMULA_FUNCTIONS: readonly string[] = [...FUNCTIONS.keys()];

// ── Parser ──────────────────────────────────────────────────────────────────────────────────

export function parseFormula(source: string): FormulaNode {
  const tokens = tokenize(source);
  let index = 0;
  let nodes = 0;

  const peek = () => tokens[index] as Token | undefined;
  const isSymbol = (value: string) => peek()?.kind === "symbol" && peek()?.value === value;
  const isKeyword = (value: string) => peek()?.kind === "name" && peek()?.value === value;
  const made = <Node extends FormulaNode>(node: Node): Node => {
    if (++nodes > FORMULA_LIMITS.nodes) throw new FormulaError("too_many_nodes");
    return node;
  };
  const expectSymbol = (value: string) => {
    const token = peek();
    if (!token) throw new FormulaError("unexpected_end");
    if (token.kind !== "symbol" || token.value !== value) throw new FormulaError("unexpected_token", token.at, String(token.value));
    index++;
  };
  const deeper = (depth: number) => {
    if (depth > FORMULA_LIMITS.depth) throw new FormulaError("too_deep", peek()?.at ?? null);
    return depth + 1;
  };

  function parseOr(depth: number): FormulaNode {
    let left = parseAnd(depth);
    while (isKeyword("or")) {
      const at = tokens[index++].at;
      left = made({ kind: "binary", operator: "or", left, right: parseAnd(depth), at });
    }
    return left;
  }
  function parseAnd(depth: number): FormulaNode {
    let left = parseNot(depth);
    while (isKeyword("and")) {
      const at = tokens[index++].at;
      left = made({ kind: "binary", operator: "and", left, right: parseNot(depth), at });
    }
    return left;
  }
  function parseNot(depth: number): FormulaNode {
    if (isKeyword("not")) {
      const at = tokens[index++].at;
      return made({ kind: "not", operand: parseNot(deeper(depth)), at });
    }
    return parseCompare(depth);
  }
  function parseCompare(depth: number): FormulaNode {
    const left = parseSum(depth);
    const token = peek();
    if (token?.kind === "symbol" && ["==", "!=", "<", "<=", ">", ">="].includes(token.value)) {
      index++;
      return made({ kind: "binary", operator: token.value as "==", left, right: parseSum(depth), at: token.at });
    }
    return left;
  }
  function parseSum(depth: number): FormulaNode {
    let left = parseProduct(depth);
    while (isSymbol("+") || isSymbol("-")) {
      const token = tokens[index++];
      left = made({ kind: "binary", operator: token.value as "+", left, right: parseProduct(depth), at: token.at });
    }
    return left;
  }
  function parseProduct(depth: number): FormulaNode {
    let left = parseUnary(depth);
    while (isSymbol("*")) {
      const at = tokens[index++].at;
      left = made({ kind: "binary", operator: "*", left, right: parseUnary(depth), at });
    }
    return left;
  }
  function parseUnary(depth: number): FormulaNode {
    if (isSymbol("-")) {
      index++;
      return made({ kind: "negate", operand: parseUnary(deeper(depth)) });
    }
    return parsePrimary(depth);
  }
  function parsePrimary(depth: number): FormulaNode {
    const token = peek();
    if (!token) throw new FormulaError("unexpected_end");
    if (token.kind === "number") {
      index++;
      return made({ kind: "number", value: token.value });
    }
    if (token.kind === "name") {
      index++;
      if (token.value === "true" || token.value === "false") return made({ kind: "boolean", value: token.value === "true" });
      if (KEYWORDS.has(token.value)) throw new FormulaError("unexpected_token", token.at, token.value);
      if (!isSymbol("(")) return made({ kind: "variable", name: token.value, at: token.at });
      index++;
      const spec = FUNCTIONS.get(token.value);
      if (!spec) throw new FormulaError("unknown_function", token.at, token.value);
      const args: FormulaNode[] = [];
      if (!isSymbol(")")) {
        do args.push(parseOr(deeper(depth)));
        while (isSymbol(",") && ++index);
      }
      expectSymbol(")");
      const wanted = spec.args === "numbers" ? null : spec.args.length;
      if (wanted === null ? args.length < 1 : args.length !== wanted) throw new FormulaError("wrong_argument_count", token.at, token.value);
      return made({ kind: "call", name: token.value, args, at: token.at });
    }
    if (token.value === "(") {
      index++;
      const inner = parseOr(deeper(depth));
      expectSymbol(")");
      return inner;
    }
    throw new FormulaError("unexpected_token", token.at, token.value);
  }

  const root = parseOr(0);
  const rest = peek();
  if (rest) throw new FormulaError("unexpected_token", rest.at, String(rest.value));
  return root;
}

// ── Static check ────────────────────────────────────────────────────────────────────────────

function typeOf(node: FormulaNode, variables: ReadonlySet<string>): ValueType {
  switch (node.kind) {
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "variable":
      if (!variables.has(node.name)) throw new FormulaError("unknown_variable", node.at, node.name);
      return "number";
    case "negate":
      if (typeOf(node.operand, variables) !== "number") throw new FormulaError("type_mismatch", null, "-");
      return "number";
    case "not":
      if (typeOf(node.operand, variables) !== "boolean") throw new FormulaError("type_mismatch", node.at, "not");
      return "boolean";
    case "binary": {
      const left = typeOf(node.left, variables);
      const right = typeOf(node.right, variables);
      const logical = node.operator === "and" || node.operator === "or";
      if (left !== (logical ? "boolean" : "number") || right !== left) throw new FormulaError("type_mismatch", node.at, node.operator);
      return logical || ["==", "!=", "<", "<=", ">", ">="].includes(node.operator) ? "boolean" : "number";
    }
    case "call": {
      const spec = FUNCTIONS.get(node.name)!;
      node.args.forEach((arg, position) => {
        const wanted = spec.args === "numbers" ? "number" : spec.args[position];
        if (typeOf(arg, variables) !== wanted) throw new FormulaError("type_mismatch", node.at, node.name);
      });
      return spec.returns;
    }
  }
}

export function variablesOf(node: FormulaNode, found = new Set<string>()): Set<string> {
  if (node.kind === "variable") found.add(node.name);
  else if (node.kind === "negate" || node.kind === "not") variablesOf(node.operand, found);
  else if (node.kind === "binary") {
    variablesOf(node.left, found);
    variablesOf(node.right, found);
  } else if (node.kind === "call") for (const arg of node.args) variablesOf(arg, found);
  return found;
}

/**
 * Save-time validation: parses, resolves every name against the whitelist, type-checks, and
 * insists on a number. Returns the variables the formula reads (stored with each result so a
 * payslip line can be reproduced).
 */
export function checkFormula(source: string, allowedVariables: Iterable<string>): { ok: true; ast: FormulaNode; variables: string[] } | { ok: false; error: FormulaError } {
  try {
    const ast = parseFormula(source);
    if (typeOf(ast, new Set(allowedVariables)) !== "number") throw new FormulaError("result_not_number");
    return { ok: true, ast, variables: [...variablesOf(ast)].sort() };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error };
    throw error;
  }
}

// ── Evaluation ──────────────────────────────────────────────────────────────────────────────

const bounded = (value: bigint): bigint => {
  if (value > FORMULA_LIMITS.magnitude || value < -FORMULA_LIMITS.magnitude) throw new FormulaError("overflow");
  return value;
};

function run(node: FormulaNode, values: ReadonlyMap<string, bigint>): bigint | boolean {
  switch (node.kind) {
    case "number":
    case "boolean":
      return node.value;
    case "variable": {
      const value = values.get(node.name);
      if (value === undefined) throw new FormulaError("missing_value", node.at, node.name);
      return bounded(value);
    }
    case "negate":
      return -n(expectType(run(node.operand, values), "bigint"));
    case "not":
      return !expectType(run(node.operand, values), "boolean");
    case "binary": {
      if (node.operator === "and" || node.operator === "or") {
        const left = expectType(run(node.left, values), "boolean") as boolean;
        const right = expectType(run(node.right, values), "boolean") as boolean;
        return node.operator === "and" ? left && right : left || right;
      }
      const left = expectType(run(node.left, values), "bigint") as bigint;
      const right = expectType(run(node.right, values), "bigint") as bigint;
      switch (node.operator) {
        case "+":
          return bounded(left + right);
        case "-":
          return bounded(left - right);
        case "*":
          return bounded(left * right);
        case "==":
          return left === right;
        case "!=":
          return left !== right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
      }
      throw new FormulaError("unexpected_token");
    }
    case "call": {
      const spec = FUNCTIONS.get(node.name);
      if (!spec) throw new FormulaError("unknown_function", node.at, node.name);
      const result = spec.apply(node.args.map((arg) => run(arg, values)));
      return typeof result === "bigint" ? bounded(result) : result;
    }
  }
}

function expectType(value: bigint | boolean, wanted: "bigint" | "boolean"): bigint | boolean {
  if (typeof value !== wanted) throw new FormulaError("type_mismatch");
  return value;
}

/** Evaluates a parsed formula. `values` is a Map on purpose; integers only. */
export function evaluateFormula(ast: FormulaNode, values: ReadonlyMap<string, bigint>): bigint {
  const result = run(ast, values);
  if (typeof result !== "bigint") throw new FormulaError("result_not_number");
  return result;
}

/** Parse + evaluate, with plain safe integers in and out — what the payroll engine calls. */
export function computeFormula(source: string, values: Readonly<Record<string, number>>): number {
  const map = new Map<string, bigint>();
  for (const name of Object.keys(values)) {
    if (!Number.isSafeInteger(values[name])) throw new FormulaError("missing_value", null, name);
    map.set(name, BigInt(values[name]));
  }
  const result = Number(evaluateFormula(parseFormula(source), map));
  if (!Number.isSafeInteger(result)) throw new FormulaError("overflow");
  return result;
}
