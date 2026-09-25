import "server-only";
import type { JobDefinition } from "../jobs/service";
import { deliverPendingMessengers } from "./messenger-outbox";
import { deliverPendingTelegrams } from "./telegram-outbox";
import { deliverPendingEmails, deliverPendingPushes, sendDigests } from "./service";

// Every morning: the digest emails, then anything the outbox still holds (failed or never-sent emails).
export const notificationsDailyJob: JobDefinition = {
  name: "notifications-daily",
  run: async () => {
    const pushes = await deliverPendingPushes(500);
    const messenger = await deliverPendingMessengers(500);
    const telegram = await deliverPendingTelegrams(500);
    return {
      ...(await sendDigests()),
      ...(await deliverPendingEmails(500)),
      pushesSent: pushes.sent,
      pushesSimulated: pushes.simulated,
      pushesFailed: pushes.failed,
      messengerSent: messenger.sent,
      messengerSimulated: messenger.simulated,
      messengerFailed: messenger.failed,
      messengerDropped: messenger.dropped,
      telegramSent: telegram.sent,
      telegramSimulated: telegram.simulated,
      telegramFailed: telegram.failed,
      telegramDropped: telegram.dropped,
    };
  },
};
