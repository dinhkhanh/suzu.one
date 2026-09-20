// The evidence panel of a review (FR-PRF-07): what the person actually did in the period, beside
// the form the manager is filling in — so a rating is argued from the record and not from memory.
//
// Every line comes **through the owning module's `service.ts`**, never by reaching into another
// module's tables:
//
//   goals & KPI scores   performance itself (`getPerformanceResults`)
//   task statistics      work            (`getPersonTaskStats` — counts, no titles)
//   kudos                comms           (`listKudos`)
//   attendance           attendance      (`summarisePersonYear`)
//
// The panel is **personal tier**, exactly like the review it sits in: the page shows it only to
// somebody who already passed `canReadPerformanceOf` for this person. Nothing here is
// compensation — no salary, no bonus, no amount of any kind. Training completion (the fifth
// source FR-PRF-07 names) has no module yet and is left out.
import "server-only";
import { db, type Tx } from "@/lib/db";
import { summarisePersonYear } from "@/modules/attendance/service";
import { type KudosCard, listKudos } from "@/modules/comms/service";
import { getPersonTaskStats, type PersonTaskStats } from "@/modules/work/service";
import type { MonthSummary } from "@/modules/attendance/service";
import { getPerformanceResults, type PerformanceResults } from "./results";

type Executor = Tx | ReturnType<typeof db>;

export type ReviewEvidence = {
  personId: string;
  year: number;
  performance: PerformanceResults;
  tasks: PersonTaskStats;
  attendance: MonthSummary;
  kudos: { count: number; recent: KudosCard[] };
};

const KUDOS_SHOWN = 5;

/**
 * Everything the panel shows for one person and one year. Each source is asked independently, so
 * a module that has nothing for this person (no work tasks, no punches) simply contributes zeroes
 * rather than failing the panel.
 */
export async function loadReviewEvidence(input: { personId: string; year: number }, executor: Executor = db()): Promise<ReviewEvidence> {
  const from = `${input.year}-01-01`;
  const to = `${input.year}-12-31`;
  const [performance, tasks, attendance, kudos] = await Promise.all([
    getPerformanceResults(input, executor),
    getPersonTaskStats({ personId: input.personId, from, to }, executor),
    summarisePersonYear(input.personId, input.year, executor),
    listKudos({ toPersonId: input.personId, limit: 50 }),
  ]);
  const inYear = kudos.filter((card) => card.createdAt >= new Date(`${from}T00:00:00Z`) && card.createdAt <= new Date(`${to}T23:59:59Z`));
  return { ...input, performance, tasks, attendance, kudos: { count: inYear.length, recent: inYear.slice(0, KUDOS_SHOWN) } };
}
