// What Phase 8 asks for: one person's year — the final KPI score and the OKR progress — in one call.
import "server-only";
import { db, type Tx } from "@/lib/db";
import { getOkrResults, type OkrResults } from "./goals";
import { getKpiResults, type KpiResults } from "./kpi-scores";

export type PerformanceResults = { personId: string; year: number; kpi: KpiResults; okr: OkrResults };

/** No authorization here: the review cycle and the bonus scheme decide who sees what they build from it. */
export async function getPerformanceResults(input: { personId: string; year: number }, executor: Tx | ReturnType<typeof db> = db()): Promise<PerformanceResults> {
  const [kpi, okr] = await Promise.all([getKpiResults(input, executor), getOkrResults(input, executor)]);
  return { ...input, kpi, okr };
}
