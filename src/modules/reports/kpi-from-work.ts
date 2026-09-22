// KPI actuals proposed from work (FR-PJM-62) — the half that reads the work.
//
// The performance module does not import PJM (development plan, "pulled, not pushed"). So this
// job, which sits with the other cross-module readers in the reports module, asks performance
// which work-sourced KPI lines are still waiting for last month's figure, counts that month of
// work for the people concerned — tasks from the work tables, days and reports from the daily
// module — and hands performance the numbers. Performance writes them as *proposals* and tells
// each scorer; nothing is scored until a person confirms.
//
// Morning slot, working on the 1st–3rd of the month only (a missed morning is caught up the next
// day). Safe to run again: a line that already has an actual is not listed as waiting.
import "server-only";
import type { IsoDate } from "@/lib/dates";
import { daysOf } from "@/modules/daily/service";
import { availableMinutesOf, isProposalDay, listWorkKpiDue, periodRange, previousMonth, proposeWorkActuals, type WorkFacts, type WorkKpiLine, workMetricValue, type WorkProposal } from "@/modules/performance/service";
import type { JobDefinition } from "../platform/jobs/service";
import { acceptedDeliverablesByAssignee, loggedMinutesByPerson, submittedReportDates, taskCountsByAssignee } from "./pjm-queries";

/** One period's work for these people, as the counts the metrics are computed from. */
async function workFactsOf(personIds: readonly string[], range: { from: IsoDate; to: IsoDate }, needsDays: boolean): Promise<Map<string, WorkFacts>> {
  const [tasks, accepted, logged, reports, days] = await Promise.all([
    taskCountsByAssignee(personIds, range),
    acceptedDeliverablesByAssignee(personIds, range),
    loggedMinutesByPerson(personIds, range),
    submittedReportDates(personIds, range),
    // The calendar and the rules of the day are only read when a metric needs them.
    needsDays ? daysOf(personIds, range.from, range.to) : Promise.resolve(new Map()),
  ]);
  const result = new Map<string, WorkFacts>();
  for (const personId of personIds) {
    const own = [...(days.get(personId)?.values() ?? [])];
    const submitted = reports.get(personId) ?? new Set<IsoDate>();
    const required = own.filter((day) => day.report.required);
    const task = tasks.get(personId);
    result.set(personId, {
      completedDated: task?.completedDated ?? 0,
      completedOnTime: task?.completedOnTime ?? 0,
      completedTasks: task?.completedTasks ?? 0,
      revisionRounds: task?.revisionRounds ?? 0,
      deliverablesAccepted: accepted.get(personId) ?? 0,
      loggedMinutes: logged.get(personId) ?? 0,
      availableMinutes: availableMinutesOf(own.map((day) => ({ date: day.day.date, kind: day.day.kind, minutes: day.minutes }))),
      reportsRequired: required.length,
      reportsSubmitted: required.filter((day) => submitted.has(day.day.date)).length,
    });
  }
  return result;
}

/** The figures for these waiting lines; a line whose metric has no basis in its period is left for the scorer. */
export async function computeProposals(lines: readonly WorkKpiLine[]): Promise<WorkProposal[]> {
  const proposals: WorkProposal[] = [];
  // A monthly and a quarterly KPI cover different spans: each period is counted once, for its people.
  for (const [periodKey, group] of Map.groupBy(lines, (line) => line.periodKey)) {
    const needsDays = group.some((line) => line.metric === "utilisation" || line.metric === "eod_compliance");
    const facts = await workFactsOf([...new Set(group.map((line) => line.personId))], periodRange(periodKey), needsDays);
    for (const line of group) {
      const value = workMetricValue(line.metric, facts.get(line.personId)!);
      if (value !== null) proposals.push({ line, value });
    }
  }
  return proposals;
}

export async function runKpiFromWork(today: IsoDate): Promise<Record<string, unknown>> {
  if (!isProposalDay(today)) return { skipped: "not_proposal_day" };
  const month = previousMonth(today);
  const waiting = await listWorkKpiDue(month);
  if (waiting.length === 0) return { month, waiting: 0, proposed: 0, notified: 0 };
  const proposals = await computeProposals(waiting);
  const { proposed, notified } = await proposeWorkActuals(proposals);
  return { month, waiting: waiting.length, proposed, withoutBasis: waiting.length - proposals.length, notified };
}

/** The morning slot, every day; it works on the 1st–3rd of the month only. */
export const kpiFromWorkJob: JobDefinition = { name: "kpi-from-work", run: ({ today }) => runKpiFromWork(today) };
