import "server-only";
import type { JobDefinition } from "../jobs/service";
import { deliverPendingEmails, sendDigests } from "./service";

// Every morning: the digest emails, then anything the outbox still holds (failed or never-sent emails).
export const notificationsDailyJob: JobDefinition = {
  name: "notifications-daily",
  run: async () => ({ ...(await sendDigests()), ...(await deliverPendingEmails(500)) }),
};
