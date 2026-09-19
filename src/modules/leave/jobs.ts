import "server-only";
import type { JobDefinition } from "@/modules/platform/jobs/service";
import { runLeaveAccruals } from "./ledger";

// Daily, after the people roll-over: monthly accruals and yearly grants that became due, the
// year-end carry-over, lapsed carried days, payouts on termination. Idempotent.
export const leaveAccrualJob: JobDefinition = {
  name: "leave-accrual",
  run: ({ today }) => runLeaveAccruals(today),
};
