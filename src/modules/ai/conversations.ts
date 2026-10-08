// Asking the assistant a question, and the conversations that come of it (FR-AI-01).
//
// The one use-case is `ask`: retrieve with the asker's own permissions → rank → let the driver
// answer out of what came back → store the turn with its citations → log the question when nothing
// answered it. Everything a reader sees can be traced back to a `kb_page_chunk` row their viewer
// could reach.
import "server-only";
import { and, asc, desc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { createTranslator } from "next-intl";
import { navFor } from "@/components/shell/nav";
import { todayInVietnam } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { env } from "@/lib/env";
import { type KbViewer, kbViewerOf, type ViewerSource } from "@/modules/kb/service";
import { permissionReach, type Principal, reachesNothing } from "@/modules/platform/rbac/policy";
import { personInReachSql } from "@/modules/platform/rbac/reach-sql";
import en from "../../../messages/en.json";
import vi from "../../../messages/vi.json";
import { type AgentDriver, agentDriver } from "./agent/driver";
import { type AgentTurn, runAgentTurn, type ToolCallRecord } from "./agent/loop";
import type { AgentUser } from "./agent/registry";
import type { Citation } from "./engine/answer";
import { HISTORY_TURNS, type HistoryMessage, historyFor } from "./engine/history";
import { allowedAppLinks, appLinksFor } from "./engine/app-links";
import { NO_USAGE, type TokenUsage } from "./engine/limits";
import { asksToAct, routeQuestion } from "./engine/routing";
import type { AgentShown, AiNotice, AnswerOutcome, ChatTurn, ToolOutcome } from "./enums";
import { type PageContext, QUESTION_MAX } from "./enums";
import { chatDriver, localChatDriver } from "./model";
import { agentAudienceAdmits } from "./policy";
import { feedbackIn } from "./feedback";
import { linkProposals, proposalStatesIn } from "./proposals";
import { retrievePassages } from "./retrieval";
import { runTool, type ToolAudit } from "./tools";

const { aiConversation, aiMessage, aiUnansweredQuestion } = schema;

const TITLE_MAX = 120;

export type AskInput = { question: string; conversationId?: string | null; locale?: string; /** The record on screen, from the sheet (FR-AGT-02). */ page?: PageContext | null };

export type Answer = {
  body: string;
  citations: Citation[];
  score: number;
  answered: boolean;
  driver: string;
  model: string;
  /** What the driver reported it cost; zero on the local driver. */
  usage: TokenUsage;
  /** Why a model did not write this answer although there is a key: switched off, budget spent, provider down. */
  notice: AiNotice | null;
};

/**
 * Retrieve → rank → answer. THE WHOLE DECISION, with nothing written down: `ask` adds the
 * conversation and the unanswered log around it, and the evaluation set (`eval/run.ts`) measures
 * it directly, so what is measured is the same code that answers people.
 *
 * An answer exists only when the driver produced text AND retrieval produced a citation behind it.
 * There is no path in this module that shows a sentence with no source.
 */
export async function answerQuestion(user: ViewerSource, question: string, locale: string, options: { local?: boolean } = {}): Promise<Answer> {
  const viewer: KbViewer = kbViewerOf(user);
  const ranked = await retrievePassages(viewer, question);
  // After the agent fell back, the free path is free: a quoted passage, no second model call.
  const driver = options.local ? localChatDriver() : chatDriver();
  // The screens this asker's sidebar shows. Recruitment and the directory are left out: they
  // depend on rows, not roles, and nothing in the link catalogue points at them.
  const nav = new Set(navFor(viewer.principal, { people: false, recruit: false, interviews: false }).main.map((item) => item.key));
  const t = createTranslator({ locale: locale === "en" ? "en" : "vi", messages: locale === "en" ? en : vi, namespace: "assistant.appLinks" });
  const links = allowedAppLinks(nav).map((link) => ({ label: t(link.key as "leaveNew"), href: link.href }));
  const answer = await driver.complete({ asker: user, question, passages: ranked, locale, links });
  const citations = answer.extracted.passages.map((passage) => passage.citation);
  const answered = answer.body.length > 0 && citations.length > 0;
  // "Where to do it": the screens the question or the quoted passages name, unless the answer
  // already links to them.
  const related = answered ? appLinksFor(question, answer.extracted.passages.map((passage) => passage.excerpt), nav).filter((link) => !answer.body.includes(`](${link.href})`)) : [];
  const body = related.length ? `${answer.body}\n\n---\n\n**${t("title")}** ${related.map((link) => `[${t(link.key as "leaveNew")}](${link.href})`).join(" · ")}` : answer.body;
  return { body, citations, score: ranked[0]?.score ?? 0, answered, driver: answer.driver, model: answer.model, usage: answer.usage, notice: answer.notice };
}

/**
 * THE WHOLE DECISION, one step up: does this question ask for the person's own data, or for the
 * knowledge base? Pure routing decides — on the question as typed, before anything is retrieved,
 * so no page and no model can choose a tool (`engine/routing.ts`).
 *
 * Still writes nothing, so the evaluation set can measure exactly what a person gets.
 */
export async function resolveAnswer(user: AgentUser, question: string, locale: string, options: { agent?: AgentDriver | null; history?: readonly HistoryMessage[]; page?: PageContext | null } = {}): Promise<Resolved> {
  const today = todayInVietnam();
  const route = routeQuestion(question, today);
  // D33: a question about somebody else is the agent's, whose tools ask each module what the asker
  // may see; Phase 9's router only ever refused it. A question about the asker stays free.
  // R4: a request to do something is the agent's too — it proposes; the router only reads.
  if (route && !(options.agent && (route.subject === "other" || asksToAct(question)))) {
    const { outcome, audit } = await runTool(user, route);
    // A tool that answered, or refused, has settled the question; the knowledge base is not asked
    // afterwards, so a refusal can never be padded out with a policy page about somebody's salary.
    // It costs nothing, so it is asked first even when the agent is on (FR-AGT-44).
    return { kind: "tool", tool: outcome, audit, outcome: outcome.status === "answered" ? "answered" : "refused" };
  }
  if (options.agent) {
    const turn = await runAgentTurn({ user, question, locale: locale === "en" ? "en" : "vi", today, history: options.history ?? [], driver: options.agent, acting: asksToAct(question), othersPay: route?.tool === "payslip_explain" && route.subject === "other", page: options.page ?? null });
    if (turn.kind === "answered") return { kind: "agent", turn, outcome: "answered" };
    if (turn.kind === "off_topic") return { kind: "agent", turn, outcome: "off_topic" };
    // The free path: a quoted passage, with the reason the chat gives for it.
    const answer = await answerQuestion(user, question, locale, { local: true });
    const notice = turn.reason === "limited" ? null : turn.reason;
    return { kind: "kb", answer: { ...answer, notice }, outcome: turn.reason === "limited" ? "limited" : answer.answered ? "answered" : "unanswered", agentTurn: turn };
  }
  const answer = await answerQuestion(user, question, locale);
  return { kind: "kb", answer, outcome: answer.answered ? "answered" : "unanswered" };
}

export type Resolved =
  | { kind: "tool"; tool: ToolOutcome; audit: ToolAudit; outcome: "answered" | "refused" }
  | { kind: "agent"; turn: Extract<AgentTurn, { kind: "answered" | "off_topic" }>; outcome: "answered" | "off_topic" }
  /** `agentTurn`: the agent's turn that fell back to this answer, if it did. */
  | { kind: "kb"; answer: Answer; outcome: "answered" | "unanswered" | "limited"; agentTurn?: AgentTurn };

/** The agent for this asker, or none: the pilot's audience (Phase 13 R1), a key, the switch on. */
export function agentFor(user: { email?: string | null; principal: Principal }): AgentDriver | null {
  const settings = env();
  if (!agentAudienceAdmits(user.principal, user.email, { audience: settings.AI_AGENT_AUDIENCE, pilotEmails: settings.AI_AGENT_PILOT_EMAILS })) return null;
  return agentDriver();
}

export type AskResult = {
  conversationId: string;
  messageId: string;
  outcome: AnswerOutcome;
  body: string;
  citations: Citation[];
  /** Set when a personal tool answered; the chat renders it in the reader's language. */
  tool: ToolOutcome | null;
  /** Best retrieval score seen, whether or not it was good enough to answer. */
  score: number;
  driver: string;
  model: string;
  /** Tokens in and out of the model call behind the answer; zero for the local driver and a tool. */
  usage: TokenUsage;
  /** Why the answer is a quoted passage although there is a key — the chat says so. Not stored. */
  notice: AiNotice | null;
  /** When the agent answered or declined: its steps and cards, as the chat shows them. */
  agent: AgentShown | null;
};

export type AiMessageRow = typeof aiMessage.$inferSelect;
export type ConversationTurn = ChatTurn & { createdAt: Date };

const citationsOf = (row: AiMessageRow): Citation[] => (Array.isArray(row.citations) ? (row.citations as Citation[]) : []);
const toolOf = (row: AiMessageRow): ToolOutcome | null => (row.toolResult ? (row.toolResult as ToolOutcome) : null);
const agentOf = (row: AiMessageRow): AgentShown | null => {
  const stored = row.toolCalls as (AgentShown & { calls?: unknown }) | null;
  return stored ? { steps: stored.steps ?? [], cards: stored.cards ?? [], offTopic: stored.offTopic ?? null, unstored: stored.unstored ?? false } : null;
};
const toTurn = (row: AiMessageRow): ConversationTurn => ({ id: row.id, role: row.role, body: row.body, outcome: row.outcome, citations: citationsOf(row), tool: toolOf(row), agent: agentOf(row), createdAt: row.createdAt });

/**
 * An answer as a follow-up reads it: its text, and the proposals it put on cards (R4) — a card has no
 * text of its own, and "đổi hạn sang thứ Sáu" needs to know which change was proposed.
 */
function pastBody(row: { body: string; toolCalls: unknown }): string {
  const cards = (row.toolCalls as AgentShown | null)?.cards ?? [];
  const proposed = cards.flatMap((card) => (card.proposal ? [`[Proposed, awaiting the asker's confirmation: ${card.proposal.summary}]`] : []));
  return [row.body, ...proposed].filter(Boolean).join("\n");
}

/** What a follow-up is asked with (FR-AGT-04): the conversation's last turns as text, the asker's own or nothing. */
async function historyOf(personId: string, conversationId: string): Promise<HistoryMessage[]> {
  const rows = await db()
    .select({ role: aiMessage.role, body: aiMessage.body, toolCalls: aiMessage.toolCalls })
    .from(aiMessage)
    .innerJoin(aiConversation, eq(aiConversation.id, aiMessage.conversationId))
    .where(and(eq(aiMessage.conversationId, conversationId), eq(aiConversation.personId, personId)))
    .orderBy(desc(aiMessage.createdAt))
    .limit(HISTORY_TURNS * 2);
  return historyFor(rows.reverse().map((row) => ({ role: row.role, body: pastBody(row) })));
}

/** What the message row keeps of an agent turn: the calls without their results, and what was shown. */
function storedAgent(turn: AgentTurn, shown: AgentShown): Record<string, unknown> {
  return { ...shown, calls: turn.calls.map(({ tool, input, subject, outcome }) => ({ tool, input, subject, outcome })), tiers: turn.tiers, turnId: turn.turnId };
}

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
export async function ask(user: AgentUser & { email?: string | null }, input: AskInput, options: { agent?: AgentDriver | null } = {}): Promise<AskResult & { audit: ToolAudit | null; agentCalls: ToolCallRecord[] }> {
  const personId = user.person.id;
  const question = input.question.trim().slice(0, QUESTION_MAX);
  const locale = input.locale === "en" ? "en" : "vi";

  const agent = options.agent === undefined ? agentFor(user) : options.agent;
  const history = agent && input.conversationId ? await historyOf(personId, input.conversationId) : [];
  const resolved = await resolveAnswer(user, question, locale, { agent, history, page: input.page ?? null });
  const turn = resolved.kind === "agent" ? resolved.turn : resolved.kind === "kb" ? (resolved.agentTurn ?? null) : null;
  const tool = resolved.kind === "tool" ? resolved.tool : null;
  const citations = resolved.kind === "kb" ? resolved.answer.citations : resolved.kind === "agent" && resolved.turn.kind === "answered" ? resolved.turn.citations : [];
  const best = resolved.kind === "kb" ? resolved.answer.score : 0;
  const answered = resolved.kind === "agent" && resolved.turn.kind === "answered" ? resolved.turn : null;
  // D36: an answer that read pay is shown now and never written down; reopening says so.
  const unstored = answered?.compensation ?? false;
  const body = resolved.kind === "kb" ? resolved.answer.body : answered ? answered.body : "";
  const driver = resolved.kind === "kb" ? resolved.answer.driver : resolved.kind === "agent" ? "agent" : "tool";
  const model = resolved.kind === "kb" ? resolved.answer.model : resolved.kind === "agent" ? (resolved.turn.model ?? "agent") : resolved.tool.tool;
  // A tool's answer is rendered from its own data and sent to no model: it cost nothing. An agent
  // turn that fell back cost what its calls cost.
  const usage = resolved.kind === "kb" ? (turn ? turn.usage : resolved.answer.usage) : resolved.kind === "agent" ? resolved.turn.usage : NO_USAGE;
  const outcome = resolved.outcome;
  const shown: AgentShown | null = turn ? { steps: turn.calls.map(({ tool: name, outcome: ended }) => ({ tool: name, outcome: ended })), cards: answered?.cards ?? [], offTopic: turn.kind === "off_topic" ? turn.offTopic : null, unstored } : null;
  // Only a knowledge-base miss is a missing page. A tool refusal is not a gap in the handbook and
  // must never land in a log that HR reads: "who approves Lê Thị Mai's overtime" belongs nowhere.
  const logAsUnanswered = resolved.kind === "kb" && resolved.outcome === "unanswered";

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
      .values({ conversationId, personId, role: "assistant", body: unstored ? "" : body, outcome, citations, tool: tool?.tool ?? null, toolResult: tool, toolCalls: turn && shown ? storedAgent(turn, shown) : null, driver, model, score: best, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens })
      .returning();

    // The cards of this turn's proposals belong to this message (and to this conversation, which the
    // card's state is read with).
    if (turn && shown?.cards.some((card) => card.proposal)) await linkProposals(tx, { personId, turnId: turn.turnId, conversationId, messageId: stored.id });

    // The backlog of pages still to write. Only the question, never the passages that failed.
    if (logAsUnanswered) await tx.insert(aiUnansweredQuestion).values({ personId, messageId: stored.id, question, locale, bestScore: best });

    const notice = resolved.kind === "kb" ? resolved.answer.notice : null;
    return { conversationId, messageId: stored.id, outcome, body, citations, tool, score: best, driver, model, usage, notice, agent: shown, audit: resolved.kind === "tool" ? resolved.audit : null, agentCalls: turn?.calls ?? [] };
  });
}

