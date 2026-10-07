// The agent's tools (FR-AGT-10, design rule 1). A tool is a thin wrapper over ONE module's
// `service.ts`, run with the asker's own principal; it has no rights of its own.
//
// What a tool declares, and why each field exists:
//  - `input`: a strict zod schema. The model's arguments are parsed with it before `run` sees them;
//    what fails is told to the model as an error, never run.
//  - `offeredTo`: a pure function of the principal and two facts about the asker (do they lead a
//    team or project, does anybody report to them). A tool the asker could never use is not in the
//    request at all, so the model cannot even ask for it. The tool matrix (docs/agent-tool-matrix.md)
//    is generated from it.
//  - `tier`: the highest sensitivity its model view can hold; `stepUp`: whether the page behind it
//    asks for a fresh step-up — checked here, before `run`, so a stale session reads nothing. A
//    function of the input when only some inputs open pay (one report of the catalogue, not all).
//  - `kind`: read or propose (R4). `rowCap`: rows the model reads at most.
//  - `module` and `tags`: what D38's tier rules weigh (`engine/tiers.ts`).
//  - `step`: the progress line the chat shows ("Đang xem việc của bạn…", FR-AGT-07).
//
// A tool returns TWO VIEWS (FR-AGT-30): `model`, built with `engine/views.ts` from an allow-list,
// and `card`, what the asker sees under the answer. They are built side by side and never from each
// other, so what the person is shown can be richer than what any model is sent.
import "server-only";
import { z } from "zod";
import type { IsoDate } from "@/lib/dates";
import type { ViewerSource as KbViewerSource } from "@/modules/kb/service";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import type { Principal } from "@/modules/platform/rbac/policy";
import type { Tier } from "@/modules/platform/rbac/roles";
import type { Citation } from "../engine/answer";
import type { ToolTag } from "../engine/tiers";
import type { AgentCard, AgentToolOutcome } from "../enums";
import type { ModelAsker } from "../spend";
import type { ToolUser } from "../tools";

/** Everything a tool may know of the asker. `CurrentUser` satisfies it. */
export type AgentUser = KbViewerSource & ModelAsker & ToolUser & { person: { fullName?: string } };

/**
 * What decides a tool's offer beyond the roles: a lead's tools for people who lead, a manager's for
 * people with reports, the sales tools for people who own a deal or manage a client account.
 */
export type AskerFacts = { leadsWork: boolean; managesPeople: boolean; worksAccounts: boolean };

export const NO_FACTS: AskerFacts = { leadsWork: false, managesPeople: false, worksAccounts: false };

export type ToolContext = { user: AgentUser; today: IsoDate; locale: "vi" | "en"; /** The turn, which a proposal is filed under (R4). */ turnId?: string };

/** A subject for the audit log (FR-AGT-50): what the call was about — never a figure. */
export type ToolSubject = { type: string; id: string };

export type ToolResult = {
  outcome: AgentToolOutcome;
  /** What the model reads: allow-listed, redacted, capped. JSON. */
  model: Record<string, unknown>;
  /** What the asker sees under the answer. */
  card: AgentCard | null;
  subject: ToolSubject | null;
  /** Handbook passages behind the result, shown as the answer's sources. */
  citations?: Citation[];
  /**
   * Did the model view hold pay (D36)? Then the turn's answer is shown once and not stored. Absent:
   * the tool's tier decides. Set by tools that read pay for some inputs only.
   */
  compensation?: boolean;
};

export type AgentTool<Input = unknown> = {
  name: string;
  /** The owning module: D38's rules climb when a turn's tools span more than one. */
  module: string;
  description: string;
  input: z.ZodType<Input>;
  offeredTo: (principal: Principal, facts: AskerFacts) => boolean;
  tier: Tier;
  stepUp: boolean | ((input: Input) => boolean);
  kind: "read" | "propose";
  rowCap: number;
  tags: readonly ToolTag[];
  run: (context: ToolContext, input: Input) => Promise<ToolResult>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a registry holds tools of every input shape.
export type AnyAgentTool = AgentTool<any>;

export const defineTool = <Input>(tool: AgentTool<Input>): AgentTool<Input> => tool;

/** The tools offered to this asker, in the registry's fixed order — the order is part of the cached prefix. */
/** Does this call need a fresh step-up? */
export const needsStepUp = (tool: AnyAgentTool, input: unknown): boolean => (typeof tool.stepUp === "function" ? tool.stepUp(input) : tool.stepUp);

/** Did this result hold pay (D36)? */
export const heldPay = (tool: AnyAgentTool, result: ToolResult): boolean => result.outcome === "answered" && (result.compensation ?? tool.tier === "compensation");

export const toolsFor = (registry: readonly AnyAgentTool[], principal: Principal, facts: AskerFacts = NO_FACTS): AnyAgentTool[] => registry.filter((tool) => tool.offeredTo(principal, facts));

// Keywords strict tool use does not take; the zod schema still enforces them when the input is parsed.
const UNSUPPORTED = new Set(["$schema", "minLength", "maxLength", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "pattern", "format", "minItems", "maxItems", "default"]);

function strip(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strip);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => !UNSUPPORTED.has(key))
      .map(([key, value]) => [key, key === "properties" ? Object.fromEntries(Object.entries(value as object).map(([name, child]) => [name, strip(child)])) : strip(value)]),
  );
}

/** The JSON schema a model is given for a tool's input. */
export function inputSchemaOf(tool: AnyAgentTool): { type: "object"; [key: string]: unknown } {
  const schema = strip(z.toJSONSchema(tool.input, { io: "input", unrepresentable: "any" })) as { type: "object"; [key: string]: unknown };
  return { ...schema, type: "object", additionalProperties: false };
}

/**
 * Runs one tool call as the asker: parse the input, check step-up, run. Every road out of here
 * returns a result the model can read; nothing throws past it, so one tool that fails does not
 * end the turn.
 */
export async function runAgentTool(tool: AnyAgentTool, context: ToolContext, rawInput: unknown, now: Date = new Date()): Promise<ToolResult & { error: string | null }> {
  const parsed = tool.input.safeParse(rawInput ?? {});
  if (!parsed.success) return { outcome: "failed", model: { error: "invalid_input", issues: parsed.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")}: ${issue.message}`) }, card: null, subject: null, error: "invalid_input" };
  // The page's second lock (FR-PLT-06), before anything is read: a stale session learns nothing,
  // not even whether there is anything to read.
  if (needsStepUp(tool, parsed.data) && !isStepUpFresh(context.user.reauthAt ?? null, now)) return { outcome: "step_up", model: { link: "/step-up?next=%2Fassistant" }, card: { tool: "step_up", href: "/step-up?next=%2Fassistant", items: [], more: 0 }, subject: null, error: null };
  try {
    return { ...(await tool.run(context, parsed.data)), error: null };
  } catch (error) {
    return { outcome: "failed", model: { error: "tool_failed" }, card: null, subject: null, error: error instanceof Error ? error.message : String(error) };
  }
}
