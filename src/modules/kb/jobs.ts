// The knowledge base's scheduled jobs.
import "server-only";
import type { JobDefinition } from "../platform/jobs/service";
import { sendAckReminders, sendReviewDueNotices } from "./acknowledgements";

/** Morning: first notices to new joiners, reminders every three days while a confirmation is pending, and review dates that have passed. */
export const kbAckRemindersJob: JobDefinition = {
  name: "kb-ack-reminders",
  run: async ({ today }) => ({ ...(await sendAckReminders(today)), reviewDue: (await sendReviewDueNotices(today)).notified }),
};
