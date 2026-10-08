// The assistant (Phase 9, FR-AI-01, 02, 06). What is kept:
//  - a conversation per person (nobody else's, ever — there is no sharing and no "read another
//    person's chat" path anywhere in the module),
//  - every message, with the citations the answer was built from, the driver and model that
//    produced it and the retrieval score, so an answer can be explained afterwards,
//  - the questions the knowledge base could not answer, for whoever keeps it (FR-KB-08's
//    "what is missing" in the small): the log is the backlog of pages still to write,
//  - what each answer cost — tokens in and out, beside the driver and model already kept,
//  - the counted windows of the per-person limit (`ai_usage_hit`, `engine/limits.ts`),
//  - every call to a model, with its tokens and its price (`ai_model_call`, `engine/budget.ts`).
// Citations are stored as JSON on the message rather than in a join table: they are a record of
// what was shown at the time, not a live index. Every link is re-checked by the KB page itself.
import { boolean, index, integer, jsonb, pgEnum, pgTable, real, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { person } from "../platform/people/schema";

export const aiMessageRole = pgEnum("ai_message_role", ["user", "assistant"]);
// How an assistant turn ended: with an answer, with nothing found (logged as unanswered), or
// refused before retrieval (a question the assistant does not take).
// The agent (Phase 13) adds two: a question outside the company declined (`off_topic`, FR-AGT-03),
// and a turn that spent its calls or time and fell back to the free path (`limited`).
export const aiAnswerOutcome = pgEnum("ai_answer_outcome", ["answered", "unanswered", "refused", "off_topic", "limited"]);

export const aiConversation = pgTable(
  "ai_conversation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** The first question, trimmed — what the list shows. */
    title: text("title").notNull(),
    locale: text("locale").notNull().default("vi"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_conversation_person_idx").on(t.personId, t.updatedAt)],
).enableRLS();

export const aiMessage = pgTable(
  "ai_message",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => aiConversation.id, { onDelete: "cascade" }),
    // Denormalised from the conversation: an answer is always attributable to the person whose
    // permissions produced it, even if conversations are ever merged or moved.
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    role: aiMessageRole("role").notNull(),
    body: text("body").notNull(),
    outcome: aiAnswerOutcome("outcome"),
    /** `{ pageId, pageTitle, spaceKey, spaceName, headingPath, chunkId, score }[]` — see `engine/answer.ts`. */
    citations: jsonb("citations").notNull().default([]),
    /** The personal tool that answered instead of the knowledge base, if any (FR-AI-02). */
    tool: text("tool"),
    /**
     * That tool's answer as message keys and numbers (`ToolOutcome` in `enums.ts`) — the asker's
     * own figures, rendered in the reader's language by the chat. It is the asker's own data in
     * their own conversation, which nobody else can open, so it is kept exactly as it was shown:
     * a payslip explanation that cannot be read back is not an explanation.
     */
    toolResult: jsonb("tool_result"),
    /**
     * When the agent answered (Phase 13): the tools it called — name, input, subject, outcome — and
     * what the chat showed beside the answer (`AgentShown` in `enums.ts`). Never a figure of pay: a
     * pay tool's input is a month, its card a link, and an answer that held pay is not stored (D36).
     */
    toolCalls: jsonb("tool_calls"),
    /** The adapter that answered: "local-extractive", "claude" or "agent". */
    driver: text("driver"),
    model: text("model"),
    /** Best retrieval score behind the answer, 0..1 — why it answered, or why it did not. */
    score: real("score"),
    /**
     * What the answer cost, as the driver reported it: tokens sent and tokens written. Zero for the
     * local driver and for a personal tool — nothing went to a model. Null on the asker's own turn
     * and on answers stored before usage was kept.
     */
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_message_conversation_idx").on(t.conversationId, t.createdAt), index("ai_message_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

export const aiUnansweredQuestion = pgTable(
  "ai_unanswered_question",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessage.id, { onDelete: "set null" }),
    question: text("question").notNull(),
    locale: text("locale").notNull().default("vi"),
    /** The best score retrieval could manage, so the log separates "nothing there" from "nearly". */
    bestScore: real("best_score"),
    /** Marked done by whoever keeps the knowledge base — usually by writing the missing page. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => person.id),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_unanswered_open_idx").on(t.resolvedAt, t.createdAt), index("ai_unanswered_person_idx").on(t.personId)],
).enableRLS();

/**
 * The per-person limit on questions and drafts (NFR-SEC-03): one row per (bucket, person, window),
 * counted by one atomic upsert — the careers page's mechanism in this module's own table. The
 * bucket is "ask_burst", "ask_day", "draft_burst" or "draft_day" (`AI_LIMITS`). Swept nightly.
 */
export const aiUsageHit = pgTable(
  "ai_usage_hit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    bucket: text("bucket").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    hits: integer("hits").notNull().default(1),
    lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ai_usage_hit_key").on(t.bucket, t.personId, t.windowStart), index("ai_usage_hit_window_idx").on(t.windowStart)],
).enableRLS();

/**
 * Every call to a model (SRS D35, FR-AGT-43): who it was for, why, which model, the tokens of each
 * kind and what they cost in micro-dollars at the price of the day (`engine/pricing.ts`). The
 * month's and the person's day's ceilings are sums over this table, in SQL, before each call.
 * Nothing of the question or the answer is here — only that a call happened and what it cost — so
 * the rows outlive the conversations they served, and a person who leaves leaves their cost behind
 * (`set null`): the month's bill does not shrink when somebody is erased.
 */
export const aiModelCall = pgTable(
  "ai_model_call",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id").references(() => person.id, { onDelete: "set null" }),
    /** The agent turn the call belongs to, when it was one: cost per turn is the sum over it. */
    turnId: uuid("turn_id"),
    /** What the call was for: "ask", "agent", "draft.eod", "draft.status", "draft.handoff", "eval". */
    purpose: text("purpose").notNull(),
    /** The tier the call ran on (D38): "simple", "standard" or "complex". */
    tier: text("tier").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costMicroUsd: integer("cost_micro_usd").notNull().default(0),
    /** As the provider said it ended: "end_turn", "max_tokens", "refusal", "tool_use"… */
    stopReason: text("stop_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_model_call_time_idx").on(t.createdAt), index("ai_model_call_person_idx").on(t.personId, t.createdAt)],
).enableRLS();

// What became of a proposal (D37, FR-AGT-20). `confirming` is the claim taken before the module's
// action runs, so two clicks cannot run it twice; a proposal that leaves `pending` never returns to
// it. An expired proposal is a pending one past `expires_at` — read, never written by a job.
export const aiProposalStatus = pgEnum("ai_proposal_status", ["pending", "confirming", "confirmed", "discarded", "failed"]);

/**
 * A change the agent proposed and the asker has not yet confirmed (D37, FR-AGT-20…23). It holds the
 * module action's name and its input, validated against that action's own schema when proposed and
 * parsed again by the action when confirmed; the fields as the person reads them on the card; and
 * who the action will notify. Only its own person can confirm or discard it, at most once, within
 * thirty minutes. Nothing here executes anything: confirming calls the module's own server action as
 * the person, which authorises, notifies and audits itself as it always does.
 */
export const aiProposal = pgTable(
  "ai_proposal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    /** The agent turn that proposed it; the message is linked once the turn is stored. */
    turnId: uuid("turn_id").notNull(),
    conversationId: uuid("conversation_id").references(() => aiConversation.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").references(() => aiMessage.id, { onDelete: "set null" }),
    /** The module action's audit name, e.g. "work.task.create" (`agent/proposable.ts`). */
    action: text("action").notNull(),
    /** The action's input, exactly as it will be sent. */
    input: jsonb("input").notNull(),
    /** The card: `ProposalField[]` (enums.ts) — names and dates as the person reads them. */
    fields: jsonb("fields").notNull().default([]),
    /** Who the action will notify, by name, as the card says. */
    notify: jsonb("notify").notNull().default([]),
    /** The module's normal form, filled in from this proposal (FR-AGT-22). */
    editHref: text("edit_href"),
    status: aiProposalStatus("status").notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** After a confirm: the record it made or changed (`{ href }`), or why the action refused. */
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_proposal_person_idx").on(t.personId, t.createdAt), index("ai_proposal_turn_idx").on(t.turnId), index("ai_proposal_conversation_idx").on(t.conversationId)],
).enableRLS();

// ── Feedback on an answer (Phase 13 R5, FR-AGT-51) ──────────────────────────────────────────

export const aiFeedbackVerdict = pgEnum("ai_feedback_verdict", ["right", "wrong"]);

/**
 * One person's đúng / sai on one answer of their own, with a note. The owner and the handbook's
 * keepers read the verdict and the note; the question and the answer only when the asker ticked
 * "chia sẻ câu trả lời này" (`shared`) — a question can be personal, and a keeper reads what the
 * asker chose to hand over, never more. One per answer: giving it again changes it. It goes with the
 * conversation: deleting that (or its retention running out) deletes the feedback too.
 */
export const aiFeedback = pgTable(
  "ai_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => aiMessage.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => person.id, { onDelete: "cascade" }),
    verdict: aiFeedbackVerdict("verdict").notNull(),
    note: text("note"),
    shared: boolean("shared").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("ai_feedback_message_key").on(t.messageId), index("ai_feedback_created_idx").on(t.createdAt)],
).enableRLS();
