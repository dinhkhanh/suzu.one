// What one agent turn may spend (FR-AGT-42) and which model takes each call (D38). Pure: a function
// of what the turn has done so far — never of what a model asks for — with golden tests.
//
// THE THREE TIERS. Haiku starts every turn: most questions are one look-up and a sentence. Sonnet
// takes over, from the same messages, when the turn turns out to be complex — a tool tagged
// `complex`, tools from more than one module, or Haiku still calling tools after its share of the
// calls. Opus only ever writes a final answer, with no tools offered, when a tool tagged `analysis`
// was called or Sonnet reached the ceiling with nothing written. Each tier has its own prompt
// cache, so the rules prefer to climb once rather than step by step.

/** D38's three tiers: Haiku for simple work, Sonnet for complex turns, Opus for the hardest answers. */
export type ModelTier = "simple" | "standard" | "complex";

/** FR-AGT-42: per turn. */
export const TURN_CEILINGS = {
  /** Model calls in one turn, every tier together. */
  modelCalls: 6,
  /** Output tokens per call, thinking included. */
  outputTokens: 2000,
  /** The turn's wall clock: what remains of it is each call's timeout. */
  wallClockMs: 40_000,
  /** Rows of one tool result the model reads; the rest are "N more — open the screen". */
  rowsPerTool: 30,
  /** Calls Haiku may make before Sonnet takes the turn over. */
  simpleCalls: 3,
} as const;

/**
 * Why a tool moves the turn up. `complex`: reading it well takes more than a look-up (HR, money,
 * reports, proposals) — Sonnet. `analysis`: the answer weighs many figures against each other
 * (company health, a person's overview, money across periods) — Opus writes it.
 */
export type ToolTag = "complex" | "analysis";

export type CalledTool = { name: string; module: string; tags: readonly ToolTag[] };

export type TurnSoFar = {
  /** The tier of the call that just came back. */
  tier: ModelTier;
  /** Model calls made in this turn so far, every tier. */
  calls: number;
  /** Of those, the calls made on `tier`. */
  callsOnTier: number;
  /** Every tool the turn has run, in order. */
  tools: readonly CalledTool[];
};

/** What happens after a call that asked for tools: another call on a tier (with or without tools), or the end. */
export type NextStep = { kind: "call"; tier: ModelTier; withTools: boolean } | { kind: "stop" };

/** The first call of every turn. */
export const FIRST_STEP: NextStep = { kind: "call", tier: "simple", withTools: true };

/**
 * The next call, after one that asked for tools and whose tools have run. "stop" means the turn has
 * spent its calls without an answer: the free path answers, and the turn is recorded as `limited`.
 */
export function nextStep(turn: TurnSoFar, ceilings: Pick<typeof TURN_CEILINGS, "modelCalls" | "simpleCalls"> = TURN_CEILINGS): NextStep {
  const left = ceilings.modelCalls - turn.calls;
  // Opus writes a final answer and is offered no tools; a turn that reaches it never comes back here.
  if (left <= 0 || turn.tier === "complex") return { kind: "stop" };
  const tagged = (tag: ToolTag) => turn.tools.some((tool) => tool.tags.includes(tag));
  if (tagged("analysis")) return { kind: "call", tier: "complex", withTools: false };
  if (turn.tier === "simple") {
    const modules = new Set(turn.tools.map((tool) => tool.module)).size;
    const climb = tagged("complex") || modules > 1 || turn.callsOnTier >= ceilings.simpleCalls;
    return { kind: "call", tier: climb ? "standard" : "simple", withTools: true };
  }
  // Sonnet with one call left: rather than spend it on another tool, Opus writes from what is there.
  if (left === 1) return { kind: "call", tier: "complex", withTools: false };
  return { kind: "call", tier: "standard", withTools: true };
}
