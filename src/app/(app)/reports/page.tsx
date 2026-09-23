import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { can } from "@/modules/platform/rbac/policy";
import { canManageSchedules, canReadProfitability, getDashboard } from "@/modules/reports/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("overview");

function Tile({ title, href, openLabel, children }: { title: string; href: string; openLabel: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <CardTitle className="text-base">{title}</CardTitle>
        <Link href={href} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          {openLabel}
        </Link>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

function Figure({ label, value, tone }: { label: string; value: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>{value}</span>
    </div>
  );
}

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
  const tiles: ReactNode[] = [];

  if (dashboard.headcount) {
    const tile = dashboard.headcount;
    tiles.push(
      <Tile key="headcount" title={t("tiles.headcount")} href="/reports/headcount" openLabel={t("open")}>
        <Figure label={t("headcount.total")} value={tile.total} />
        <Figure label={t("headcount.joiners")} value={tile.joiners} />
        <Figure label={t("headcount.leavers")} value={tile.leavers} />
        {tile.contractsExpiring > 0 ? <Figure label={t("headcount.contracts")} value={tile.contractsExpiring} /> : null}
        {tile.probations > 0 ? <Figure label={t("headcount.probations")} value={tile.probations} /> : null}
        {tile.scoped ? <p className="text-xs text-muted-foreground">{t("scoped")}</p> : null}
      </Tile>,
    );
  }

  if (dashboard.payroll) {
    const tile = dashboard.payroll;
    tiles.push(
      <Tile key="payroll" title={t("tiles.payroll")} href="/payroll/reports" openLabel={t("open")}>
        {!stepUpFresh ? (
          <p className="text-muted-foreground">
            <Link href={`/step-up?next=${encodeURIComponent("/payroll/reports")}`} className="underline underline-offset-2">
              {t("payroll.locked")}
            </Link>
          </p>
        ) : tile.latest ? (
          <>
            <p className="text-xs text-muted-foreground">{t("payroll.month", { month: tile.latest.month })}</p>
            <Figure label={t("payroll.employerCost")} value={money(tile.latest.employerCost)} />
            <Figure label={t("payroll.gross")} value={money(tile.latest.gross)} />
            <Figure label={t("payroll.headcount")} value={tile.latest.headcount} />
            {tile.previous ? <p className="text-xs text-muted-foreground">{t("payroll.change")}: {format.number((tile.latest.employerCost - tile.previous.employerCost) / Math.max(1, tile.previous.employerCost), { style: "percent", maximumFractionDigits: 1 })}</p> : null}
          </>
        ) : (
          <p className="text-muted-foreground">{t("payroll.noRuns")}</p>
        )}
      </Tile>,
    );
  }

  if (dashboard.attendance) {
    const tile = dashboard.attendance;
    tiles.push(
      <Tile key="attendance" title={t("tiles.attendance")} href="/attendance/today" openLabel={t("open")}>
        <Figure label={t("attendance.in")} value={tile.in + tile.offSite} />
        <Figure label={t("attendance.notYet")} value={tile.notYet} tone={tile.notYet > 0 ? "danger" : undefined} />
        <Figure label={t("attendance.out")} value={tile.out} />
        <Figure label={t("attendance.onLeave")} value={tile.onLeave} />
        <p className="text-xs text-muted-foreground">{t("attendance.of", { total: tile.people })}</p>
      </Tile>,
    );
  }

  if (dashboard.leave) {
    const tile = dashboard.leave;
    tiles.push(
      <Tile key="leave" title={t("tiles.leave")} href="/leave/calendar" openLabel={t("open")}>
        <p className="font-medium">{t("leave.away", { count: tile.away.length })}</p>
        <ul className="flex flex-col gap-1 text-muted-foreground">
          {tile.away.slice(0, 6).map((person) => (
            <li key={person.personId}>
              {person.fullName}
              {person.departmentName ? ` · ${person.departmentName}` : ""}
              {person.pending ? ` · ${t("leave.pending")}` : ""}
            </li>
          ))}
        </ul>
      </Tile>,
    );
  }

  if (dashboard.recruit) {
    const tile = dashboard.recruit;
    tiles.push(
      <Tile key="recruit" title={t("tiles.recruit")} href="/recruit/reports" openLabel={t("open")}>
        <Figure label={t("recruit.openOpenings")} value={tile.openOpenings} />
        <Figure label={t("recruit.applications")} value={tile.applications} />
        <Figure label={t("recruit.active")} value={tile.active} />
      </Tile>,
    );
  }

  if (dashboard.ops) {
    const tile = dashboard.ops;
    tiles.push(
      <Tile key="ops" title={t("tiles.ops")} href="/ops" openLabel={t("open")}>
        <Figure label={t("ops.overdue")} value={tile.overdue} tone={tile.overdue > 0 ? "danger" : undefined} />
        <Figure label={t("ops.dueSoon")} value={tile.dueSoon} />
        {tile.worst.length ? (
          <ul className="flex flex-col gap-1 text-muted-foreground">
            {tile.worst.map((instance) => (
              <li key={`${instance.entityCode}-${instance.templateName}-${instance.dueDate}`}>
                <span className="font-medium">{instance.entityCode}</span> {instance.templateName} — {day(instance.dueDate)}
                {instance.assigneeName ? ` · ${instance.assigneeName}` : ""}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">{t("ops.none")}</p>
        )}
      </Tile>,
    );
  }

  if (dashboard.work) {
    const tile = dashboard.work;
    tiles.push(
      <Tile key="work" title={t("tiles.work")} href="/work/leader" openLabel={t("open")}>
        <Figure label={t("work.open")} value={tile.open} />
        <Figure label={t("work.overdue")} value={tile.overdue} tone={tile.overdue > 0 ? "danger" : undefined} />
        <Figure label={t("work.atRisk")} value={tile.atRisk} />
      </Tile>,
    );
  }

  if (dashboard.delivery) {
    const tile = dashboard.delivery;
    tiles.push(
      <Tile key="delivery" title={t("tiles.delivery")} href="/reports/delivery" openLabel={t("open")}>
        <Figure label={t("delivery.onTrack")} value={tile.health.on_track} />
        <Figure label={t("delivery.atRisk")} value={tile.health.at_risk} />
        <Figure label={t("delivery.offTrack")} value={tile.health.off_track} tone={tile.health.off_track > 0 ? "danger" : undefined} />
        <Figure label={t("delivery.stale")} value={tile.stale} tone={tile.stale > 0 ? "danger" : undefined} />
        <Figure label={t("delivery.overdueMilestones")} value={tile.overdueMilestones} tone={tile.overdueMilestones > 0 ? "danger" : undefined} />
        <p className="text-xs text-muted-foreground">{t("delivery.of", { total: tile.projects })}</p>
      </Tile>,
    );
  }

  tiles.push(
    <Tile key="approvals" title={t("tiles.approvals")} href="/approvals" openLabel={t("open")}>
      {dashboard.approvals.waiting > 0 ? <p className="text-lg font-semibold tabular-nums">{t("approvals.waiting", { count: dashboard.approvals.waiting })}</p> : <p className="text-muted-foreground">{t("approvals.none")}</p>}
    </Tile>,
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Badge variant="secondary">{t("asOf", { date: day(dashboard.today) })}</Badge>
          {can(user.principal, "report:read") ? (
            <Link href="/reports/headcount" className="underline underline-offset-4">
              {t("tiles.headcount")}
            </Link>
          ) : null}
          <Link href="/work/analytics" className="underline underline-offset-4">
            {t("tiles.work")}
          </Link>
          <Link href="/reports/delivery" className="underline underline-offset-4">
            {t("tiles.delivery")}
          </Link>
          {canReadProfitability(user.principal) ? (
            <Link href="/reports/profitability" className="underline underline-offset-4">
              {t("tiles.profitability")}
            </Link>
          ) : null}
          {canManageSchedules(user.principal) ? (
            <Link href="/reports/schedules" className="underline underline-offset-4">
              {tSchedules("title")}
            </Link>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{tiles}</div>
    </div>
  );
}
