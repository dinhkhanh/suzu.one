// Asking the assistant a question, and the conversations that come of it (FR-AI-01).
//
// The one use-case is `ask`: retrieve with the asker's own permissions → rank → let the driver
// answer out of what came back → store the turn with its citations → log the question when nothing
// answered it. Everything a reader sees can be traced back to a `kb_page_chunk` row their viewer
// could reach.
import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import { type KbViewer, kbViewerOf, type ViewerSource } from "@/modules/kb/service";
import type { Citation } from "./engine/answer";
import type { ChatTurn } from "./enums";
import { QUESTION_MAX } from "./enums";
import { chatDriver } from "./model";
import { retrievePassages } from "./retrieval";

const { aiConversation, aiMessage, aiUnansweredQuestion } = schema;

const TITLE_MAX = 120;

export type AskInput = { question: string; conversationId?: string | null; locale?: string };

export type Answer = { body: string; citations: Citation[]; score: number; answered: boolean; driver: string; model: string };

/**
 * Retrieve → rank → answer. THE WHOLE DECISION, with nothing written down: `ask` adds the
 * conversation and the unanswered log around it, and the evaluation set (`eval/run.ts`) measures
 * it directly, so what is measured is the same code that answers people.
 *
 * An answer exists only when the driver produced text AND retrieval produced a citation behind it.
 * There is no path in this module that shows a sentence with no source.
 */
export async function answerQuestion(viewer: KbViewer, question: string, locale: string): Promise<Answer> {
  const ranked = await retrievePassages(viewer, question);
  const driver = chatDriver();
  const answer = await driver.complete({ question, passages: ranked, locale });
  const citations = answer.extracted.passages.map((passage) => passage.citation);
  return { body: answer.body, citations, score: ranked[0]?.score ?? 0, answered: answer.body.length > 0 && citations.length > 0, driver: driver.name, model: driver.model };
}

export type AskResult = {
  conversationId: string;
  messageId: string;
  outcome: "answered" | "unanswered";
  body: string;
  citations: Citation[];
  /** Best retrieval score seen, whether or not it was good enough to answer. */
  score: number;
  driver: string;
  model: string;
};

export type AiMessageRow = typeof aiMessage.$inferSelect;
export type ConversationTurn = ChatTurn & { createdAt: Date };

const citationsOf = (row: AiMessageRow): Citation[] => (Array.isArray(row.citations) ? (row.citations as Citation[]) : []);
const toTurn = (row: AiMessageRow): ConversationTurn => ({ id: row.id, role: row.role, body: row.body, outcome: row.outcome, citations: citationsOf(row), createdAt: row.createdAt });

/**
 * The asker's own conversation, or null. A conversation belongs to one person and is never shared.
 * Takes the transaction, not `db()`: inside `ask`'s transaction a query on the outer connection
 * waits for a transaction that is waiting for it.
 */
async function ownConversation(tx: Tx, personId: string, conversationId: string): Promise<{ id: string } | null> {
  const [row] = await tx.select({ id: aiConversation.id }).from(aiConversation).where(and(eq(aiConversation.id, conversationId), eq(aiConversation.personId, personId))).limit(1);
  return row ?? null;
}

/**
 * THE ASSISTANT. `user` supplies the viewer; the viewer supplies the permission filter; nothing
 * here can reach past it.
 */
export async function ask(user: ViewerSource & { person: { id: string } }, input: AskInput): Promise<AskResult> {
  const viewer: KbViewer = kbViewerOf(user);
  const personId = user.person.id;
  const question = input.question.trim().slice(0, QUESTION_MAX);
  const locale = input.locale === "en" ? "en" : "vi";

  const answer = await answerQuestion(viewer, question, locale);
  const { citations, score: best, answered } = answer;

  return db().transaction(async (tx) => {
    const existing = input.conversationId ? await ownConversation(tx, personId, input.conversationId) : null;
    const conversationId =
      existing?.id ??
      (await tx
        .insert(aiConversation)
        .values({ personId, title: question.slice(0, TITLE_MAX) || "…", locale })
        .returning({ id: aiConversation.id }))[0].id;
    if (existing) await tx.update(aiConversation).set({ updatedAt: new Date() }).where(eq(aiConversation.id, conversationId));

    await tx.insert(aiMessage).values({ conversationId, personId, role: "user", body: question });
    const [stored] = await tx
      .insert(aiMessage)
      .values({ conversationId, personId, role: "assistant", body: answer.body, outcome: answered ? "answered" : "unanswered", citations, driver: answer.driver, model: answer.model, score: best })
      .returning();

    // The backlog of pages still to write. Only the question, never the passages that failed.
    if (!answered) await tx.insert(aiUnansweredQuestion).values({ personId, messageId: stored.id, question, locale, bestScore: best });

    return { conversationId, messageId: stored.id, outcome: answered ? ("answered" as const) : ("unanswered" as const), body: answer.body, citations, score: best, driver: answer.driver, model: answer.model };
  });
}

