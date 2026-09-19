// The knowledge base's scheduled jobs.
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { sendAckReminders, sendReviewDueNotices } from "./acknowledgements";
import { chunkUnchunkedPages, embedPendingChunks } from "./chunks";

/** Morning: first notices to new joiners, reminders every three days while a confirmation is pending, and review dates that have passed. */
export const kbAckRemindersJob: JobDefinition = {
  name: "kb-ack-reminders",
  run: async ({ today }) => ({ ...(await sendAckReminders(today)), reviewDue: (await sendReviewDueNotices(today)).notified }),
};

/** Midnight and morning: cut any published page that has no chunks yet, then embed what has no vector of the current model. */
export const kbEmbeddingsJob: JobDefinition = {
  name: "kb-embeddings",
  run: async () => ({ chunkedPages: (await chunkUnchunkedPages()).pages, ...(await embedPendingChunks()) }),
};
