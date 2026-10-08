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
 * The records a page can hand the assistant's sheet as "this one" (FR-AGT-02): the kinds a tool takes
 * an id of. Any other page asks without context.
 */
export const PAGE_KINDS = ["task", "project", "person"] as const;
export type PageContext = { kind: (typeof PAGE_KINDS)[number]; id: string };

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
  /** The asker's đúng / sai on this answer, if they gave one (FR-AGT-51). */
  feedback?: FeedbackVerdict | null;
};

/** Feedback on an answer (FR-AGT-51). */
export const FEEDBACK_VERDICTS = ["right", "wrong"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const FEEDBACK_NOTE_MAX = 500;

/**
 * How a turn ended. `off_topic`: the agent declined a question outside the company (FR-AGT-03);
 * `limited`: the agent spent its calls or its time without an answer and the free path answered.
 */
export const ANSWER_OUTCOMES = ["answered", "unanswered", "refused", "off_topic", "limited"] as const;
export type AnswerOutcome = (typeof ANSWER_OUTCOMES)[number];

// ── The agent (Phase 13) ────────────────────────────────────────────────────────────────────

/**
 * How one tool call ended. `failed`: bad arguments or an error — the model is told, the turn goes on.
 * `proposed`: a `propose_*` tool stored a proposal for the asker to confirm (R4) — nothing changed.
 */
export type AgentToolOutcome = "answered" | "empty" | "refused" | "step_up" | "failed" | "proposed";

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
export type AgentCard = { tool: string; href: string | null; items: AgentCardItem[]; more: number; /** Set on a `propose_*` tool's card: the change to confirm (FR-AGT-20). */ proposal?: ProposalShown };

// ── Proposals (Phase 13 R4, D37) ────────────────────────────────────────────────────────────

/**
 * One line of a proposal card: what will be set, as the person reads it. `key` names the field
 * (`assistant.agent.proposal.fields.<key>`); the value is either words somebody wrote or a record's
 * name (`text`, with its link when it has a page) or one of the app's own values (`valueKey`, under
 * `assistant.agent.proposal.values.<valueKey>`). A day ("2026-10-08") is written as the reader writes one.
 */
export type ProposalField = {
  key: string;
  /** A label somebody wrote (a request form's own field, set up by an admin), shown as it is instead of `key`'s. */
  label?: string;
  text?: string;
  valueKey?: string;
  params?: Record<string, string | number>;
  href?: string | null;
};

/**
 * An edit link that is not a page: the work module's create form lives in the command palette, so a
 * proposed task's Sửa opens the palette on it (`openQuickCreate`) with these search parameters.
 */
export const PALETTE_CREATE = "palette:create?";

/** What became of a proposal, as the card shows it. `expired`: pending past its thirty minutes. */
export const PROPOSAL_STATES = ["pending", "confirming", "confirmed", "discarded", "failed", "expired"] as const;
export type ProposalState = (typeof PROPOSAL_STATES)[number];

/** A proposal card (FR-AGT-20): every field of the change, who it notifies, and its buttons. */
export type ProposalShown = {
  id: string;
  /** The module action's audit name — the card's title is `assistant.agent.proposal.actions.<action>`. */
  action: string;
  fields: ProposalField[];
  /** The people the action will notify, by name. */
  notify: string[];
  /** Sửa: the module's normal form, filled in (FR-AGT-22). */
  editHref: string | null;
  expiresAt: string;
  state: ProposalState;
  /** The change in one plain line (the model-safe fields), so a follow-up turn knows what was proposed. */
  summary: string;
  /** After a confirm: the record it made or changed. After a failure: the module's reason, as a message key… */
  resultHref?: string | null;
  error?: string | null;
  /** …and in words, in the language of the click: the module's own message, which the chat's page does not carry. */
  reason?: string | null;
};

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