/** The asker's own conversations, newest first. */
export async function listConversations(personId: string, limit = 20): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  return db().select({ id: aiConversation.id, title: aiConversation.title, updatedAt: aiConversation.updatedAt }).from(aiConversation).where(eq(aiConversation.personId, personId)).orderBy(desc(aiConversation.updatedAt)).limit(limit);
}

/** The turns of one conversation — the asker's own, or nothing. */
export async function getConversation(personId: string, conversationId: string): Promise<{ id: string; title: string; turns: ConversationTurn[] } | null> {
  const [row] = await db().select().from(aiConversation).where(and(eq(aiConversation.id, conversationId), eq(aiConversation.personId, personId))).limit(1);
  if (!row) return null;
  const messages = await db().select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId)).orderBy(asc(aiMessage.createdAt));
  return { id: row.id, title: row.title, turns: messages.map(toTurn) };
}

export async function deleteConversation(personId: string, conversationId: string): Promise<boolean> {
  const deleted = await db().delete(aiConversation).where(and(eq(aiConversation.id, conversationId), eq(aiConversation.personId, personId))).returning({ id: aiConversation.id });
  return deleted.length > 0;
}

export type UnansweredRow = { id: string; question: string; locale: string; bestScore: number | null; createdAt: Date; askedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null; asked: number };

/**
 * The unanswered log, most-asked first. Questions are grouped by their accent-stripped text, so
 * "Nghỉ phép năm bao nhiêu ngày?" asked by six people is one row that says six — that is what
 * tells the knowledge base's keepers which page to write first.
 */
export async function listUnanswered(options: { resolved?: boolean; limit?: number } = {}): Promise<UnansweredRow[]> {
  const grouped = sql<string>`lower(regexp_replace(${aiUnansweredQuestion.question}, '\\s+', ' ', 'g'))`;
  const rows = await db()
    .select({
      id: sql<string>`(array_agg(${aiUnansweredQuestion.id} order by ${aiUnansweredQuestion.createdAt} desc))[1]`,
      question: sql<string>`(array_agg(${aiUnansweredQuestion.question} order by ${aiUnansweredQuestion.createdAt} desc))[1]`,
      locale: sql<string>`(array_agg(${aiUnansweredQuestion.locale} order by ${aiUnansweredQuestion.createdAt} desc))[1]`,
      bestScore: sql<number | null>`max(${aiUnansweredQuestion.bestScore})`,
      createdAt: sql<Date>`max(${aiUnansweredQuestion.createdAt})`,
      askedBy: sql<string | null>`(array_agg(${schema.person.fullName} order by ${aiUnansweredQuestion.createdAt} desc))[1]`,
      resolvedAt: sql<Date | null>`max(${aiUnansweredQuestion.resolvedAt})`,
      resolutionNote: sql<string | null>`(array_agg(${aiUnansweredQuestion.resolutionNote} order by ${aiUnansweredQuestion.createdAt} desc))[1]`,
      asked: sql<number>`count(*)::int`,
    })
    .from(aiUnansweredQuestion)
    .leftJoin(schema.person, eq(schema.person.id, aiUnansweredQuestion.personId))
    .where(options.resolved ? sql`true` : isNull(aiUnansweredQuestion.resolvedAt))
    .groupBy(grouped)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${aiUnansweredQuestion.createdAt})`))
    .limit(Math.max(1, Math.min(options.limit ?? 50, 200)));
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null }));
}

/** Marks every copy of the same question done — the page that answers it answers all of them. */
export async function resolveUnanswered(id: string, byPersonId: string, note: string | null): Promise<number> {
  const [row] = await db().select({ question: aiUnansweredQuestion.question }).from(aiUnansweredQuestion).where(eq(aiUnansweredQuestion.id, id)).limit(1);
  if (!row) return 0;
  const same = sql`lower(regexp_replace(${aiUnansweredQuestion.question}, '\\s+', ' ', 'g')) = lower(regexp_replace(${row.question}, '\\s+', ' ', 'g'))`;
  const updated = await db().update(aiUnansweredQuestion).set({ resolvedAt: new Date(), resolvedByPersonId: byPersonId, resolutionNote: note }).where(and(same, isNull(aiUnansweredQuestion.resolvedAt))).returning({ id: aiUnansweredQuestion.id });
  return updated.length;
}
