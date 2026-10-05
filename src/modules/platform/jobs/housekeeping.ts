// The platform's nightly housekeeping (ENG-04): rows that were only ever meant to live for a while,
// and that nothing removed. Each sweep belongs to the module that owns the table, with its
// retention period as a named constant beside it saying why; this job is where they are called
// from, so "it is deleted after a while" is something that happens rather than a comment.
//   · approval links (FR-PLT-24): a one-shot key that has expired has nothing left to say.
//   · import batches (FR-PLT-36): a staged spreadsheet nobody committed, and the staged rows of
//     the ones that were — personal cells sitting in plain JSON.
//   · sign-in leftovers: expired sessions, unfinished sign-in states, the rate limiter's windows
//     (`auth/retention.ts`).
//   · notifications after half a year; the email, push, Chat, Messenger and Telegram delivery
//     logs after a quarter; spent link attempts after a month (`notifications/retention.ts`).
//   · job runs after a quarter (`service.ts`) — this job's own row of tonight among the survivors.
// Deleted files' bytes go with `files-cleanup`, and a candidate's with `candidate-retention`.
import "server-only";
import { purgeImportBatches } from "../import/service";
import { purgeExpiredActionTokens } from "../approvals/action-tokens";
import { purgeExpiredAuthRows } from "../auth/retention";
import { purgeNotificationHistory } from "../notifications/retention";
import { type JobDefinition, purgeJobRuns } from "./service";

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  run: async () => {
    const now = new Date();
    return {
      approvalTokens: await purgeExpiredActionTokens(),
      ...(await purgeImportBatches()),
      ...(await purgeExpiredAuthRows(now)),
      ...(await purgeNotificationHistory(now)),
      jobRuns: await purgeJobRuns(now),
    };
  },
};
