// HR (FR-AGT-15): headcount, movement and turnover; contracts and probations coming to an end; the
// recruitment funnel and the openings standing open; leave taken by unit. Each tool is one door of
// the module that owns the figures, read with the asker's principal — and each of those doors
// already scopes itself: a department head counts their department, an entity's HR their entity.
//
//   headcount                     core-hr `getHeadcountReport` (`report:read`, by its reach)
//   contracts_ending              core-hr `listContractsDue` (the same report's lists, same reach)
//   recruitment                   recruit `getRecruitReport` + `listOpenings` (`canReadRecruitReports`,
//                                 `openingScope`)
//   leave_by_unit                 leave `getLeaveTakenByUnit` (the team calendar's own people)
//
// The model reads counts. The two lists that name people (contracts, probations) carry what the
// headcount report shows its reader — a name, a unit, a contract type and its last day.
import "server-only";
import { z } from "zod";
import { addDays } from "@/lib/dates";
import { recordHref } from "@/lib/record-routes";
import { getHeadcountReport, listContractsDue } from "@/modules/core-hr/service";
import { getLeaveTakenByUnit } from "@/modules/leave/service";
import { can } from "@/modules/platform/rbac/policy";
import { canReadRecruitReports, getRecruitReport, listOpenings } from "@/modules/recruit/service";
import { TURN_CEILINGS } from "../../engine/tiers";
import { modelRows } from "../../engine/views";
import { type AnyAgentTool, defineTool } from "../registry";
import { PERIOD_INPUT, percentOf, periodOf } from "./period";

const CAP = TURN_CEILINGS.rowsPerTool;
const DAYS = (centi: number) => Math.round(centi) / 100;
const readsReports = (principal: Parameters<typeof can>[0]) => can(principal, "report:read");
/** People who look after others: anyone with a role, a lead, or a manager. */
const looksAfterPeople = (principal: { grants: readonly unknown[] }, facts: { leadsWork: boolean; managesPeople: boolean }) => principal.grants.length > 0 || facts.leadsWork || facts.managesPeople;

const headcount = defineTool({
  name: "headcount",
  module: "core-hr",
  description:
    "Headcount within the asker's reporting scope — how many people work here, in which entity or department (which is largest): the total on a day, by entity, department, workforce type, gender, age band and seniority band; and the movement over a period — opening and closing headcount, joiners, leavers, turnover (leavers ÷ average headcount) and joiners and leavers by department. Default period: this month.",
  input: z.strictObject({ ...PERIOD_INPUT }),
  offeredTo: readsReports,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const period = periodOf(input, today, "month");
    const report = await getHeadcountReport(user.principal, { asOf: period.to, from: period.from, to: period.to });
    if (!report) return { outcome: "refused", model: { link: "/reports" }, card: null, subject: null };
    const { snapshot, movement } = report;
    const counts = (rows: readonly { key: string; count: number }[]) => modelRows(rows, { key: "value", count: "value" }, CAP);
    return {
      outcome: "answered",
      model: {
        link: "/reports/headcount",
        scope: report.scoped ? "the asker's part of the company" : "the whole group",
        asOf: snapshot.asOf,
        total: snapshot.total,
        byEntity: counts(snapshot.byEntity),
        byDepartment: counts(snapshot.byDepartment),
        byWorkforceType: counts(snapshot.byWorkforceType),
        byGender: counts(snapshot.byGender),
        byAge: counts(snapshot.byAge),
        bySeniority: counts(snapshot.bySeniority),
        movement: { from: movement.from, to: movement.to, opening: movement.opening, closing: movement.closing, joiners: movement.joiners, leavers: movement.leavers, turnoverPercent: percentOf(movement.turnoverBp), joinersByDepartment: counts(movement.joinersByDepartment), leaversByDepartment: counts(movement.leaversByDepartment) },
        contractsEndingWithin90Days: report.contractsExpiring.length,
        probationsRunning: report.probations.length,
      },
      card: { tool: "headcount", href: "/reports/headcount", items: [{ label: "", title: { key: "headcountOn", params: { total: snapshot.total, date: snapshot.asOf } }, href: "/reports/headcount", meta: { key: "movement", params: { joiners: movement.joiners, leavers: movement.leavers } } }], more: 0 },
      subject: null,
    };
  },
});

