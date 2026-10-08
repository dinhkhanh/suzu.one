// The agent's model, behind one small interface (FR-AGT-61). Two drivers:
//
//  - CLAUDE: every call through `gateway.ts` — admitted against the kill switch and the budget,
//    sent on its tier's model, recorded with its price. A refusal at the door or a provider that
//    fails comes back as a notice, and the loop hands the question to the free path.
//  - SCRIPTED: replays a fixed sequence of replies and keeps every request it was given. The loop,
//    the gating, the two views and the ceilings are tested on it in CI with no key and no spend,
//    and "what would have been sent" is a list the tests read.
import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";
import { NO_USAGE, type TokenUsage } from "../engine/limits";
import type { ModelTier } from "../engine/tiers";
import { callModel } from "../gateway";
import type { AiNotice, ModelAsker } from "../spend";

export type AgentCall = {
  tier: ModelTier;
  system: Anthropic.TextBlockParam[];
  /** Null on a final call: nothing more may be read, only written. */
  tools: Anthropic.Tool[] | null;
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  timeoutMs: number;
};

export type AgentReply = { ok: true; content: Anthropic.ContentBlockParam[]; stopReason: string | null; model: string; usage: TokenUsage } | { ok: false; notice: AiNotice };

export type AgentDriver = { name: string; send: (call: AgentCall, who: { asker: ModelAsker; turnId: string }) => Promise<AgentReply> };

/** The real driver. `purpose` is what the calls are written down as: a person's turn, or the evaluation's. */
export const claudeAgentDriver = (purpose: "agent" | "eval" = "agent"): AgentDriver => ({
  name: "agent",
  send: async (call, { asker, turnId }) => {
    const result = await callModel({
      asker,
      purpose,
      tier: call.tier,
      turnId,
      // Low effort where the model takes it (Sonnet, Opus); Haiku 4.5 takes none and gets none.
      effort: "low",
      timeoutMs: call.timeoutMs,
      request: { max_tokens: call.maxTokens, system: call.system, messages: call.messages, ...(call.tools ? { tools: call.tools } : {}) },
    });
    if (!result.ok) return { ok: false, notice: result.notice };
    // The reply goes back into the conversation as it came — thinking blocks included, which a
    // model that thinks needs to see again on its next call of the same turn.
    return { ok: true, content: result.message.content as unknown as Anthropic.ContentBlockParam[], stopReason: result.message.stop_reason ?? null, model: result.model, usage: result.usage };
  },
});

/** The real driver, or none: no key, or switched off — the free path answers. */
export function agentDriver(): AgentDriver | null {
  const settings = env();
  return settings.ANTHROPIC_API_KEY && settings.AI_AGENT_ENABLED === "on" ? claudeAgentDriver() : null;
}

// ── Scripted ────────────────────────────────────────────────────────────────────────────────

export type ScriptedReply = { text?: string; tools?: { name: string; input: unknown }[]; stopReason?: string } | { refuse: AiNotice };

export type ScriptedDriver = AgentDriver & { calls: AgentCall[] };

/**
 * Replies in order, one per call; a reply may be a function of the call it answers (to read the
 * tool results it was sent). Past the end of the script it answers with an empty end of turn.
 */
export function scriptedDriver(script: readonly (ScriptedReply | ((call: AgentCall) => ScriptedReply))[]): ScriptedDriver {
  const calls: AgentCall[] = [];
  let toolIds = 0;
  return {
    name: "scripted",
    calls,
    send: async (call) => {
      // A copy: the loop goes on appending to its own arrays after the call.
      calls.push(structuredClone(call));
      const step = script[calls.length - 1];
      const reply = typeof step === "function" ? step(call) : (step ?? { text: "" });
      if ("refuse" in reply) return { ok: false, notice: reply.refuse };
      const content: Anthropic.ContentBlockParam[] = [
        ...(reply.text ? [{ type: "text" as const, text: reply.text }] : []),
        ...(reply.tools ?? []).map((tool) => ({ type: "tool_use" as const, id: `toolu_${++toolIds}`, name: tool.name, input: tool.input })),
      ];
      return { ok: true, content, stopReason: reply.stopReason ?? (reply.tools?.length ? "tool_use" : "end_turn"), model: `scripted-${call.tier}`, usage: NO_USAGE };
    },
  };
}
