// What a model call cost, in micro-dollars (SRS D35, FR-AGT-43). Pure.
//
// The provider bills by the token, at a price per million that depends on the model and on what
// kind of token it was: fresh input, input written to the prompt cache (for five minutes or for an
// hour), input read back from it, and output (thinking included — it is billed as output). A price
// per million dollars is a price per token in micro-dollars, so a call's cost is a sum of five
// products and stays an integer.
//
// The table is the vendor's list price on the date below, not a legal rate: it is code, dated, and
// changed by a commit when Anthropic changes it. A model the table does not know is priced as the
// dearest one it does — a budget that under-counts is a budget that does not hold.

/** USD per million tokens. `cacheWrite` is the five-minute cache, at 1.25 × input; `cacheWriteHour` the one-hour cache, at 2 × input. */
export type ModelPrice = { input: number; output: number; cacheRead: number; cacheWrite: number; cacheWriteHour: number };

export const PRICES_AS_OF = "2026-10-09";

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25, cacheWriteHour: 2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWriteHour: 4 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, cacheWriteHour: 4 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, cacheWriteHour: 6 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, cacheWriteHour: 8 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, cacheWriteHour: 10 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5, cacheWriteHour: 20 },
};

const DEAREST: ModelPrice = Object.values(PRICES).reduce((dearest, price) => (price.output > dearest.output ? price : dearest));

/** The price of a model id, with a dated snapshot suffix ("-20251001") read as its alias. */
export function priceOf(model: string): ModelPrice {
  return PRICES[model] ?? PRICES[model.replace(/-\d{8}$/u, "")] ?? DEAREST;
}

/**
 * Tokens of one call, as the provider reported them, each kind apart. `cacheWriteTokens` counts every
 * cache write; `cacheWriteHourTokens` says how many of them were for an hour (none when absent).
 */
export type ModelUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cacheWriteHourTokens?: number };

export const NO_MODEL_USAGE: ModelUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

/** A Messages API `usage` object, each kind kept as a non-negative integer. */
export function modelUsageOf(
  reported: { input_tokens?: unknown; output_tokens?: unknown; cache_creation_input_tokens?: unknown; cache_read_input_tokens?: unknown; cache_creation?: { ephemeral_1h_input_tokens?: unknown } | null } | null | undefined,
): ModelUsage {
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
  const cacheWriteTokens = count(reported?.cache_creation_input_tokens);
  const cacheWriteHourTokens = Math.min(count(reported?.cache_creation?.ephemeral_1h_input_tokens), cacheWriteTokens);
  return { inputTokens: count(reported?.input_tokens), outputTokens: count(reported?.output_tokens), cacheReadTokens: count(reported?.cache_read_input_tokens), cacheWriteTokens, ...(cacheWriteHourTokens ? { cacheWriteHourTokens } : {}) };
}

/** What a call cost, in micro-dollars (1 USD = 1,000,000), rounded up so a sum never under-counts. */
export function costMicroUsd(model: string, usage: ModelUsage): number {
  const price = priceOf(model);
  const hour = Math.min(usage.cacheWriteHourTokens ?? 0, usage.cacheWriteTokens);
  return Math.ceil(usage.inputTokens * price.input + usage.outputTokens * price.output + usage.cacheReadTokens * price.cacheRead + (usage.cacheWriteTokens - hour) * price.cacheWrite + hour * price.cacheWriteHour);
}

export const microUsdOf = (usd: number): number => Math.round(usd * 1_000_000);
export const usdOf = (microUsd: number): number => microUsd / 1_000_000;
