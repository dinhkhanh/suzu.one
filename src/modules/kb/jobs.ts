// The knowledge base's scheduled jobs.
import "server-only";
import { AI_HIT_RETENTION_DAYS, purgeAiUsageHits } from "@/modules/ai/service";
import type { JobDefinition } from "../platform/jobs/service";
import { sendAckReminders, sendReviewDueNotices } from "./acknowledgements";
import { chunkUnchunkedPages, embedPendingChunks } from "./chunks";

/** Morning: first notices to new joiners, reminders every three days while a confirmation is pending, and review dates that have passed. */
export const kbAckRemindersJob: JobDefinition = {
  name: "kb-ack-reminders",
  run: async ({ today }) => ({ ...(await sendAckReminders(today)), reviewDue: (await sendReviewDueNotices(today)).notified }),
};

/**
 * Midnight and morning: cut any published page that has no chunks yet (or chunks in an older format), then embed what has no vector of the current model.
 *
 * The assistant's housekeeping rides along, because this is the assistant's job and it has no
 * other: the counted windows of its per-person limit (`ai_usage_hit`) go once nobody can still be
 * inside them. First, so an embeddings outage does not keep them.
 */
export const kbEmbeddingsJob: JobDefinition = {
  name: "kb-embeddings",
  run: async () => {
    const aiUsageHits = await purgeAiUsageHits(new Date(Date.now() - AI_HIT_RETENTION_DAYS * 24 * 60 * 60 * 1000));
    return { aiUsageHits, chunkedPages: (await chunkUnchunkedPages()).pages, ...(await embedPendingChunks()) };
  },
};
