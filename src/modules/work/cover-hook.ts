// Leave cover's answer to a change of leave (FR-PJM-44): registered with the platform's
// leave-change hooks (work/schema.ts registers it; leave-changes/registry.ts explains why there).
// The person's plans are brought in line at once — a draft for a request just filed, a plan
// cancelled with its leave — by the same read the night's job does for everyone.
import "server-only";
import { todayInVietnam } from "@/lib/dates";
import type { LeaveChangeHook } from "../platform/leave-changes/registry";
import { syncCoverPlans } from "./cover";

export const coverOnLeaveChange: LeaveChangeHook = async ({ personId }) => {
  await syncCoverPlans(todayInVietnam(), { personId });
};