/** The asker's own conversations, newest first. */
export async function listConversations(personId: string, limit = 20): Promise<{ id: string; title: string; updatedAt: Date }[]> {
  return db().select({ id: aiConversation.id, title: aiConversation.title, updatedAt: aiConversation.updatedAt }).from(aiConversation).where(eq(aiConversation.personId, personId)).orderBy(desc(aiConversation.updatedAt)).limit(limit);
}

/** The turns of one conversation — the asker's own, or nothing. */
export async function getConversation(personId: string, conversationId: string): Promise<{ id: string; title: string; turns: ConversationTurn[] } | null> {
  // All at once; the messages and the proposals are only returned when the conversation is the asker's.
  const [[row], messages, proposals, feedback] = await Promise.all([
    db().select().from(aiConversation).where(and(eq(aiConversation.id, conversationId), eq(aiConversation.personId, personId))).limit(1),
    db().select().from(aiMessage).where(eq(aiMessage.conversationId, conversationId)).orderBy(asc(aiMessage.createdAt)),
    proposalStatesIn(personId, conversationId),
    feedbackIn(personId, conversationId),
  ]);
  if (!row) return null;
  // A card shows its proposal as it stands now, not as it was proposed: confirmed a minute ago, the buttons are gone.
  const live = (turn: ConversationTurn): ConversationTurn =>
    turn.agent && turn.agent.cards.some((card) => card.proposal) ? { ...turn, agent: { ...turn.agent, cards: turn.agent.cards.map((card) => (card.proposal ? { ...card, proposal: { ...card.proposal, ...(proposals.get(card.proposal.id) ?? { state: "expired" as const }) } } : card)) } } : turn;
  return { id: row.id, title: row.title, turns: messages.map(toTurn).map(live).map((turn) => (feedback.has(turn.id) ? { ...turn, feedback: feedback.get(turn.id) } : turn)) };
}

