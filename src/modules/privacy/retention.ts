// The nightly retention sweeps (NFR-PRV-02, 04): what was only ever meant to be kept for a while,
// gone when its while is over — every night, whether or not anybody opens the app.
//   · the exact position of a check-in from the app, with its network address and browser details
//     (`PUNCH_POSITION_RETENTION_DAYS`); the punch and its verdict stay with the timesheet;
//   · conversations with the assistant and the questions it could not answer
//     (`AI_CONVERSATION_RETENTION_DAYS`).
// Both are single statements over rows that still hold something, so a second run the same night
// finds nothing left to do.
import "server-only";
import { and, isNotNull, lt, ne, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/lib/db";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { AI_CONVERSATION_RETENTION_DAYS, cutoffBefore, PUNCH_POSITION_RETENTION_DAYS } from "./engine/retention";

type Executor = Tx | ReturnType<typeof db>;

/** What a check-in from the app carries about where and how it was made. */
export const PUNCH_POSITION_FIELDS = { latitude: null, longitude: null, accuracyM: null, ipAddress: null, userAgent: null, deviceInfo: null } as const;

const holdsPosition = or(isNotNull(schema.punch.latitude), isNotNull(schema.punch.longitude), isNotNull(schema.punch.ipAddress), isNotNull(schema.punch.userAgent), isNotNull(schema.punch.deviceInfo));

/**
 * Clears the position of app check-ins made before `before`. Only `source = 'app'`: a punch filed
 * by an approved correction keeps its `device_info`, which is where it names its request. A check-in
 * still waiting for its reviewer keeps everything the reviewer needs to decide.
 */
export async function clearPunchPositions(before: Date, executor: Executor = db()): Promise<number> {
  const cleared = await executor
    .update(schema.punch)
    .set(PUNCH_POSITION_FIELDS)
    .where(and(sql`${schema.punch.source} = 'app'`, lt(schema.punch.at, before), ne(schema.punch.reviewStatus, "pending"), holdsPosition))
    .returning({ id: schema.punch.id });
  return cleared.length;
}

/** Deletes conversations last touched before `before` (their messages go with them) and the unanswered questions logged before it. */
export async function purgeAiConversations(before: Date, executor: Executor = db()): Promise<{ conversations: number; unansweredQuestions: number }> {
  const conversations = await executor.delete(schema.aiConversation).where(lt(schema.aiConversation.updatedAt, before)).returning({ id: schema.aiConversation.id });
  const questions = await executor.delete(schema.aiUnansweredQuestion).where(lt(schema.aiUnansweredQuestion.createdAt, before)).returning({ id: schema.aiUnansweredQuestion.id });
  return { conversations: conversations.length, unansweredQuestions: questions.length };
}

export const privacyRetentionJob: JobDefinition = {
  name: "privacy-retention",
  run: async () => {
    const now = new Date();
    return {
      punchPositions: await clearPunchPositions(cutoffBefore(now, PUNCH_POSITION_RETENTION_DAYS)),
      ...(await purgeAiConversations(cutoffBefore(now, AI_CONVERSATION_RETENTION_DAYS))),
    };
  },
};
