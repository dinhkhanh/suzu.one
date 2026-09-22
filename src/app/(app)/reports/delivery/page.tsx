import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { COMPLIANCE_MAX_DAYS, type Compliance, defaultDeliveryPeriod, getDeliveryDashboard } from "@/modules/reports/service";

export const metadata: Metadata = { title: "Delivery" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>{value}</span>
      </div>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">{children}</CardContent>
    </Card>
  );
}

/**
 * The delivery dashboards (FR-PJM-60). No permission gates the page, as with the work reports:
 * every figure counts the projects the reader may open (the portfolio's own list), and compliance
 * the teams they lead or oversee. Hours only — no fee or cost is on this page.
 */
export default async function DeliveryPage({ searchParams }: PageProps<"/reports/delivery">) {
  const user = await requireUser();
  const params = await searchParams;
  const pick = (name: string, pattern: RegExp) => (typeof params[name] === "string" && pattern.test(params[name]) ? (params[name] as string) : undefined);
  const today = todayInVietnam();
  const fallback = defaultDeliveryPeriod(today);
  const period = { from: pick("from", DAY) ?? fallback.from, to: pick("to", DAY) ?? fallback.to };
  if (period.from > period.to) period.from = period.to;
  const teamId = pick("team", UUID) ?? null;

  const [view, t, tExports, format, locale] = await Promise.all([getDeliveryDashboard(user, { ...period, teamId }, today), getTranslations("reports.delivery"), getTranslations("exports"), getFormatter(), getLocale()]);
  const percent = (rate: number | null) => (rate === null ? "—" : format.number(rate, { style: "percent", maximumFractionDigits: 0 }));
  const decimal = (value: number | null) => (value === null ? "—" : format.number(value, { maximumFractionDigits: 1 }));
  const hours = (minutes: number | null) => (minutes === null ? "—" : format.number(minutes / 60, { maximumFractionDigits: 1 }));
  const compliance = (value: Compliance) => (value.due === 0 ? "—" : `${percent(value.rate)} (${value.met}/${value.due})`);
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;
  const link = (team: string | null) => {
    const query = new URLSearchParams({ from: period.from, to: period.to, ...(team ? { team } : {}) });
    return `/reports/delivery?${query.toString()}`;
  };
  const total = view.total;

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="underline underline-offset-4">
              {t("back")}
            </Link>
          </p>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <ExportButton action={exportReportAction} input={{ reportKey: "delivery", parameters: teamId ? { teamId } : {}, from: period.from, to: period.to, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />
      </header>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        {teamId ? <input type="hidden" name="team" value={teamId} /> : null}
        <label className="flex flex-col gap-1">
          {t("from")}
          <Input type="date" name="from" defaultValue={period.from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          {t("to")}
          <Input type="date" name="to" defaultValue={period.to} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      {view.teams.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1">
          <Link href={link(null)} className={tab(!teamId)}>
            {t("allTeams")}
          </Link>
          {view.teams.map((team) => (
            <Link key={team.id} href={link(team.id)} className={tab(teamId === team.id)}>
              {team.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {total.projects === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Panel title={t("panels.health")}>
            <Figure label={t("health.on_track")} value={total.health.on_track} />
            <Figure label={t("health.at_risk")} value={total.health.at_risk} />
            <Figure label={t("health.off_track")} value={total.health.off_track} tone={total.health.off_track > 0 ? "danger" : undefined} />
            <Figure label={t("health.none")} value={total.health.none} />
            <Figure label={t("health.stale")} value={total.health.stale} tone={total.health.stale > 0 ? "danger" : undefined} />
          </Panel>
          <Panel title={t("panels.milestones")}>
            <Figure label={t("milestones.slipped")} value={`${total.milestones.slipped}/${total.milestones.baselined}`} hint={t("milestones.averageSlip", { days: decimal(total.milestones.averageSlipDays) })} />
            <Figure label={t("milestones.overdue")} value={total.milestones.overdue} tone={total.milestones.overdue > 0 ? "danger" : undefined} />
            <Figure label={t("onTime.rate")} value={percent(total.onTime.rate)} hint={t("onTime.hint", { onTime: total.onTime.onTime, dated: total.onTime.dated })} />
          </Panel>
          <Panel title={t("panels.scope")}>
            <Figure label={t("register.rate")} value={percent(total.register.rate)} hint={t("register.hint", { accepted: total.register.accepted, promised: total.register.promised })} />
            <Figure label={t("burn.rate")} value={percent(total.burn.rate)} hint={t("burn.hint", { logged: hours(total.burn.loggedOnBudgeted), budget: hours(total.burn.budgetMinutes), projects: total.burn.budgeted })} />
            <Figure label={t("burn.over")} value={total.burn.over} tone={total.burn.over > 0 ? "danger" : undefined} hint={t("burn.warning", { count: total.burn.warning })} />
          </Panel>
          <Panel title={t("panels.retainers")}>
            {view.retainers ? (
              <>
                <Figure label={t("retainers.consumption")} value={percent(view.retainers.consumption)} hint={t("retainers.hint", { delivered: view.retainers.delivered, contracted: view.retainers.contracted })} />
                <Figure label={t("retainers.overserviced")} value={view.retainers.overserviced} tone={view.retainers.overserviced > 0 ? "danger" : undefined} />
                <Figure label={t("retainers.nearLimit")} value={view.retainers.nearLimit} />
              </>
            ) : (
              <p className="text-muted-foreground">{t("retainers.unavailable")}</p>
            )}
          </Panel>
          <Panel title={t("panels.quality")}>
            <Figure label={t("revisions.internal")} value={total.revisions.internalRounds} hint={t("revisions.perTask", { value: decimal(total.revisions.internalPerTask) })} />
            <Figure label={t("revisions.client")} value={total.revisions.clientRounds} hint={t("revisions.perTask", { value: decimal(total.revisions.clientPerTask) })} />
            <Figure label={t("handoffs.returned")} value={`${total.handoffs.returned}/${total.handoffs.total}`} hint={t("handoffs.returnRate", { rate: percent(total.handoffs.returnRate) })} />
            <Figure label={t("handoffs.wait")} value={hours(total.handoffs.averageWaitMinutes)} hint={t("handoffs.pending", { count: total.handoffs.pending })} />
          </Panel>
          <Panel title={t("panels.blocked")}>
            <Figure label={t("blocked.hours")} value={decimal(total.blocked.blockedHours)} />
            <Figure label={t("blocked.raised")} value={total.blocked.blockers} hint={t("blocked.average", { hours: decimal(total.blocked.averageHoursPerBlocker) })} />
            <Figure label={t("blocked.open")} value={total.blocked.open} tone={total.blocked.open > 0 ? "danger" : undefined} />
          </Panel>
        </div>
      )}

      {view.attention.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{t("attention.title")}</h2>
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {view.attention.map((project) => (
              <li key={project.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <Link href={`/work/projects/${project.id}`} className="font-medium underline-offset-4 hover:underline">
                  {project.name}
                  <span className="ps-2 text-xs font-normal text-muted-foreground">{project.teamName}</span>
                </Link>
                <span className="flex flex-wrap gap-1">
                  {project.health ? <Badge variant={project.health === "off_track" ? "destructive" : "secondary"}>{t(`health.${project.health}`)}</Badge> : null}
                  {project.stale ? <Badge variant="outline">{t("health.stale")}</Badge> : null}
                  {project.overdueMilestones > 0 ? <Badge variant="outline">{t("attention.overdue", { count: project.overdueMilestones })}</Badge> : null}
                  {project.slippedMilestones > 0 ? <Badge variant="outline">{t("attention.slipped", { count: project.slippedMilestones })}</Badge> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view.byTeam.length > 1 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{t("byTeam")}</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.team")}</TableHead>
                  <TableHead className="text-right">{t("columns.projects")}</TableHead>
                  <TableHead className="text-right">{t("columns.offTrack")}</TableHead>
                  <TableHead className="text-right">{t("columns.stale")}</TableHead>
                  <TableHead className="text-right">{t("columns.overdueMilestones")}</TableHead>
                  <TableHead className="text-right">{t("columns.onTimeRate")}</TableHead>
                  <TableHead className="text-right">{t("columns.acceptedRate")}</TableHead>
                  <TableHead className="text-right">{t("columns.burnRate")}</TableHead>
                  <TableHead className="text-right">{t("columns.clientRounds")}</TableHead>
                  <TableHead className="text-right">{t("columns.returnedHandoffs")}</TableHead>
                  <TableHead className="text-right">{t("columns.blockedHours")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {view.byTeam.map(({ teamId: id, name, summary }) => (
                  <TableRow key={id}>
                    <TableCell>
                      <Link href={link(id)} className="underline-offset-4 hover:underline">
                        {name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{summary.projects}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.health.off_track}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.health.stale}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.milestones.overdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(summary.onTime.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(summary.register.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(summary.burn.rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.revisions.clientRounds}</TableCell>
                    <TableCell className="text-right tabular-nums">{summary.handoffs.returned}</TableCell>
                    <TableCell className="text-right tabular-nums">{decimal(summary.blocked.blockedHours)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}

      {view.compliance ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-base font-medium">{t("compliance.title")}</h2>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.team")}</TableHead>
                  <TableHead className="text-right">{t("compliance.people")}</TableHead>
                  <TableHead className="text-right">{t("compliance.reports")}</TableHead>
                  <TableHead className="text-right">{t("compliance.timesheets")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-medium">
                  <TableCell>{t("total")}</TableCell>
                  <TableCell />
                  <TableCell className="text-right tabular-nums">{compliance(view.compliance.total.reports)}</TableCell>
                  <TableCell className="text-right tabular-nums">{compliance(view.compliance.total.timesheets)}</TableCell>
                </TableRow>
                {view.compliance.teams.map((team) => (
                  <TableRow key={team.teamId}>
                    <TableCell>{team.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{team.people}</TableCell>
                    <TableCell className="text-right tabular-nums">{compliance(team.reports)}</TableCell>
                    <TableCell className="text-right tabular-nums">{compliance(team.timesheets)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">{t("compliance.hint", { days: COMPLIANCE_MAX_DAYS })}</p>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("scoped")}</p>
    </div>
  );
}
