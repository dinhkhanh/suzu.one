// Feedback on an answer (Phase 13 R5, FR-AGT-51): đúng / sai with a note, from the asker, on their
// own answer; read by the owner and the handbook's keepers — each keeper the feedback of the people
// inside their `kb:manage`, as with the unanswered log.
//
// WHAT A KEEPER READS. The verdict, the note, which tiers and tools answered, the outcome — enough
// to tell a wrong figure from a missing page and Haiku from Opus. The question and the answer only
// when the asker ticked "chia sẻ câu trả lời này"; never who asked, which the keeper has no need of
// to fix a page or a prompt. The rows are counted and the question is found in SQL.
import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Principal } from "@/modules/platform/rbac/policy";
import { askersInReach } from "./conversations";
import type { FeedbackVerdict } from "./enums";

const { aiFeedback, aiMessage } = schema;

export type FeedbackInput = { messageId: string; verdict: FeedbackVerdict; note: string | null; shared: boolean };

/**
 * Gives — or changes — the asker's feedback on one answer of their own. One statement: the row is
 * written only when the message is an answer in the asker's own conversation, so somebody else's
 * message id writes nothing. Null when it was not theirs.
 */
export async function giveFeedback(personId: string, input: FeedbackInput): Promise<{ id: string } | null> {
  const note = input.note?.trim() || null;
  const [row] = await db()
    .insert(aiFeedback)
    .select(
      db()
        .select({ id: sql<string>`gen_random_uuid()`.as("id"), messageId: aiMessage.id, personId: aiMessage.personId, verdict: sql<FeedbackVerdict>`${input.verdict}::ai_feedback_verdict`.as("verdict"), note: sql<string | null>`${note}::text`.as("note"), shared: sql<boolean>`${input.shared}::boolean`.as("shared"), createdAt: sql<Date>`now()`.as("created_at"), updatedAt: sql<Date>`now()`.as("updated_at") })
        .from(aiMessage)
        .where(and(eq(aiMessage.id, input.messageId), eq(aiMessage.personId, personId), eq(aiMessage.role, "assistant"))),
    )
    .onConflictDoUpdate({ target: aiFeedback.messageId, set: { verdict: sql`excluded.verdict`, note: sql`excluded.note`, shared: sql`excluded.shared`, updatedAt: sql`now()` } })
    .returning({ id: aiFeedback.id });
  return row ?? null;
}

/** The verdicts the asker gave in one conversation of theirs, by message — for a reopened conversation. */
export async function feedbackIn(personId: string, conversationId: string): Promise<Map<string, FeedbackVerdict>> {
  const rows = await db()
    .select({ messageId: aiFeedback.messageId, verdict: aiFeedback.verdict })
    .from(aiFeedback)
    .innerJoin(aiMessage, eq(aiMessage.id, aiFeedback.messageId))
    .where(and(eq(aiMessage.conversationId, conversationId), eq(aiFeedback.personId, personId)));
  return new Map(rows.map((row) => [row.messageId, row.verdict]));
}

export type FeedbackRow = {
  id: string;
  verdict: FeedbackVerdict;
  note: string | null;
  createdAt: Date;
  outcome: string | null;
  /** The tier the agent's turn ended on ("simple", "standard", "complex"); null when no agent ran. */
  tier: string | null;
  model: string | null;
  tools: string[];
  /** Only when the asker shared them. */
  question: string | null;
  answer: string | null;
};

export type FeedbackList = { right: number; wrong: number; rows: FeedbackRow[] };

/** The feedback in the reader's reach, newest first, with the totals — counted in SQL. */
export async function listFeedback(reader: Principal, options: { verdict?: FeedbackVerdict; limit?: number } = {}): Promise<FeedbackList> {
  const askers = askersInReach(reader);
  if (askers === null) return { right: 0, wrong: 0, rows: [] };
  const inReach = askers ? sql`${aiFeedback.personId} in (select ${schema.person.id} from ${schema.person} where ${askers})` : undefined;
  // The question is the asker's message just before the answer, in the same conversation.
  const question = sql<string | null>`case when ${aiFeedback.shared} then (select q.body from ${aiMessage} q where q.conversation_id = ${aiMessage.conversationId} and q.role = 'user' and q.created_at <= ${aiMessage.createdAt} order by q.created_at desc limit 1) end`;
  const [[totals], rows] = await Promise.all([
    db()
      .select({ right: sql<number>`count(*) filter (where ${aiFeedback.verdict} = 'right')::int`, wrong: sql<number>`count(*) filter (where ${aiFeedback.verdict} = 'wrong')::int` })
      .from(aiFeedback)
      .where(inReach),
    db()
      .select({
        id: aiFeedback.id,
        verdict: aiFeedback.verdict,
        note: aiFeedback.note,
        createdAt: aiFeedback.updatedAt,
        outcome: aiMessage.outcome,
        tier: sql<string | null>`${aiMessage.toolCalls} -> 'tiers' ->> -1`,
        model: aiMessage.model,
        // Each tool once, by name: the calls' inputs and subjects stay where they are.
        tools: sql<string[]>`coalesce((select jsonb_agg(distinct c ->> 'tool') from jsonb_array_elements(coalesce(${aiMessage.toolCalls} -> 'calls', '[]'::jsonb)) c), '[]'::jsonb)`,
        question,
        answer: sql<string | null>`case when ${aiFeedback.shared} then ${aiMessage.body} end`,
      })
      .from(aiFeedback)
      .innerJoin(aiMessage, eq(aiMessage.id, aiFeedback.messageId))
      .where(and(inReach, options.verdict ? eq(aiFeedback.verdict, options.verdict) : undefined))
      .orderBy(desc(aiFeedback.updatedAt), desc(aiFeedback.id))
      .limit(Math.max(1, Math.min(options.limit ?? 50, 200))),
  ]);
  return { right: Number(totals?.right ?? 0), wrong: Number(totals?.wrong ?? 0), rows: rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt), tools: row.tools ?? [] })) };
}
