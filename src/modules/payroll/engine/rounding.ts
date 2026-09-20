// Named rounding rules (DR-01). Money is integer VND; every place that divides says which rule it
// uses, by name, and the name is stored with the result so a payslip can be reproduced. No floats:
// ratios are BigInt numerator / denominator.

const big = (value: bigint | number): bigint => {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new RangeError(`not a safe integer: ${value}`);
  return BigInt(value);
};

/** numerator / denominator, halves away from zero (2.5 → 3, −2.5 → −3). */
export function divideHalfUp(numerator: bigint | number, denominator: bigint | number): bigint {
  const n = big(numerator);
  const d = big(denominator);
  if (d === 0n) throw new RangeError("division by zero");
  const negative = n < 0n !== d < 0n;
  const absN = n < 0n ? -n : n;
  const absD = d < 0n ? -d : d;
  const quotient = (absN * 2n + absD) / (absD * 2n);
  return negative ? -quotient : quotient;
}

/** Towards zero (2.9 → 2, −2.9 → −2). */
export function divideDown(numerator: bigint | number, denominator: bigint | number): bigint {
  const d = big(denominator);
  if (d === 0n) throw new RangeError("division by zero");
  return big(numerator) / d;
}

/** Away from zero (2.1 → 3, −2.1 → −3). */
export function divideUp(numerator: bigint | number, denominator: bigint | number): bigint {
  const n = big(numerator);
  const d = big(denominator);
  if (d === 0n) throw new RangeError("division by zero");
  const quotient = n / d;
  if (quotient * d === n) return quotient;
  return n < 0n !== d < 0n ? quotient - 1n : quotient + 1n;
}

const toStep = (divide: (n: bigint, d: bigint) => bigint, step: bigint) => (numerator: bigint | number, denominator: bigint | number) => divide(big(numerator), big(denominator) * step) * step;

/**
 * Every rule answers "numerator / denominator in VND". The default for payroll lines is
 * `half_up`: to the đồng, halves up.
 */
export const ROUNDING_RULES = {
  half_up: divideHalfUp,
  down: divideDown,
  up: divideUp,
  half_up_to_hundred: toStep(divideHalfUp, 100n),
  half_up_to_thousand: toStep(divideHalfUp, 1000n),
  down_to_thousand: toStep(divideDown, 1000n),
  up_to_thousand: toStep(divideUp, 1000n),
} as const;

export type RoundingRule = keyof typeof ROUNDING_RULES;

export const isRoundingRule = (name: string): name is RoundingRule => Object.hasOwn(ROUNDING_RULES, name);

/** amount × numerator / denominator under a named rule, as a safe integer of VND. */
export function ratio(amount: number, numerator: number | bigint, denominator: number | bigint, rule: RoundingRule): number {
  return toVnd(ROUNDING_RULES[rule](big(amount) * big(numerator), denominator));
}

/** amount × basis points / 10,000 under a named rule. */
export const percentBp = (amount: number, basisPoints: number, rule: RoundingRule): number => ratio(amount, basisPoints, 10_000, rule);

export function toVnd(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("amount out of range");
  return result;
}
