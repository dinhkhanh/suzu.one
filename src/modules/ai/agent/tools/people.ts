// A person's overview (FR-AGT-14, D33): one tool that assembles a person from the modules that own
// each part, every section through that module's own door and **absent when the module refuses
// it to the asker** — as the dashboard's tiles are (FR-RPT-01):
//
//   card, unit, title, tenure   core-hr `getPersonView` (readableTier; tenure only at personal tier)
//   tasks and on-time rate      work `getPersonTaskStats`, behind performance `canReadPerformanceOf`
//                               — the gate the performance evidence page reads it under
//   utilisation, EOD reports    daily `workRecordOf` (`canViewUtilisation`, `canViewReport`)
//   attendance this month       attendance `getMonthSummaryFor` (its own check)
//   leave this year             leave `getLeaveBalanceFor` (its own check)
//   goals, KPI, review result   performance `getPerformanceResults` / `getPublishedResult`, behind
//                               `canReadPerformanceOf` / `canReadResultOf`
//
// No pay, ever: there is no section for it, and the published result's bonus multiplier is not
// read. A line manager asking about a report gets what their screens show them; a colleague is not
// offered this tool and finds the directory card with `find_person`.
import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { recordHref } from "@/lib/record-routes";
import { getMonthSummaryFor } from "@/modules/attendance/service";
import { getPersonView } from "@/modules/core-hr/service";
import { loadReportReader, workRecordOf } from "@/modules/daily/service";
import { getLeaveBalanceFor } from "@/modules/leave/service";
import { canReadPerformanceOf, canReadResultOf, getPerformanceResults, getPublishedResult, loadDirectory } from "@/modules/performance/service";
import { getPersonTaskStats } from "@/modules/work/service";
import { type AnyAgentTool, defineTool } from "../registry";
import { peopleNamed, personCard } from "./lookup";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const DAYS = (centi: number) => Math.round(centi) / 100;
const HOURS = (minutes: number) => Math.round(minutes / 6) / 10;
const PERCENT = (basisPoints: number | null) => (basisPoints === null ? null : Math.round(basisPoints) / 100);

/** A section that throws is left out, like a refused one: one module's failure does not sink the overview. */
async function section<T>(read: () => Promise<T | null>): Promise<T | null> {
  try {
    return await read();
  } catch {
    return null;
  }
}

