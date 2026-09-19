// The door through which other modules say "the inputs of these person-days changed" (FR-ATT-09):
// leave approved or cancelled today, corrections and overtime later. The daily timesheet arrives
// with week 4 of Phase 2; until then there is nothing to recompute and this returns at once.
// Callers pass their transaction so that, once this writes, it writes with them.
import "server-only";
import type { IsoDate } from "@/lib/dates";
import type { db, Tx } from "@/lib/db";

type Executor = Tx | ReturnType<typeof db>;

export async function requestTimesheetRecompute(personIds: readonly string[], from: IsoDate, to: IsoDate, executor?: Executor): Promise<void> {
  // TODO(Phase 2 week 4): recompute `timesheet_day` for these people and dates unless the period is locked.
  void [personIds, from, to, executor];
}
