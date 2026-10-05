// The platform's nightly housekeeping: rows that were only ever meant to live for a while, and that
// nothing removed. Each sweep belongs to the module that owns the table; this job is where they are
// called from, so "it is deleted after a day" is something that happens rather than a comment.
//   · approval links (FR-PLT-24): a one-shot key that has expired has nothing left to say.
//   · import batches (FR-PLT-36): a staged spreadsheet nobody committed, and the staged rows of
//     the ones that were — personal cells sitting in plain JSON.
// Deleted files' bytes go with `files-cleanup`, and a candidate's with `candidate-retention`.
import "server-only";
import { purgeExpiredActionTokens } from "../approvals/action-tokens";
import { purgeImportBatches } from "../import/service";
import type { JobDefinition } from "./service";

export const housekeepingJob: JobDefinition = {
  name: "housekeeping",
  run: async () => ({ approvalTokens: await purgeExpiredActionTokens(), ...(await purgeImportBatches()) }),
};
