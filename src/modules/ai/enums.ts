// Values and shapes the assistant's client components share with its server code.
//
// A PLAIN MODULE ON PURPOSE. `conversations.ts` is `server-only` and reaches the database driver;
// a `"use client"` file that imports a *value* from it pulls postgres into the browser bundle and
// the page fails at runtime — `tsc` and eslint both pass, so only opening the page finds it. The
// same trap as the one `core-hr/enums.ts` exists for, from the other direction.
import type { Citation } from "./engine/answer";
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
  outcome: "answered" | "unanswered" | "refused" | null;
  citations: Citation[];
  /** Set when a personal tool answered instead of the knowledge base. */
  tool: ToolOutcome | null;
};
