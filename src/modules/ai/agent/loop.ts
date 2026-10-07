// One agent turn (Phase 13 R1): the question → the model picks tools → the tools run as the asker →
// their model views go back → … → an answer, a decline, or the free path.
//
// What this file holds the line on:
//  - ONLY OFFERED TOOLS RUN. The request lists the tools `offeredTo` admits for this asker; a call
//    to any other name — invented, or offered to somebody else — is answered "unknown tool" and
//    nothing is read.
//  - TOOL RESULTS ARE DATA. They go back as `tool_result` blocks holding the model view alone, and
//    the system prompt says what they are. No tool changes anything: a `propose_*` tool only writes
//    down a proposal, so a sentence in a task title that talks the model into a call can at worst
//    put a card in front of the asker — which does nothing until the asker confirms it (FR-AGT-32).
//  - A PROPOSAL ENDS THE TURN (R4). Once a reply's tools have proposed something, the turn ends and
//    the chat shows the card under the app's own line; whatever the model wrote beside the call is
//    dropped, and no further call can stack changes on top. At most three proposals in a turn.
//  - THE CEILINGS (FR-AGT-42): six model calls, 2,000 output tokens each, 40 seconds, thirty rows
//    per tool. A turn that reaches one ends on the free path, recorded as `limited` — never as an
//    error and never as a bigger model with no limit.
//  - THE TIERS (D38) are decided by `engine/tiers.ts` from what the turn did, not by the model.
//  - THE DECLINE is the app's: when the model calls `decline_out_of_scope` the turn ends and the
//    chat shows the app's sentence; whatever text the model wrote beside it is dropped.
import "server-only";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_SYSTEM, CLARIFY_TOOL, DECLINE_TOOL, isClarifyingQuestion, isUngrounded, OFF_TOPIC_KINDS, type OffTopicKind, toolResultText, turnContext } from "../engine/agent-prompt";
import type { Citation } from "../engine/answer";
import type { HistoryMessage } from "../engine/history";
import { NO_USAGE, type TokenUsage } from "../engine/limits";
import { type CalledTool, firstStep, type ModelTier, type NextStep, nextStep, TURN_CEILINGS } from "../engine/tiers";
import type { AgentCard, AgentStep, AgentToolOutcome, AiNotice } from "../enums";
import type { AgentDriver, AgentReply } from "./driver";
import { askerFactsOf } from "./facts";
import { PROPOSALS_PER_TURN } from "../proposals";
import { type AgentUser, type AnyAgentTool, type AskerFacts, heldPay, inputSchemaOf, runAgentTool, type ToolContext, type ToolSubject, toolsFor } from "./registry";
import { AGENT_TOOLS } from "./tools";

/** What a tool call leaves behind for the audit log and the message row: never a figure. */
export type ToolCallRecord = { tool: string; input: unknown; outcome: AgentToolOutcome; subject: ToolSubject | null; error: string | null };

type Spent = { calls: ToolCallRecord[]; usage: TokenUsage; model: string | null; tiers: ModelTier[]; turnId: string };

export type AgentTurn =
  | (Spent & { kind: "answered"; body: string; steps: AgentStep[]; cards: AgentCard[]; citations: Citation[]; /** A pay tool answered in this turn: the answer is not stored (D36). */ compensation: boolean })
  | (Spent & { kind: "off_topic"; offTopic: OffTopicKind })
  /** The free path answers: the driver refused (`notice`), or the turn reached a ceiling (`limited`). */
  | (Spent & { kind: "fallback"; reason: "limited" | AiNotice });

export type AgentTurnInput = {
  user: AgentUser;
  question: string;
  locale: "vi" | "en";
  today: string;
  history: readonly HistoryMessage[];
  driver: AgentDriver;
  /** The tools; the whole registry unless a test narrows it. */
  registry?: readonly AnyAgentTool[];
  /** The clock, for the wall-clock ceiling. */
  clock?: () => number;
  /** What the asker leads and manages; read from the app when not given. */
  facts?: AskerFacts;
  /** The question asks for something to be done (`asksToAct`): the turn starts on the second tier. */
  acting?: boolean;
};

const DECLINE: Anthropic.Tool = {
  name: DECLINE_TOOL,
  description: "Declines a question that is not about the company, its people, policies, work or this app. Call it alone, with the kind of question. Never for a request to do something in the app (create, change, log, request, submit…): that is a propose_* tool.",
  input_schema: { type: "object", properties: { kind: { type: "string", enum: [...OFF_TOPIC_KINDS] } }, required: ["kind"], additionalProperties: false },
  strict: true,
};

