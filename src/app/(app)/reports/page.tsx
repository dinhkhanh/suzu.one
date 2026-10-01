import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { can } from "@/modules/platform/rbac/policy";
import { canManageSchedules, canReadProfitability, getDashboard } from "@/modules/reports/service";
import { ReportTile } from "@/modules/reports/ui/report-tile";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("overview");

/**
 * The owner dashboard, v2 (FR-RPT-01). Each tile is one call into the owning module's service with
 * this reader's principal, so what shows up here is exactly what they could reach a screen at a
 * time — never more. A tile they may not see is **absent**, not zero: an empty figure and a hidden
 * figure must not look alike.
 *
 * The payroll tile is the one exception to "just show it": compensation figures sit behind step-up
 * re-authentication everywhere else (FR-PLT-06), so without a fresh proof this page offers the link
 * that asks for one rather than the numbers.
 */
export default async function ReportsOverviewPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [dashboard, t, tSchedules, format] = await Promise.all([getDashboard(user, today), getTranslations("reports.overview"), getTranslations("reports.schedules"), getFormatter()]);
  const money = (amount: number) => format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 });
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const stepUpFresh = isStepUpFresh(user.reauthAt);
  const join = (...parts: (string | null | false)[]) => parts.filter(Boolean).join(" · ");
  const tiles: ReactNode[] = [];

  if (dashboard.headcount) {
    const tile = dashboard.headcount;
    tiles.push(
      <ReportTile key="headcount" title={t("tiles.headcount")} href="/reports/headcount" value={tile.total} hint={join(`${t("headcount.joiners")} ${tile.joiners}`, `${t("headcount.leavers")} ${tile.leavers}`, tile.contractsExpiring > 0 && `${t("headcount.contracts")} ${tile.contractsExpiring}`, tile.probations > 0 && `${t("headcount.probations")} ${tile.probations}`, tile.scoped && t("scoped"))} />,
    );
  }

  if (dashboard.payroll) {
    const tile = dashboard.payroll;
    const change = tile.latest && tile.previous ? format.number((tile.latest.employerCost - tile.previous.employerCost) / Math.max(1, tile.previous.employerCost), { style: "percent", maximumFractionDigits: 1, signDisplay: "exceptZero" }) : null;
    tiles.push(
      !stepUpFresh ? (
        <ReportTile key="payroll" title={t("tiles.payroll")} href={`/step-up?next=${encodeURIComponent("/payroll/reports")}`} value="•••" hint={t("payroll.locked")} />
      ) : tile.latest ? (
        <ReportTile key="payroll" title={t("tiles.payroll")} href="/payroll/reports" value={money(tile.latest.employerCost)} hint={join(t("payroll.month", { month: tile.latest.month }), change && `${t("payroll.change")} ${change}`, `${t("payroll.headcount")} ${tile.latest.headcount}`)} series={tile.points.map((point) => point.employerCost)} />
      ) : (
        <ReportTile key="payroll" title={t("tiles.payroll")} href="/payroll/reports" value="—" hint={t("payroll.noRuns")} />
      ),
    );
  }

  if (dashboard.attendance) {
    const tile = dashboard.attendance;
    tiles.push(<ReportTile key="attendance" title={t("tiles.attendance")} href="/attendance/today" value={tile.in + tile.offSite} hint={join(t("attendance.of", { total: tile.people }), tile.notYet > 0 && `${t("attendance.notYet")} ${tile.notYet}`, `${t("attendance.onLeave")} ${tile.onLeave}`)} tone={tile.notYet > 0 ? "warning" : undefined} />);
  }

  if (dashboard.leave) {
    const tile = dashboard.leave;
    tiles.push(
      <ReportTile key="leave" title={t("tiles.leave")} href="/leave/calendar" value={tile.away.length} hint={t("leave.away", { count: tile.away.length })}>
        <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
          {tile.away.slice(0, 4).map((person) => (
            <li key={person.personId} className="truncate">
              {person.fullName}
              {person.departmentName ? ` · ${person.departmentName}` : ""}
              {person.pending ? ` · ${t("leave.pending")}` : ""}
            </li>
          ))}
        </ul>
      </ReportTile>,
    );
  }

  if (dashboard.recruit) {
    const tile = dashboard.recruit;
    tiles.push(<ReportTile key="recruit" title={t("tiles.recruit")} href="/recruit/reports" value={tile.openOpenings} hint={join(t("recruit.openOpenings"), `${t("recruit.applications")} ${tile.applications}`, `${t("recruit.active")} ${tile.active}`)} />);
  }

  if (dashboard.ops) {
    const tile = dashboard.ops;
    tiles.push(
      <ReportTile key="ops" title={t("tiles.ops")} href="/ops" value={tile.overdue} tone={tile.overdue > 0 ? "destructive" : undefined} hint={tile.overdue > 0 ? `${t("ops.dueSoon")} ${tile.dueSoon}` : join(t("ops.none"), `${t("ops.dueSoon")} ${tile.dueSoon}`)}>
        {tile.worst.length ? (
          <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
            {tile.worst.slice(0, 3).map((instance) => (
              <li key={`${instance.entityCode}-${instance.templateName}-${instance.dueDate}`} className="truncate">
                <span className="font-mono font-medium">{instance.entityCode}</span> {instance.templateName} — {day(instance.dueDate)}
              </li>
            ))}
          </ul>
        ) : null}
      </ReportTile>,
    );
  }

  if (dashboard.work) {
    const tile = dashboard.work;
    tiles.push(<ReportTile key="work" title={t("tiles.work")} href="/work/leader" value={tile.open} hint={join(t("work.open"), `${t("work.overdue")} ${tile.overdue}`, `${t("work.atRisk")} ${tile.atRisk}`)} tone={tile.overdue > 0 ? "warning" : undefined} />);
  }

  if (dashboard.delivery) {
    const tile = dashboard.delivery;
    const trouble = tile.health.off_track + tile.stale + tile.overdueMilestones;
    tiles.push(<ReportTile key="delivery" title={t("tiles.delivery")} href="/reports/delivery" value={tile.health.on_track} hint={join(t("delivery.onTrack"), `${t("delivery.offTrack")} ${tile.health.off_track}`, `${t("delivery.stale")} ${tile.stale}`, `${t("delivery.overdueMilestones")} ${tile.overdueMilestones}`)} tone={trouble > 0 ? "warning" : "success"}>
      <span className="text-xs text-faint">{t("delivery.of", { total: tile.projects })}</span>
    </ReportTile>);
  }

  if (dashboard.sales) {
    const tile = dashboard.sales;
    tiles.push(<ReportTile key="sales" title={t("tiles.sales")} href="/crm/reports" value={money(tile.wonVnd)} hint={join(t("sales.won", { count: tile.wonCount }), `${t("sales.pipeline", { count: tile.openDeals })} ${money(tile.weightedVnd)}`, tile.overdueVnd !== null && tile.overdueVnd > 0 && `${t("sales.overdue")} ${money(tile.overdueVnd)}`)} tone={tile.overdueVnd !== null && tile.overdueVnd > 0 ? "warning" : undefined} />);
  }

  tiles.push(<ReportTile key="approvals" title={t("tiles.approvals")} href="/approvals" value={dashboard.approvals.waiting} hint={dashboard.approvals.waiting > 0 ? t("approvals.waiting", { count: dashboard.approvals.waiting }) : t("approvals.none")} tone={dashboard.approvals.waiting > 0 ? "warning" : undefined} />);

  return (
    <Page width="wide">
      <PageHeader eyebrow={t("asOf", { date: day(dashboard.today) })} title={t("title")} description={t("description")} />
      <nav className="tab-row" aria-label={t("title")}>
        <Link href="/reports" aria-current="page">
          {t("title")}
        </Link>
        {can(user.principal, "report:read") ? <Link href="/reports/headcount">{t("tiles.headcount")}</Link> : null}
        <Link href="/work/analytics">{t("tiles.work")}</Link>
        <Link href="/reports/delivery">{t("tiles.delivery")}</Link>
        {canReadProfitability(user.principal) ? <Link href="/reports/profitability">{t("tiles.profitability")}</Link> : null}
        {canManageSchedules(user.principal) ? <Link href="/reports/schedules">{tSchedules("title")}</Link> : null}
      </nav>

      {tiles.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{tiles}</div>}
    </Page>
  );
}
