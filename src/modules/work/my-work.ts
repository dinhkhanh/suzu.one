// My work (FR-WRK-06): everything that waits for one person, from every module, in one entry of
// the shared cache's live tier (src/lib/cache/live.ts). Dropped after the person's every action
// and every notification to them; at most `TTL.live` seconds old otherwise. The page only lays
// the lists side by side.
import "server-only";
import { cachedLive } from "@/lib/cache/live";
import type { IsoDate } from "@/lib/dates";
import { listInbox } from "@/modules/platform/approvals/service";
import { listMyTasks } from "@/modules/platform/tasks-engine/service";
import { listBlockersWaitingOn } from "./blockers";
import { listCoverPlansFor } from "./cover";
import { listExitHandoversFor } from "./exit";
import { listPendingHandoffsFor } from "./handoffs";
import { listMyWorkItems } from "./leader";
import { listReviewsWaitingFor } from "./reviews";
import { listTriageForLead } from "./triage";

export type MyWork = {
  tasks: Awaited<ReturnType<typeof listMyTasks>>;
  workItems: Awaited<ReturnType<typeof listMyWorkItems>>;
  reviews: Awaited<ReturnType<typeof listReviewsWaitingFor>>;
  approvals: Awaited<ReturnType<typeof listInbox>>;
  triage: Awaited<ReturnType<typeof listTriageForLead>>;
  blockers: Awaited<ReturnType<typeof listBlockersWaitingOn>>;
  /** Hand-offs waiting for me (FR-PJM-41), leave cover I fill or cover (FR-PJM-44), handovers I run (FR-PJM-45). */
  handoffs: Awaited<ReturnType<typeof listPendingHandoffsFor>>;
  coverPlans: Awaited<ReturnType<typeof listCoverPlansFor>>;
  handovers: Awaited<ReturnType<typeof listExitHandoversFor>>;
};

export function loadMyWork(personId: string, today: IsoDate): Promise<MyWork> {
  return cachedLive(personId, "tasks", async () => {
    const [tasks, workItems, reviews, approvals, triage, blockers, handoffs, coverPlans, handovers] = await Promise.all([
      listMyTasks(personId),
      listMyWorkItems(personId),
      listReviewsWaitingFor(personId),
      listInbox(personId),
      listTriageForLead(personId),
      listBlockersWaitingOn(personId),
      listPendingHandoffsFor(personId),
      listCoverPlansFor(personId, today),
      listExitHandoversFor(personId),
    ]);
    return { tasks, workItems, reviews, approvals, triage, blockers, handoffs, coverPlans, handovers };
  });
}
