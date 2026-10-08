import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { COMPLIANCE_MAX_DAYS, type Compliance, defaultDeliveryPeriod, getDeliveryDashboard } from "@/modules/reports/service";
import { RateBar } from "@/modules/reports/ui/bar";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("delivery");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function Figure({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "danger" }) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground">{label}</span>
        <span className={`font-mono text-[0.9375rem] font-medium tabular-nums ${tone === "danger" ? "text-destructive" : ""}`}>{value}</span>
      </div>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5 text-sm">{children}</CardContent>
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
  const link = (team: string | null) => {
    const query = new URLSearchParams({ from: period.from, to: period.to, ...(team ? { team } : {}) });
    return `/reports/delivery?${query.toString()}`;
  };
  const total = view.total;

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={<Link href="/reports">{t("back")}</Link>}
        title={t("title")}
        description={t("description")}
        actions={
          <ExportButton
            action={exportReportAction}
            input={{ reportKey: "delivery", parameters: teamId ? { teamId } : {}, from: period.from, to: period.to, locale }}
            label={tExports("button")}
            failedLabel={tExports("failed")}
            truncatedLabel={tExports("truncated")}
          />
        }
      />

      {view.teams.length > 1 ? (
        <nav className="tab-row" aria-label={t("byTeam")}>
          <Link href={link(null)} aria-current={!teamId ? "page" : undefined}>
            {t("allTeams")}
          </Link>
          {view.teams.map((team) => (
            <Link key={team.id} href={link(team.id)} aria-current={teamId === team.id ? "page" : undefined}>
              {team.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <form className="toolbar">
        {teamId ? <input type="hidden" name="team" value={teamId} /> : null}
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("from")}
          <DatePicker name="from" defaultValue={period.from} className="w-auto" />
        </Label>
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("to")}
          <DatePicker name="to" defaultValue={period.to} className="w-auto" />
        </Label>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>

      {total.projects === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
        <TableCard>
          <TableCardHeader title={t("attention.title")} count={view.attention.length} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="text">{t("columns.project")}</TableHead>
                <TableHead kind="org">{t("columns.team")}</TableHead>
                <TableHead kind="status">{t("panels.health")}</TableHead>
                <TableHead kind="number">{t("columns.overdueMilestones")}</TableHead>
                <TableHead kind="number">{t("columns.slipped")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.attention.map((project) => (
                <TableRow key={project.id}>
                  <TableCell className="max-w-80 truncate">
                    <RecordLink kind="project" id={project.id} className="font-medium">
                      {project.name}
                    </RecordLink>
                  </TableCell>
                  <TableCell>
                    <RecordLink kind="team" id={project.teamId}>
                      {project.teamName}
                    </RecordLink>
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-wrap gap-1">
                      {project.health ? (
                        <Badge dot variant={project.health === "off_track" ? "destructive" : project.health === "at_risk" ? "warning" : "success"}>
                          {t(`health.${project.health}`)}
                        </Badge>
                      ) : null}
                      {project.stale ? <Badge variant="outline">{t("health.stale")}</Badge> : null}
                      {!project.health && !project.stale ? "—" : null}
                    </span>
                  </TableCell>
                  <TableCell kind="number" className={project.overdueMilestones > 0 ? "text-destructive" : undefined}>
                    {project.overdueMilestones}
                  </TableCell>
                  <TableCell kind="number">{project.slippedMilestones}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {view.byTeam.length > 1 ? (
        <TableCard>
          <TableCardHeader title={t("byTeam")} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="org">{t("columns.team")}</TableHead>
                <TableHead kind="number">{t("columns.projects")}</TableHead>
                <TableHead kind="number">{t("columns.offTrack")}</TableHead>
                <TableHead kind="number">{t("columns.stale")}</TableHead>
                <TableHead kind="number">{t("columns.overdueMilestones")}</TableHead>
                <TableHead kind="percent">{t("columns.onTimeRate")}</TableHead>
                <TableHead kind="percent">{t("columns.acceptedRate")}</TableHead>
                <TableHead kind="percent">{t("columns.burnRate")}</TableHead>
                <TableHead kind="number">{t("columns.clientRounds")}</TableHead>
                <TableHead kind="number">{t("columns.returnedHandoffs")}</TableHead>
                <TableHead kind="time">{t("columns.blockedHours")}</TableHead>
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
                  <TableCell kind="number">{summary.projects}</TableCell>
                  <TableCell kind="number">{summary.health.off_track}</TableCell>
                  <TableCell kind="number">{summary.health.stale}</TableCell>
                  <TableCell kind="number">{summary.milestones.overdue}</TableCell>
                  <TableCell kind="percent">
                    <RateBar rate={summary.onTime.rate} label={percent(summary.onTime.rate)} />
                  </TableCell>
                  <TableCell kind="percent">
                    <RateBar rate={summary.register.rate} label={percent(summary.register.rate)} />
                  </TableCell>
                  <TableCell kind="percent">
                    <RateBar rate={summary.burn.rate} label={percent(summary.burn.rate)} tone={summary.burn.rate !== null && summary.burn.rate > 1 ? "destructive" : undefined} />
                  </TableCell>
                  <TableCell kind="number">{summary.revisions.clientRounds}</TableCell>
                  <TableCell kind="number">{summary.handoffs.returned}</TableCell>
                  <TableCell kind="time">{decimal(summary.blocked.blockedHours)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {view.compliance ? (
        <section className="flex flex-col gap-2">
          <TableCard>
            <TableCardHeader title={t("compliance.title")} />
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="org">{t("columns.team")}</TableHead>
                  <TableHead kind="number">{t("compliance.people")}</TableHead>
                  <TableHead kind="percent">{t("compliance.reports")}</TableHead>
                  <TableHead kind="percent">{t("compliance.timesheets")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="font-medium">
                  <TableCell>{t("total")}</TableCell>
                  <TableCell />
                  <TableCell kind="percent">{compliance(view.compliance.total.reports)}</TableCell>
                  <TableCell kind="percent">{compliance(view.compliance.total.timesheets)}</TableCell>
                </TableRow>
                {view.compliance.teams.map((team) => (
                  <TableRow key={team.teamId}>
                    <TableCell>
                      {/* "other" is the small teams added together: a row, not a team. */}
                      <RecordLink kind="team" id={team.teamId === "other" ? null : team.teamId}>
                        {team.name}
                      </RecordLink>
                    </TableCell>
                    <TableCell kind="number">{team.people}</TableCell>
                    <TableCell kind="percent">
                      <RateBar rate={team.reports.due === 0 ? null : team.reports.rate} label={compliance(team.reports)} />
                    </TableCell>
                    <TableCell kind="percent">
                      <RateBar rate={team.timesheets.due === 0 ? null : team.timesheets.rate} label={compliance(team.timesheets)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <p className="text-xs text-muted-foreground">{t("compliance.hint", { days: COMPLIANCE_MAX_DAYS })}</p>
        </section>
      ) : null}

      <p className="text-xs text-muted-foreground">{t("scoped")}</p>
    </Page>
  );
}
