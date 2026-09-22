// Where the delivery dashboard gets retainer consumption and overservicing (FR-PJM-06, 60).
//
// AN ADAPTER, ON PURPOSE. Consumption is "delivered ÷ contracted" per retainer month, and what
// counts as delivered is the deliverables register's unit status (accepted, delivered, published)
// computed by the projects module's register engine — for a retainer period's own register, with
// its carried-over quantities. Re-deriving that here from the tables would be a second definition
// of "delivered" that could disagree with the retainer page, so this asks the projects module:
// `retainerConsumption` (projects/service) is the very computation the retainer page and its
// monthly report show, for many projects at once. One row per retainer month in the range;
// `summariseRetainers` (engine/delivery.ts, tested) does the rest.
//
// It answers null — "not available", which the screen says in words rather than showing an empty
// 0 % — when the reader has no retainer project in view at all; otherwise a list, empty when none
// of their retainers has a month in the period (the tile then shows "—").
import "server-only";
import type { IsoDate } from "@/lib/dates";
import { retainerConsumption } from "../projects/service";
import type { RetainerFacts } from "./engine/delivery";

export async function loadRetainerFacts(projectIds: readonly string[], range: { from: IsoDate; to: IsoDate }): Promise<RetainerFacts[] | null> {
  if (projectIds.length === 0) return null;
  const periods = await retainerConsumption(projectIds, range);
  // The dashboard counts in units and hours; the month is dropped, each month stays its own row.
  return periods.map(({ projectId, contracted, delivered, minutesAllowance, minutesLogged }) => ({ projectId, contracted, delivered, minutesAllowance, minutesLogged }));
}