const CLARIFY: Anthropic.Tool = {
  name: CLARIFY_TOOL,
  description: "Asks the asker one short question back, when you cannot tell what they need (which project, which month) or a request still lacks details a form requires. Call it alone.",
  input_schema: { type: "object", properties: { question: { type: "string", description: "One short question in the asker's language, ending with a question mark; it may list briefly the details a form still needs." } }, required: ["question"], additionalProperties: false },
  strict: true,
};

/** A final call shorter than this is not worth starting: the free path answers instead. */
const MIN_CALL_MS = 4_000;
const CALL_TIMEOUT_MS = 30_000;

const addUsage = (a: TokenUsage, b: TokenUsage): TokenUsage => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens });

const textOf = (content: readonly Anthropic.ContentBlockParam[]): string =>
  content
    .filter((block): block is Anthropic.TextBlockParam => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

/**
 * The conversation so far as one message, for a final call that offers no tools: Opus writes the
 * answer from what was read, and a request without tools may not carry tool blocks.
 */
function flattened(messages: readonly Anthropic.MessageParam[], names: ReadonlyMap<string, string>): Anthropic.MessageParam[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (typeof message.content === "string") {
      lines.push(`${message.role === "user" ? "Asker" : "You"}: ${message.content}`);
      continue;
    }
    for (const block of message.content) {
      if (block.type === "text" && block.text.trim()) lines.push(`${message.role === "user" ? "Asker" : "You"}: ${block.text.trim()}`);
      else if (block.type === "tool_use") lines.push(`You called ${block.name} with ${JSON.stringify(block.input)}.`);
      else if (block.type === "tool_result") lines.push(`<data tool="${names.get(block.tool_use_id) ?? "tool"}">\n${typeof block.content === "string" ? block.content : ""}\n</data>`);
    }
  }
  lines.push("Write your final answer to the asker's last question from the results above. You cannot call tools now.");
  return [{ role: "user", content: lines.join("\n\n") }];
}