export async function deleteConversation(personId: string, conversationId: string): Promise<boolean> {
  const deleted = await db().delete(aiConversation).where(and(eq(aiConversation.id, conversationId), eq(aiConversation.personId, personId))).returning({ id: aiConversation.id });
  return deleted.length > 0;
}

export type UnansweredRow = { id: string; question: string; locale: string; bestScore: number | null; createdAt: Date; askedBy: string | null; resolvedAt: Date | null; resolutionNote: string | null; asked: number };

/**
 * The askers whose questions this reader of the log may see: people inside their `kb:manage` —
 * by the asker's entity or unit, in SQL, before anything is grouped or counted. A keeper of one
 * entity's knowledge base does not read what the next entity's people asked. Null = nobody.
 */
export function askersInReach(reader: Principal): SQL | undefined | null {
  const reach = permissionReach(reader, "kb:manage");
  if (reach.all) return undefined;
  if (reachesNothing(reach)) return null;
  return personInReachSql(reach);
}

/**
 * The unanswered log, most-asked first. Questions are grouped by their accent-stripped text, so
 * "Nghỉ phép năm bao nhiêu ngày?" asked by six people is one row that says six — that is what
 * tells the knowledge base's keepers which page to write first. Only the askers in the reader's
 * reach are listed, and counted (`askersInReach`).
 */
