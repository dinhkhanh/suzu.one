import "server-only";
import type { JobDefinition } from "../jobs/service";
import { deliverPendingEmails, deliverPendingPushes, sendDigests } from "./service";

// Every morning: the digest emails, then anything the outbox still holds (failed or never-sent emails).
export const notificationsDailyJob: JobDefinition = {
  name: "notifications-daily",
  run: async () => {
    const pushes = await deliverPendingPushes(500);
    return { ...(await sendDigests()), ...(await deliverPendingEmails(500)), pushesSent: pushes.sent, pushesSimulated: pushes.simulated, pushesFailed: pushes.failed };
  },
};
