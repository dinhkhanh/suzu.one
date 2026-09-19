import "server-only";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { rollOverPlacements } from "./service";

// Daily, just after midnight in Vietnam.
export const peopleRollOverJob: JobDefinition = {
  name: "people-roll-over",
  run: ({ today }) => rollOverPlacements(today),
};
