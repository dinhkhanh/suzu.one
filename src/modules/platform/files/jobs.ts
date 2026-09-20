import "server-only";
import type { JobDefinition } from "../jobs/service";
import { purgeAbandonedUploads } from "./service";

export const filesCleanupJob: JobDefinition = {
  name: "files-cleanup",
  run: () => purgeAbandonedUploads(),
};
