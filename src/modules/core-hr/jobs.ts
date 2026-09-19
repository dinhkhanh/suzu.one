import "server-only";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { sendHrAlerts } from "./alerts";
import { rewrapEncryptedFields } from "./rewrap";
import { rollOverPlacements } from "./service";

// Daily, just after midnight in Vietnam.
export const peopleRollOverJob: JobDefinition = {
  name: "people-roll-over",
  run: ({ today }) => rollOverPlacements(today),
};

// Every morning: contract-expiry, probation-end and document-expiry countdowns.
export const hrAlertsJob: JobDefinition = {
  name: "hr-alerts",
  run: ({ today }) => sendHrAlerts(today),
};

// Not scheduled: run by hand after a new key was put first in DATA_ENCRYPTION_KEYS.
export const fieldKeysRewrapJob: JobDefinition = {
  name: "field-keys-rewrap",
  run: () => rewrapEncryptedFields(),
};
