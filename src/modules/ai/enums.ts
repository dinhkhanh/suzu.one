// Values and shapes the assistant's client components share with its server code.
//
// A PLAIN MODULE ON PURPOSE. `conversations.ts` is `server-only` and reaches the database driver;
// a `"use client"` file that imports a *value* from it pulls postgres into the browser bundle and
// the page fails at runtime — `tsc` and eslint both pass, so only opening the page finds it. The
// same trap as the one `core-hr/enums.ts` exists for, from the other direction.
import type { Citation } from "./engine/answer";
import type { OffTopicKind } from "./engine/agent-prompt";
import type { ToolName } from "./engine/routing";

export const QUESTION_MAX = 500;

/**
 * What a personal tool answered (FR-AI-02). **Message keys and numbers, never prose.**
 *
 * Two reasons it is shaped this way rather than as a sentence the server wrote:
 *  - the strings are UI strings, so they live in `messages/vi.json` and `messages/en.json` like
 *    every other string in the product and a notification's wording does;
 *  - it makes "did this answer contain a figure about somebody else?" a question about data, not
 *    about text. The guardrail tests read `params`; there is no sentence to grep.
 *
 * `key` names a message under `assistant.tools.<tool>.<key>`. `lines` are the rows under it — a
 * leave type, a step of an approval flow — each with its own key and values.
 */
export type ToolLine = { key: string; params: Record<string, string | number> };

export type ToolAnswer = {
  tool: ToolName;
  key: string;
  params: Record<string, string | number>;
  lines: ToolLine[];
  /** The real screen these figures come from, so the reader can check them. */
  link: string | null;
};

/** Why a tool said no. Never carries a figure, and never says whether the other person exists. */
export type ToolRefusal = "other_person" | "not_permitted" | "step_up" | "nothing_yet";

export type ToolOutcome = ({ status: "answered" } & ToolAnswer) | { status: "refused"; tool: ToolName; reason: ToolRefusal; params: Record<string, string | number>; link: string | null };

/** One turn as the chat renders it: no dates, no rows, nothing that needs the database. */
export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  body: string;
  outcome: AnswerOutcome | null;
  citations: Citation[];
  /** Set when a personal tool answered instead of the knowledge base. */
  tool: ToolOutcome | null;
  /** Set when the agent answered (Phase 13): the steps it took and what it showed. */
  agent?: AgentShown | null;
  /** Why a fresh answer is a quoted passage although there is a key. Shown once, never stored. */
  notice?: AiNotice | null;
};

/**
 * How a turn ended. `off_topic`: the agent declined a question outside the company (FR-AGT-03);
 * `limited`: the agent spent its calls or its time without an answer and the free path answered.
 */
export const ANSWER_OUTCOMES = ["answered", "unanswered", "refused", "off_topic", "limited"] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

// ── The agent (Phase 13) ────────────────────────────────────────────────────────────────────

/** How one tool call ended. `failed`: bad arguments or an error — the model is told, the turn goes on. */
export type AgentToolOutcome = "answered" | "empty" | "refused" | "step_up" | "failed";

/** A line of a card: a record's name (data, as the asker may see it), its link, and a fact about it as a message key. */
export type AgentCardItem = {
  label: string;
  href: string | null;
  meta: { key: string; params: Record<string, string | number> } | null;
  /** A label in the reader's words (`assistant.agent.meta.<key>`), for a row that is a figure or a screen rather than a record's name. Wins over `label`. */
  title?: { key: string; params: Record<string, string | number> };
};

/**
 * What a tool shows the asker under the answer (FR-AGT-05, 30): the records it read, each linked
 * to its screen. Titled by the tool (`assistant.agent.cards.<tool>`). Built beside the model's view,
 * never from it.
 */
export type AgentCard = { tool: string; href: string | null; items: AgentCardItem[]; more: number };

/** One step of a turn, as the chat names it (FR-AGT-07). */
export type AgentStep = { tool: string; outcome: AgentToolOutcome };

export type AgentShown = { steps: AgentStep[]; cards: AgentCard[]; offTopic: OffTopicKind | null; /** The answer held pay and was not stored (D36): reopening says so. */ unstored?: boolean };

/**
 * Why a model did not write an answer although there is a key (SRS D35, FR-AGT-52, NFR-AGT-03): the
 * kill switch is off, there is no key, the company's month or this person's day is spent, or the
 * provider failed. The answer is then the free one — a quoted passage — and the chat says why.
 */
export const AI_NOTICES = ["off", "no_key", "month", "day", "provider_error"] as const;
export type AiNotice = (typeof AI_NOTICES)[number];