const contractsEnding = defineTool({
  name: "contracts_ending",
  module: "core-hr",
  description:
    "Contracts coming to an end within the asker's reporting scope: fixed-term, service and internship contracts ending in the next 90 days, and probation contracts still running, each with the person, entity, department, contract type and last day. Use it for 'whose contract ends soon' and 'who is on probation'.",
  input: z.strictObject({
    kind: z.enum(["all", "contracts", "probations"]).optional().describe("all (default), contracts (not probation), probations"),
    withinDays: z.number().int().min(1).max(90).optional().describe("Only those ending within N days from today. Default 90."),
  }),
  offeredTo: readsReports,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const report = await listContractsDue(user.principal, today);
    if (!report) return { outcome: "refused", model: { link: "/reports" }, card: null, subject: null };
    const until = addDays(today, input.withinDays ?? 90);
    const kind = input.kind ?? "all";
    const rows = [...(kind === "probations" ? [] : report.contractsExpiring), ...(kind === "contracts" ? [] : report.probations)].filter((row) => row.endDate <= until).sort((a, b) => a.endDate.localeCompare(b.endDate));
    if (rows.length === 0) return { outcome: "empty", model: { link: "/reports/headcount", rows: [], kind, until }, card: null, subject: null };
    const shaped = rows.map((row) => ({ name: row.fullName, entity: row.entity, department: row.department, contractType: row.type, endDate: row.endDate, link: recordHref("person", row.personId), personId: row.personId }));
    return {
      outcome: "answered",
      model: { link: "/reports/headcount", today, until, ...modelRows(shaped, { name: "text", entity: "text", department: "text", contractType: "value", endDate: "value", link: "value" }, CAP) },
      card: { tool: "contracts_ending", href: "/reports/headcount", items: shaped.slice(0, 8).map((row) => ({ label: row.name, href: row.link, meta: { key: row.contractType === "probation" ? "probationEnds" : "contractEnds", params: { date: row.endDate } } })), more: Math.max(0, shaped.length - 8) },
      subject: null,
    };
  },
});

const recruitment = defineTool({
  name: "recruitment",
  module: "recruit",
  description:
    "Recruitment within the asker's scope: the openings standing open (title, entity, department, headcount wanted, active applications, hired), and the funnel over a period — applications, active, rejected, withdrawn, how many reached each stage, time to hire, and which sources produce hires. Default period: the last six months.",
  input: z.strictObject({ ...PERIOD_INPUT }),
  offeredTo: canReadRecruitReports,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const period = periodOf(input, today, { daysBack: 183 });
    const [report, openings] = await Promise.all([getRecruitReport(user.principal, { from: period.from, to: period.to }), listOpenings(user.principal, { status: "open" })]);
    const shaped = openings.map((row) => ({ code: row.code, title: row.title, entity: row.entityName, department: row.departmentName, headcount: row.headcount, activeApplications: row.activeApplications, hired: row.hiredCount, link: recordHref("opening", row.id) }));
    return {
      outcome: "answered",
      model: {
        link: "/recruit/reports",
        period,
        openOpenings: modelRows(shaped, { code: "value", title: "text", entity: "text", department: "text", headcount: "value", activeApplications: "value", hired: "value", link: "value" }, CAP),
        funnel: {
          applications: report.applications,
          active: report.active,
          rejected: report.rejected,
          withdrawn: report.withdrawn,
          stages: report.steps.map((step) => ({ stage: step.category, reached: step.reached, shareOfAppliedPercent: step.shareOfApplied })),
          timeToHireDays: { hires: report.timeToHire.hires, median: report.timeToHire.median, mean: report.timeToHire.mean },
          sources: report.sources.slice(0, 10).map((row) => ({ source: row.source, applications: row.applications, interviewed: row.interviewed, hires: row.hires })),
        },
      },
      card: shaped.length
        ? { tool: "recruitment", href: "/recruit", items: shaped.slice(0, 8).map((row) => ({ label: row.title, href: row.link, meta: { key: "applications", params: { count: row.activeApplications } } })), more: Math.max(0, shaped.length - 8) }
        : { tool: "recruitment", href: "/recruit/reports", items: [{ label: "", title: { key: "applicationsIn", params: { count: report.applications } }, href: "/recruit/reports", meta: null }], more: 0 },
      subject: null,
    };
  },
});

const leaveByUnit = defineTool({
  name: "leave_by_unit",
  module: "leave",
  description:
    "Approved leave taken over a period by the people whose leave calendar the asker sees, per department: how many people took leave and how many days in total. No names and no leave types. Default period: this month. For who is away today use who_is_in.",
  input: z.strictObject({ ...PERIOD_INPUT }),
  offeredTo: looksAfterPeople,
  tier: "personal",
  stepUp: false,
  kind: "read",
  rowCap: CAP,
  tags: [],
  run: async ({ user, today }, input) => {
    const period = periodOf(input, today, "month");
    const rows = await getLeaveTakenByUnit({ personId: user.person.id, principal: user.principal }, period);
    if (rows.length === 0) return { outcome: "empty", model: { link: "/leave/calendar", period, rows: [] }, card: null, subject: null };
    const shaped = rows.map((row) => ({ department: row.departmentName ?? "—", people: row.people, days: DAYS(row.daysCenti) }));
    return {
      outcome: "answered",
      model: { link: "/leave/calendar", period, totalDays: DAYS(rows.reduce((sum, row) => sum + row.daysCenti, 0)), ...modelRows(shaped, { department: "text", people: "value", days: "value" }, CAP) },
      card: { tool: "leave_by_unit", href: "/leave/calendar", items: shaped.slice(0, 8).map((row) => ({ label: row.department, href: null, meta: { key: "leaveTaken", params: { people: row.people, days: row.days } } })), more: Math.max(0, shaped.length - 8) },
      subject: null,
    };
  },
});

export const HR_TOOLS: readonly AnyAgentTool[] = [headcount, contractsEnding, recruitment, leaveByUnit];