export async function runAgentTurn(input: AgentTurnInput): Promise<AgentTurn> {
  const clock = input.clock ?? Date.now;
  const started = clock();
  const turnId = randomUUID();
  const offered = toolsFor(input.registry ?? AGENT_TOOLS, input.user.principal, input.facts ?? (await askerFactsOf(input.user)));
  const byName = new Map(offered.map((tool) => [tool.name, tool]));
  // The frozen prefix: rules, then the tools in a fixed order, cached together (FR-AGT-44).
  // `strict` only on the two tools that end a turn: the API takes at most 20 strict tools and a lead
  // is offered more than that. A data tool's arguments are parsed with its zod schema before it
  // runs, and a bad argument goes back to the model as an error.
  const tools: Anthropic.Tool[] = [...offered.map((tool): Anthropic.Tool => ({ name: tool.name, description: tool.description, input_schema: inputSchemaOf(tool) })), CLARIFY, { ...DECLINE, cache_control: { type: "ephemeral" } }];
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: AGENT_SYSTEM, cache_control: { type: "ephemeral" } },
    { type: "text", text: turnContext({ today: input.today, locale: input.locale, askerName: input.user.person.fullName ?? "an employee" }) },
  ];
  const messages: Anthropic.MessageParam[] = [...input.history.map((message) => ({ role: message.role, content: message.content })), { role: "user", content: input.question }];
  const context: ToolContext = { user: input.user, today: input.today, locale: input.locale, turnId };

  const spent: Spent = { calls: [], usage: NO_USAGE, model: null, tiers: [], turnId };
  const called: CalledTool[] = [];
  const cards: AgentCard[] = [];
  const citations: Citation[] = [];
  const toolNames = new Map<string, string>();
  let compensation = false;
  let proposals = 0;
  let step: NextStep = firstStep(input.acting ?? false);
  let calls = 0;
  let callsOnTier = 0;
  let tier: ModelTier = "simple";

  while (step.kind === "call") {
    const left = TURN_CEILINGS.wallClockMs - (clock() - started);
    if (left < MIN_CALL_MS) return { ...spent, kind: "fallback", reason: "limited" };
    callsOnTier = step.tier === tier ? callsOnTier : 0;
    tier = step.tier;
    const reply: AgentReply = await input.driver.send(
      { tier, system, tools: step.withTools ? tools : null, messages: step.withTools ? messages : flattened(messages, toolNames), maxTokens: TURN_CEILINGS.outputTokens, timeoutMs: Math.min(left, CALL_TIMEOUT_MS) },
      { asker: input.user, turnId },
    );
    calls += 1;
    callsOnTier += 1;
    // Refused at the door (switched off, a budget spent) or the provider failed: the free path.
    if (!reply.ok) return { ...spent, kind: "fallback", reason: reply.notice };
    spent.usage = addUsage(spent.usage, reply.usage);
    spent.model = reply.model;
    spent.tiers.push(tier);
    // A safety decline is not an answer.
    if (reply.stopReason === "refusal") return { ...spent, kind: "fallback", reason: "limited" };

    const uses = reply.content.filter((block): block is Anthropic.ToolUseBlockParam => block.type === "tool_use");
    const decline = uses.find((use) => use.name === DECLINE_TOOL);
    if (decline && step.withTools) {
      const kind = (decline.input as { kind?: unknown } | null)?.kind;
      return { ...spent, kind: "off_topic", offTopic: OFF_TOPIC_KINDS.includes(kind as OffTopicKind) ? (kind as OffTopicKind) : "other" };
    }
    const clarify = uses.find((use) => use.name === CLARIFY_TOOL);
    if (clarify && step.withTools && uses.length === 1) {
      const question = (clarify.input as { question?: unknown } | null)?.question;
      // A question back is shown as the model wrote it — when it is one: short, and a question.
      if (isClarifyingQuestion(question)) return { ...spent, kind: "answered", body: question.trim(), steps: [], cards, citations, compensation };
      return { ...spent, kind: "off_topic", offTopic: "other" };
    }
    if (uses.length === 0 || !step.withTools) {
      const body = textOf(reply.content);
      if (!body) return { ...spent, kind: "fallback", reason: "limited" };
      // Written from nothing the app read: a model declining in its own words, or answering from
      // general knowledge. Neither is shown — the app's sentence is (FR-AGT-03).
      if (isUngrounded(spent.calls.length)) return { ...spent, kind: "off_topic", offTopic: "other" };
      return { ...spent, kind: "answered", body, steps: spent.calls.map(({ tool, outcome }) => ({ tool, outcome })), cards, citations, compensation };
    }

    // The tools of one reply run together, each as the asker; their results go back in one message.
    messages.push({ role: "assistant", content: reply.content });
    const results = await Promise.all(
      uses.map(async (use): Promise<Anthropic.ToolResultBlockParam> => {
        toolNames.set(use.id, use.name);
        const tool = byName.get(use.name);
        if (!tool) {
          spent.calls.push({ tool: use.name, input: null, outcome: "failed", subject: null, error: "unknown_tool" });
          return { type: "tool_result", tool_use_id: use.id, content: toolResultText(use.name, "failed", { error: "unknown_tool" }), is_error: true };
        }
        // The cap is counted as calls are made, before any of them runs: a reply asking for ten cards gets three.
        if (tool.kind === "propose" && ++proposals > PROPOSALS_PER_TURN) {
          spent.calls.push({ tool: tool.name, input: use.input, outcome: "refused", subject: null, error: "too_many_proposals" });
          return { type: "tool_result", tool_use_id: use.id, content: toolResultText(tool.name, "refused", { proposed: false, reason: "too_many_proposals" }) };
        }
        const result = await runAgentTool(tool, context, use.input);
        spent.calls.push({ tool: tool.name, input: use.input, outcome: result.outcome, subject: result.subject, error: result.error });
        called.push({ name: tool.name, module: tool.module, tags: tool.tags });
        if (result.card) cards.push(result.card);
        for (const citation of result.citations ?? []) if (!citations.some((seen) => seen.chunkId === citation.chunkId)) citations.push(citation);
        if (heldPay(tool, result)) compensation = true;
        return { type: "tool_result", tool_use_id: use.id, content: toolResultText(tool.name, result.outcome, result.model), ...(result.outcome === "failed" ? { is_error: true } : {}) };
      }),
    );
    messages.push({ role: "user", content: results });
    // A card is waiting for the asker: the turn ends here, under the app's line (the chat writes it).
    if (cards.some((card) => card.proposal)) return { ...spent, kind: "answered", body: "", steps: spent.calls.map(({ tool, outcome }) => ({ tool, outcome })), cards, citations, compensation };
    step = nextStep({ tier, calls, callsOnTier, tools: called });
  }
  return { ...spent, kind: "fallback", reason: "limited" };
}
