import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { can } from "@/modules/platform/rbac/policy";
import { listTeams } from "@/modules/work/service";
import { agingSummary, crmSettings, revenueOutlook, salesDashboard, stageName } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmReports");

export default async function SalesReportsPage({ searchParams }: PageProps<"/crm/reports">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.reports) notFound();
  const params = await searchParams;
  const teamId = typeof params.team === "string" && params.team ? params.team : null;
  const today = todayInVietnam();
  const settings = await crmSettings(today);
  const [t, f, locale, teams, dashboard, outlook, aging] = await Promise.all([getTranslations("crm"), formatters(), getLocale(), listTeams(), salesDashboard(shell.viewer, { teamId }, today, 6, settings.staleDealDays), revenueOutlook(shell.viewer, today), shell.show.invoices ? agingSummary(shell.viewer, {}, today) : Promise.resolve(null)]);
  const tile = (label: string, value: string) => (
    <div className="rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-medium tabular-nums">{value}</p>
    </div>
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header>
        <h1>{t("reports.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("reports.intro")}</p>
      </header>
      <CrmTabs current="reports" show={shell.show} />
      <div className="flex flex-wrap items-end justify-between gap-2">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <Select name="team" defaultValue={teamId ?? ""} aria-label={t("deal.fields.team")}>
            <option value="">{t("deals.anyTeam")}</option>
            {teams
              .filter((team) => team.isActive)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </Select>
          <Button type="submit" size="sm" variant="outline">
            {t("filter")}
          </Button>
        </form>
        {can(user.principal, "pjm:cost") ? (
          <Link href="/crm/reports/profitability" className="text-sm underline">
            {t("reports.profitabilityLink")}
          </Link>
        ) : null}
      </div>

      {dashboard ? (
        <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {tile(t("reports.openDeals"), String(dashboard.openCount))}
            {tile(t("reports.winRate"), f.percent(dashboard.winRate))}
            {tile(t("reports.averageWon"), f.money(dashboard.averageWon))}
            {tile(t("reports.cycle"), dashboard.averageCycleDays === null ? "—" : t("reports.days", { days: dashboard.averageCycleDays }))}
            {tile(t("reports.stale"), String(dashboard.staleCount))}
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("reports.byStage")}</h2>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("deals.columns.stage")}</TableHead>
                  <TableHead className="text-right">{t("deals.columns.count")}</TableHead>
                  <TableHead className="text-right">{t("deals.columns.value")}</TableHead>
                  <TableHead className="text-right">{t("deals.columns.weighted")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.byStage.map((row) => (
                  <TableRow key={row.stageId}>
                    <TableCell>{stageName(row, locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(row.value)}</TableCell>
                    <TableCell className="text-right tabular-nums">{f.money(row.weighted)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">{t("reports.byMonth")}</h2>
            {dashboard.byMonth.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("reports.noClosed")}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("reports.month")}</TableHead>
                    <TableHead className="text-right">{t("reports.won")}</TableHead>
                    <TableHead className="text-right">{t("reports.wonValue")}</TableHead>
                    <TableHead className="text-right">{t("reports.lost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.byMonth.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell>{row.month}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.wonCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{f.money(row.wonValue)}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.lostCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            {dashboard.lostReasons.length ? <p className="text-sm text-muted-foreground">{t("reports.lostReasons", { reasons: dashboard.lostReasons.map((row) => `${t(`enums.lostReason.${row.reason as "price"}`)} ${row.count}`).join(" · ") })}</p> : null}
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("reports.nothing")}</p>
      )}

      {outlook ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{t("reports.outlook")}</h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("reports.month")}</TableHead>
                <TableHead className="text-right">{t("reports.contracted")}</TableHead>
                <TableHead className="text-right">{t("reports.weightedPipeline")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlook.map((row) => (
                <TableRow key={row.month}>
                  <TableCell>{row.month}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(row.contracted)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(row.weighted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      ) : null}

      {aging ? (
        <section className="flex flex-wrap items-center gap-3 rounded-xl border p-3 text-sm">
          <span className="font-medium">{t("home.receivables")}</span>
          <span className="tabular-nums">{f.money(aging.total)}</span>
          <span className="text-muted-foreground">{t("reports.overdueShare", { amount: f.money(aging.total - aging.current) })}</span>
          <Link href="/crm/invoices" className="ml-auto text-xs underline">
            {t("home.openReceivables")}
          </Link>
        </section>
      ) : null}
    </div>
  );
}