export async function listUnanswered(reader: Principal, options: { resolved?: boolean; limit?: number } = {}): Promise<UnansweredRow[]> {
  const askers = askersInReach(reader);
  if (askers === null) return [];
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
    .innerJoin(schema.person, eq(schema.person.id, aiUnansweredQuestion.personId))
    .where(and(options.resolved ? undefined : isNull(aiUnansweredQuestion.resolvedAt), askers))
    .groupBy(grouped)
    .orderBy(desc(sql`count(*)`), desc(sql`max(${aiUnansweredQuestion.createdAt})`))
    .limit(Math.max(1, Math.min(options.limit ?? 50, 200)));
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), resolvedAt: row.resolvedAt ? new Date(row.resolvedAt) : null }));
}

/**
 * Marks every copy of the same question done — the page that answers it answers all of them —
 * among the askers in the reader's reach: the question itself must be one of theirs, and copies
 * asked outside it stay open for their own keepers.
 */
export async function resolveUnanswered(reader: Principal, id: string, byPersonId: string, note: string | null): Promise<number> {
  const askers = askersInReach(reader);
  if (askers === null) return 0;
  const inReach = askers ? inArray(aiUnansweredQuestion.personId, db().select({ id: schema.person.id }).from(schema.person).where(askers)) : undefined;
  const [row] = await db().select({ question: aiUnansweredQuestion.question }).from(aiUnansweredQuestion).where(and(eq(aiUnansweredQuestion.id, id), inReach)).limit(1);
  if (!row) return 0;
  const same = sql`lower(regexp_replace(${aiUnansweredQuestion.question}, '\\s+', ' ', 'g')) = lower(regexp_replace(${row.question}, '\\s+', ' ', 'g'))`;
  const updated = await db().update(aiUnansweredQuestion).set({ resolvedAt: new Date(), resolvedByPersonId: byPersonId, resolutionNote: note }).where(and(same, isNull(aiUnansweredQuestion.resolvedAt), inReach)).returning({ id: aiUnansweredQuestion.id });
  return updated.length;
}
