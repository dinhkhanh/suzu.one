// Asking the assistant a question, and the conversations that come of it (FR-AI-01).
//
// The one use-case is `ask`: retrieve with the asker's own permissions → rank → let the driver
// answer out of what came back → store the turn with its citations → log the question when nothing
// answered it. Everything a reader sees can be traced back to a `kb_page_chunk` row their viewer
// could reach.
import "server-only";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { navFor } from "@/components/shell/nav";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { type KbViewer, kbViewerOf, type ViewerSource } from "@/modules/kb/service";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import type { Citation } from "./engine/answer";
import { allowedAppLinks, appLinksFor } from "./engine/app-links";
import { routeQuestion } from "./engine/routing";
import type { ChatTurn, ToolOutcome } from "./enums";
import { QUESTION_MAX } from "./enums";
import { chatDriver } from "./model";
import { retrievePassages } from "./retrieval";
import { runTool, type ToolAudit, type ToolUser } from "./tools";

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
  // The screens this asker's sidebar shows. Recruitment and the directory are left out: they
  // depend on rows, not roles, and nothing in the link catalogue points at them.
  const nav = new Set(navFor(viewer.principal, { people: false, recruit: false, interviews: false }).main.map((item) => item.key));
  const t = createTranslator({ locale: locale === "en" ? "en" : "vi", messages: locale === "en" ? en : vi, namespace: "assistant.appLinks" });
  const links = allowedAppLinks(nav).map((link) => ({ label: t(link.key as "leaveNew"), href: link.href }));
  const answer = await driver.complete({ question, passages: ranked, locale, links });
  const citations = answer.extracted.passages.map((passage) => passage.citation);
  const answered = answer.body.length > 0 && citations.length > 0;
  // "Where to do it": the screens the question or the quoted passages name, unless the answer
  // already links to them.
  const related = answered ? appLinksFor(question, answer.extracted.passages.map((passage) => passage.excerpt), nav).filter((link) => !answer.body.includes(`](${link.href})`)) : [];
  const body = related.length ? `${answer.body}\n\n---\n\n**${t("title")}** ${related.map((link) => `[${t(link.key as "leaveNew")}](${link.href})`).join(" · ")}` : answer.body;
  return { body, citations, score: ranked[0]?.score ?? 0, answered, driver: driver.name, model: driver.model };
}

/**
 * THE WHOLE DECISION, one step up: does this question ask for the person's own data, or for the
 * knowledge base? Pure routing decides — on the question as typed, before anything is retrieved,
 * so no page and no model can choose a tool (`engine/routing.ts`).
 *
 * Still writes nothing, so the evaluation set can measure exactly what a person gets.
 */
export async function resolveAnswer(user: ViewerSource & ToolUser, question: string, locale: string): Promise<Resolved> {
  const route = routeQuestion(question, todayInVietnam());
  if (route) {
    const { outcome, audit } = await runTool(user, route);
    // A tool that answered, or refused, has settled the question; the knowledge base is not asked
    // afterwards, so a refusal can never be padded out with a policy page about somebody's salary.
    return { kind: "tool", tool: outcome, audit, outcome: outcome.status === "answered" ? "answered" : "refused" };
  }
  const answer = await answerQuestion(kbViewerOf(user), question, locale);
  return { kind: "kb", answer, outcome: answer.answered ? "answered" : "unanswered" };
}

export type Resolved =
  | { kind: "tool"; tool: ToolOutcome; audit: ToolAudit; outcome: "answered" | "refused" }
  | { kind: "kb"; answer: Answer; outcome: "answered" | "unanswered" };

export type AskResult = {
  conversationId: string;
  messageId: string;
  outcome: "answered" | "unanswered" | "refused";
  body: string;
  citations: Citation[];
  /** Set when a personal tool answered; the chat renders it in the reader's language. */
  tool: ToolOutcome | null;
  /** Best retrieval score seen, whether or not it was good enough to answer. */
  score: number;
  driver: string;
  model: string;
};

export type AiMessageRow = typeof aiMessage.$inferSelect;
export type ConversationTurn = ChatTurn & { createdAt: Date };

const citationsOf = (row: AiMessageRow): Citation[] => (Array.isArray(row.citations) ? (row.citations as Citation[]) : []);
const toolOf = (row: AiMessageRow): ToolOutcome | null => (row.toolResult ? (row.toolResult as ToolOutcome) : null);
const toTurn = (row: AiMessageRow): ConversationTurn => ({ id: row.id, role: row.role, body: row.body, outcome: row.outcome, citations: citationsOf(row), tool: toolOf(row), createdAt: row.createdAt });

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
export async function ask(user: ViewerSource & ToolUser, input: AskInput): Promise<AskResult & { audit: ToolAudit | null }> {
  const personId = user.person.id;
  const question = input.question.trim().slice(0, QUESTION_MAX);
  const locale = input.locale === "en" ? "en" : "vi";

  const resolved = await resolveAnswer(user, question, locale);
  const tool = resolved.kind === "tool" ? resolved.tool : null;
  const citations = resolved.kind === "kb" ? resolved.answer.citations : [];
  const best = resolved.kind === "kb" ? resolved.answer.score : 0;
  const body = resolved.kind === "kb" ? resolved.answer.body : "";
  const driver = resolved.kind === "kb" ? resolved.answer.driver : "tool";
  const model = resolved.kind === "kb" ? resolved.answer.model : resolved.tool.tool;
  const outcome = resolved.outcome;
  // Only a knowledge-base miss is a missing page. A tool refusal is not a gap in the handbook and
  // must never land in a log that HR reads: "who approves Lê Thị Mai's overtime" belongs nowhere.
  const logAsUnanswered = resolved.kind === "kb" && !resolved.answer.answered;

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
      .values({ conversationId, personId, role: "assistant", body, outcome, citations, tool: tool?.tool ?? null, toolResult: tool, driver, model, score: best })
      .returning();

    // The backlog of pages still to write. Only the question, never the passages that failed.
    if (logAsUnanswered) await tx.insert(aiUnansweredQuestion).values({ personId, messageId: stored.id, question, locale, bestScore: best });

    return { conversationId, messageId: stored.id, outcome, body, citations, tool, score: best, driver, model, audit: resolved.kind === "tool" ? resolved.audit : null };
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
