// The owner dashboard, v2 (FR-RPT-01, FR-RPT-05).
//
// Nine tiles: headcount and movement, payroll cost, attendance today, leave today, open
// positions, overdue obligations, work at risk, project health and overdue milestones (Phase 10,
// FR-PJM-60), approvals waiting on me.
//
// **This file owns no data.** Every tile is one call into the owning module's `service.ts` with
// *the reader's own principal*, and each of those calls already scopes itself — that is the whole
// design. So:
//  - a department head sees their department's headcount and **no payroll tile at all**, because
//    they hold no `payroll:read` and the tile is absent rather than zeroed (a nil figure and a
//    hidden figure must not look the same);
//  - a plain employee sees their own approvals and their own work, and nothing else;
//  - nothing is recomputed here, so the dashboard and the screen behind a tile cannot disagree.
//
// Tiles are gathered in parallel and each one is allowed to fail on its own: a broken payroll
// report must not take the dashboard down for the eight other things the owner came to look at.
import "server-only";
import { addDays, type IsoDate, todayInVietnam } from "@/lib/dates";
import { getWhoIsIn } from "@/modules/attendance/service";
import { getHeadcountReport } from "@/modules/core-hr/service";
import { getTeamCalendar } from "@/modules/leave/service";
import { listInstances } from "@/modules/ops/service";
import { costTrend, payrollReadReach, type TrendPoint } from "@/modules/payroll/service";
import { countInbox } from "@/modules/platform/approvals/service";
import type { PersonRow } from "@/modules/platform/people/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { canReadRecruitReports, defaultReportFrom, getRecruitReport } from "@/modules/recruit/service";
import { getLeaderView, loadViewer } from "@/modules/work/service";
import { type DeliveryTile, getDeliveryTile } from "./delivery";

export type DashboardViewer = { person: PersonRow; principal: Principal };

export type HeadcountTile = { total: number; joiners: number; leavers: number; contractsExpiring: number; probations: number; scoped: boolean };
export type PayrollTile = { points: TrendPoint[]; latest: TrendPoint | null; previous: TrendPoint | null };
export type AttendanceTile = { date: IsoDate; in: number; notYet: number; offSite: number; out: number; onLeave: number; people: number };
export type LeaveTile = { date: IsoDate; away: { personId: string; fullName: string; departmentName: string | null; typeName: string | null; pending: boolean }[] };
export type RecruitTile = { openOpenings: number; applications: number; active: number };
export type OpsTile = { overdue: number; dueSoon: number; worst: { entityCode: string; templateName: string; dueDate: IsoDate; assigneeName: string | null }[] };
export type WorkTile = { open: number; overdue: number; atRisk: number };
export type ApprovalsTile = { waiting: number };

export type Dashboard = {
  today: IsoDate;
  /** The period the movement and work figures cover: this month so far. */
  period: { from: IsoDate; to: IsoDate };
  headcount: HeadcountTile | null;
  payroll: PayrollTile | null;
  attendance: AttendanceTile | null;
  leave: LeaveTile | null;
  recruit: RecruitTile | null;
  ops: OpsTile | null;
  work: WorkTile | null;
  /** Health and overdue milestones of the running projects the reader may open (FR-PJM-60). */
  delivery: DeliveryTile | null;
  approvals: ApprovalsTile;
};

/** A tile that throws is a missing tile, not a broken page. The reason is logged, not shown. */
async function tile<T>(name: string, load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    console.error(JSON.stringify({ level: "error", event: "dashboard.tile_failed", tile: name, message: error instanceof Error ? error.message : String(error) }));
    return null;
  }
}

/**
 * Does this person hold `payroll:read` over any entity at all? The figures themselves are still
 * filtered in SQL by `costTrend`; this only decides whether the tile or the catalogue entry is
 * offered, so that a reader with no reach sees nothing rather than an empty compensation table.
 */
function hasPayrollReach(principal: Principal): boolean {
  const reach = payrollReadReach(principal);
  return reach.all || reach.entityIds.length > 0;
}

const DUE_SOON_DAYS = 14;

