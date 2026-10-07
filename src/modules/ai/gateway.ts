// The one door to a model (SRS D35, D38, FR-AGT-40…43, NFR-AGT-03). Every driver in this module
// calls `callModel` and nothing else reaches the network, so every call is:
//
//  1. ADMITTED — the kill switch, the key, the company's month and the asker's day are checked
//     first (`spend.ts`); a refusal returns a notice, and the caller answers the free way;
//  2. SENT on the tier's model (D38) through the official SDK, with what that model accepts — effort
//     is a setting Sonnet and Opus take and Haiku 4.5 rejects;
//  3. RECORDED with its tokens and its price, answer or refusal, before anything else happens.
//
// A provider that fails — a timeout, an overloaded API, a revoked key — is a notice too, never an
// error the person has to understand (NFR-AGT-03). Nothing billed is lost: a call that failed on
// the way was not billed, and one that came back is recorded whatever it said.
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { logError } from "@/lib/observability/report";
import { NO_USAGE, type TokenUsage } from "./engine/limits";
import { modelUsageOf } from "./engine/pricing";
import type { ModelTier } from "./engine/tiers";
import { type AiNotice, admitModelCall, type ModelAsker, recordModelCall } from "./spend";

export type { ModelTier };

export function modelFor(tier: ModelTier): string {
  const settings = env();
  return tier === "simple" ? settings.ANTHROPIC_MODEL_SIMPLE : tier === "complex" ? settings.ANTHROPIC_MODEL_COMPLEX : settings.ANTHROPIC_MODEL;
}

/** Haiku 4.5 rejects `output_config.effort`; the Sonnet and Opus generations take it. */
export const takesEffort = (model: string): boolean => !/haiku/iu.test(model);

/** What the purpose of a call is, as it is written down: "ask", "draft.eod", … */
export type ModelPurpose = "ask" | "agent" | "draft.eod" | "draft.status" | "draft.handoff" | "eval";

export type ModelCall = {
  asker: ModelAsker;
  purpose: ModelPurpose;
  tier: ModelTier;
  /** The request without its model: the tier decides that. */
  request: Omit<Anthropic.MessageCreateParamsNonStreaming, "model" | "output_config">;
  /** Applied where the model takes it, ignored where it does not. */
  effort?: "low" | "medium" | "high";
  /** Structured output, when the answer must be JSON of a shape. */
  format?: Anthropic.JSONOutputFormat;
  timeoutMs: number;
  /** The agent turn this call belongs to: cost per turn is summed by it. */
  turnId?: string | null;
};

export type ModelResult = { ok: true; message: Anthropic.Message; model: string; usage: TokenUsage } | { ok: false; notice: AiNotice; usage: TokenUsage };

const totalOf = (usage: ReturnType<typeof modelUsageOf>): TokenUsage => ({ inputTokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens, outputTokens: usage.outputTokens });

export async function callModel(call: ModelCall): Promise<ModelResult> {
  const admission = await admitModelCall(call.asker);
  if (!admission.ok) return { ok: false, notice: admission.notice, usage: NO_USAGE };
  const settings = env();
  const model = modelFor(call.tier);
  const outputConfig: Anthropic.OutputConfig = { ...(call.effort && takesEffort(model) ? { effort: call.effort } : {}), ...(call.format ? { format: call.format } : {}) };
  // One retry for a dropped connection or an overloaded API, and a timeout the turn can afford.
  const client = new Anthropic({ apiKey: settings.ANTHROPIC_API_KEY, maxRetries: 1, timeout: call.timeoutMs });
  let message: Anthropic.Message;
  try {
    message = await client.messages.create({ ...call.request, model, ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}) });
  } catch (error) {
    logError(error, { event: "ai.model.failed", source: "ai", tags: { purpose: call.purpose, tier: call.tier, model, status: error instanceof Anthropic.APIError ? String(error.status ?? "") : "network" } });
    return { ok: false, notice: "provider_error", usage: NO_USAGE };
  }
  const usage = modelUsageOf(message.usage);
  await recordModelCall({ personId: call.asker.person.id, turnId: call.turnId ?? null, purpose: call.purpose, tier: call.tier, model: message.model || model, usage, stopReason: message.stop_reason ?? null });
  return { ok: true, message, model: message.model || model, usage: totalOf(usage) };
}

/** The text of an answer, all its text blocks joined. */
export const textOf = (message: Anthropic.Message): string =>
  message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
