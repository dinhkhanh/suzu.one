import "server-only";
import type { JobDefinition } from "../jobs/service";
import { purgeAbandonedUploads, purgeDeletedFiles } from "./service";

// The storage sweep: uploads nobody finished, and the bytes of files deleted more than the grace
// period ago. Abandoned uploads first — they are the cheaper half, and a refusal from storage while
// removing deleted files fails the run only after they are done.
export const filesCleanupJob: JobDefinition = {
  name: "files-cleanup",
  run: async () => ({ ...(await purgeAbandonedUploads()), ...(await purgeDeletedFiles()) }),
};