export async function getDashboard(user: DashboardViewer, today: IsoDate = todayInVietnam()): Promise<Dashboard> {
  const period = { from: `${today.slice(0, 8)}01`, to: today };
  const viewerId = { personId: user.person.id, principal: user.principal };

  const [headcount, payroll, attendance, leave, recruit, ops, work, delivery, waiting] = await Promise.all([
    tile("headcount", async () => {
      if (!can(user.principal, "report:read")) return null;
      const report = await getHeadcountReport(user.principal, { asOf: today, from: period.from, to: period.to });
      if (!report) return null;
      return { total: report.snapshot.total, joiners: report.movement.joiners, leavers: report.movement.leavers, contractsExpiring: report.contractsExpiring.length, probations: report.probations.length, scoped: report.scoped } satisfies HeadcountTile;
    }),

    tile("payroll", async () => {
      // Compensation: absent for anybody without `payroll:read`, never an empty-looking zero.
      if (!hasPayrollReach(user.principal)) return null;
      const from = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
      from.setUTCMonth(from.getUTCMonth() - 5);
      const points = await costTrend(user.principal, { fromMonth: from.toISOString().slice(0, 7), toMonth: today.slice(0, 7) });
      return { points, latest: points.at(-1) ?? null, previous: points.at(-2) ?? null } satisfies PayrollTile;
    }),

    tile("attendance", async () => {
      const presence = await getWhoIsIn(viewerId);
      // Only the person themselves: no tile worth a row on a dashboard.
      if (presence.rows.length <= 1) return null;
      return { date: presence.date, in: presence.counts.in, notYet: presence.counts.not_yet, offSite: presence.counts.off_site, out: presence.counts.out, onLeave: presence.counts.on_leave, people: presence.rows.length } satisfies AttendanceTile;
    }),

    tile("leave", async () => {
      const calendar = await getTeamCalendar(viewerId, { from: today, to: today });
      const away = calendar.people
        .flatMap((person) => person.cells.filter((cell) => cell.date === today).map((cell) => ({ personId: person.personId, fullName: person.fullName, departmentName: person.departmentName, typeName: cell.typeName, pending: cell.status === "pending" })))
        .sort((left, right) => left.fullName.localeCompare(right.fullName));
      return away.length ? ({ date: today, away } satisfies LeaveTile) : null;
    }),

    tile("recruit", async () => {
      if (!canReadRecruitReports(user.principal)) return null;
      const report = await getRecruitReport(user.principal, { from: defaultReportFrom(today, 6), to: today });
      if (report.openOpenings === 0 && report.applications === 0) return null;
      return { openOpenings: report.openOpenings, applications: report.applications, active: report.active } satisfies RecruitTile;
    }),

    tile("ops", async () => {
      if (!can(user.principal, "ops:read") && !can(user.principal, "ops:manage")) return null;
      const soon = addDays(today, DUE_SOON_DAYS);
      const instances = await listInstances(viewerId, { open: true, dueTo: soon, limit: 200 }, today);
      const dueOn = (instance: { dueDate: IsoDate | null; nominalDueDate: IsoDate }) => instance.dueDate ?? instance.nominalDueDate;
      const overdue = instances.filter((instance) => dueOn(instance) < today);
      return {
        overdue: overdue.length,
        dueSoon: instances.filter((instance) => dueOn(instance) >= today).length,
        worst: overdue
          .sort((left, right) => dueOn(left).localeCompare(dueOn(right)))
          .slice(0, 5)
          .map((instance) => ({ entityCode: instance.entityCode, templateName: instance.templateName, dueDate: dueOn(instance), assigneeName: instance.assigneeName })),
      } satisfies OpsTile;
    }),

    tile("work", async () => {
      const viewer = await loadViewer(user);
      const view = await getLeaderView(viewer, today);
      if (view.totals.open === 0) return null;
      return view.totals satisfies WorkTile;
    }),

    // Projects the reader may open, and nothing else: the same rows as the portfolio.
    tile("delivery", () => getDeliveryTile(user, today)),

    countInbox(user.person.id),
  ]);

  return { today, period, headcount, payroll, attendance, leave, recruit, ops, work, delivery, approvals: { waiting } };
}
