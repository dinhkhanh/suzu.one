import "server-only";
import { reassignStrandedTurns } from "@/modules/platform/approvals/service";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { sendHrAlerts } from "./alerts";
import { rewrapEncryptedFields } from "./rewrap";
import { rollOverPlacements } from "./service";

// Daily, just after midnight in Vietnam. Offboarding a leaver moves their approvals on in the same
// transaction; the sweep after it catches a turn still waiting for someone who left earlier (PLT-02).
export const peopleRollOverJob: JobDefinition = {
  name: "people-roll-over",
  run: async ({ today }) => ({ ...(await rollOverPlacements(today)), approvalTurns: await reassignStrandedTurns() }),
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