const personOverview = defineTool({
  name: "person_overview",
  module: "people",
  description:
    "An overview of one person as the asker may see them: job, unit, manager, tenure; open and overdue tasks and on-time rate over 90 days; utilisation and end-of-day report record; attendance this month; leave this year; KPI and goal progress and the latest published review result. Sections the asker may not see are absent. Give a personId from find_person, or a name.",
  input: z.strictObject({ person: z.string().min(2).max(80).describe("personId from find_person, or the person's name.") }),
  // People who look after others: a role with any reach, a lead, or a manager. Everybody else finds
  // the directory card with find_person — this tool would show them nothing more.
  offeredTo: (principal, facts) => principal.grants.length > 0 || facts.leadsWork || facts.managesPeople,
  tier: "restricted",
  stepUp: false,
  kind: "read",
  rowCap: 10,
  tags: ["analysis"],
  run: async ({ user, today }, input) => {
    let personId = UUID.test(input.person) ? input.person : null;
    if (!personId) {
      const found = await peopleNamed(user.principal, input.person);
      if (found.length === 0) return { outcome: "empty", model: { people: [], link: "/people" }, card: null, subject: null };
      if (found.length > 1) return { outcome: "answered", model: { note: "Several people match: ask which one.", people: found.map(personCard) }, card: null, subject: null };
      personId = found[0].id;
    }
    // The card first: no card, nothing — the directory decides whether this person exists for the asker.
    const view = await getPersonView(user.principal, personId);
    if (!view) return { outcome: "refused", model: { link: "/people" }, card: null, subject: null };
    const id = personId;
    const year = Number(today.slice(0, 4));
    const directory = await loadDirectory();
    const context = directory.get(id);
    const readsPerformance = !!context && canReadPerformanceOf(user.principal, context);
    const readsResult = !!context && canReadResultOf(user.principal, context);

    const [tasks, record, attendance, leave, results, review] = await Promise.all([
      section(async () => (readsPerformance ? getPersonTaskStats({ personId: id, from: addDays(today, -90), to: today, today }) : null)),
      section(async () => workRecordOf(await loadReportReader(user.person.id, undefined, user.principal), id, today)),
      section(() => getMonthSummaryFor(user.principal, id, today.slice(0, 7))),
      section(() => getLeaveBalanceFor(user.principal, id, year)),
      section(async () => (readsPerformance ? getPerformanceResults({ personId: id, year }) : null)),
      section(async () => (readsResult ? ((await getPublishedResult(id, year)) ?? (await getPublishedResult(id, year - 1))) : null)),
    ]);

    const link = recordHref("person", id);
    const model: Record<string, unknown> = {
      link,
      name: view.fullName,
      title: view.current?.positionName ?? null,
      department: view.current?.departmentName ?? null,
      team: view.current?.teamName ?? null,
      entity: view.entityName,
      manager: view.current?.managerName ?? null,
      ...(view.personal ? { startDate: view.personal.startDate, status: view.personal.status } : {}),
    };
    const shown: string[] = ["card"];
    if (tasks) {
      model.tasks90Days = { completed: tasks.completed, onTime: tasks.onTime, late: tasks.late, onTimeRate: tasks.completed ? Math.round((tasks.onTime / tasks.completed) * 100) : null, openNow: tasks.open, overdueNow: tasks.overdue };
      shown.push("tasks");
    }
    if (record?.utilisation) {
      model.utilisation = { weeks: record.utilisation.weeks, availableHours: HOURS(record.utilisation.available), loggedHours: HOURS(record.utilisation.logged), ratio: record.utilisation.ratio, billableRatio: record.utilisation.billableRatio };
      shown.push("utilisation");
    }
    if (record?.reports) {
      model.endOfDayReports = { lastDays: record.reports.days, submitted: record.reports.submitted, late: record.reports.late, missingThisWeek: record.reports.missingRecently };
      shown.push("reports");
    }
    // Allowed and empty is a fact ("nothing recorded yet"), not a refusal: the section is there.
    if (attendance) {
      model.attendanceThisMonth = { month: today.slice(0, 7), daysRecorded: attendance.days, lateCount: attendance.lateCount, lateMinutes: attendance.lateMinutes, absentDays: attendance.absentDays, missingPunchDays: attendance.missingPunchDays, overtimeHours: HOURS(attendance.otTotalMinutes) };
      shown.push("attendance");
    }
    if (leave) {
      model.leaveThisYear = leave.filter((row) => row.usedCenti !== 0 || row.availableCenti !== 0).map((row) => ({ type: row.name, usedDays: DAYS(row.usedCenti), availableDays: DAYS(row.availableCenti) }));
      shown.push("leave");
    }
    if (results) {
      model.performanceThisYear = { kpiScorePercent: PERCENT(results.kpi.scoreBp), okrProgressPercent: PERCENT(results.okr.individual.progressBp) };
      shown.push("performance");
    }
    if (review) {
      model.latestPublishedResult = { year: review.year, finalScorePercent: PERCENT(review.finalScoreBp), band: review.finalBand };
      shown.push("review");
    }
    model.sectionsShown = shown;
    model.note = "A section that is absent is one the asker may not see; a section with zeros or an empty list is visible with nothing recorded.";
    return {
      outcome: "answered",
      model,
      card: { tool: "person_overview", href: link, items: [{ label: view.fullName, href: link, meta: view.current?.positionName ? { key: "text", params: { text: [view.current.positionName, view.current.departmentName].filter(Boolean).join(" · ") } } : null }], more: 0 },
      subject: { type: "person", id },
    };
  },
});

export const PEOPLE_TOOLS: readonly AnyAgentTool[] = [personOverview];
