// The assistant (Phase 9, FR-AI-01, 02, 06). What is kept:
//  - a conversation per person (nobody else's, ever — there is no sharing and no "read another
//    person's chat" path anywhere in the module),
//  - every message, with the citations the answer was built from, the driver and model that
//    produced it and the retrieval score, so an answer can be explained afterwards,
//  - the questions the knowledge base could not answer, for whoever keeps it (FR-KB-08's
//    "what is missing" in the small): the log is the backlog of pages still to write.
// Citations are stored as JSON on the message rather than in a join table: they are a record of
// what was shown at the time, not a live index. Every link is re-checked by the KB page itself.
import { index, jsonb, pgEnum, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { person } from "../platform/people/schema";

export const aiMessageRole = pgEnum("ai_message_role", ["user", "assistant"]);
// How an assistant turn ended: with an answer, with nothing found (logged as unanswered), or
// refused before retrieval (a question the assistant does not take).
export const aiAnswerOutcome = pgEnum("ai_answer_outcome", ["answered", "unanswered", "refused"]);

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
    /** The adapter that answered: "local-extractive" or "claude". */
    driver: text("driver"),
    model: text("model"),
    /** Best retrieval score behind the answer, 0..1 — why it answered, or why it did not. */
    score: real("score"),
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
