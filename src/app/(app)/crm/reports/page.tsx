import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  return (
    <Page width="wide">
      <PageHeader
        title={t("reports.title")}
        description={t("reports.intro")}
        actions={
          can(user.principal, "pjm:cost") ? (
            <Button nativeButton={false} variant="outline" render={<Link href="/crm/reports/profitability" />}>
              {t("reports.profitabilityLink")}
            </Button>
          ) : null
        }
      />
      <CrmTabs current="reports" show={shell.show} />
      <form method="get" className="toolbar">
          <Select name="team" defaultValue={teamId ?? ""} aria-label={t("deal.fields.team")} className="w-full sm:w-48">
            <option value="">{t("deals.anyTeam")}</option>
            {teams
              .filter((team) => team.isActive)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </Select>
          <Button type="submit" variant="outline">
            {t("filter")}
          </Button>
      </form>

      {dashboard ? (
        <>
          <TileGrid>
            <Tile label={t("reports.openDeals")} value={dashboard.openCount} />
            <Tile label={t("reports.winRate")} value={f.percent(dashboard.winRate)} />
            <Tile label={t("reports.averageWon")} value={f.money(dashboard.averageWon)} />
            <Tile label={t("reports.cycle")} value={dashboard.averageCycleDays === null ? "—" : t("reports.days", { days: dashboard.averageCycleDays })} />
            <Tile label={t("reports.stale")} value={dashboard.staleCount} tone={dashboard.staleCount > 0 ? "warning" : undefined} />
          </TileGrid>
          <TableCard>
            <TableCardHeader title={t("reports.byStage")} />
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="status">{t("deals.columns.stage")}</TableHead>
                  <TableHead kind="number">{t("deals.columns.count")}</TableHead>
                  <TableHead kind="money">{t("deals.columns.value")}</TableHead>
                  <TableHead kind="money">{t("deals.columns.weighted")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.byStage.map((row) => (
                  <TableRow key={row.stageId}>
                    <TableCell>{stageName(row, locale)}</TableCell>
                    <TableCell kind="number">{row.count}</TableCell>
                    <TableCell kind="money">{f.money(row.value)}</TableCell>
                    <TableCell kind="money">{f.money(row.weighted)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
          <section className="flex flex-col gap-2">
            <TableCard>
              <TableCardHeader title={t("reports.byMonth")} />
              <Table numbered={false}>
                <TableHeader>
                  <TableRow>
                    <TableHead kind="date">{t("reports.month")}</TableHead>
                    <TableHead kind="number">{t("reports.won")}</TableHead>
                    <TableHead kind="money">{t("reports.wonValue")}</TableHead>
                    <TableHead kind="number">{t("reports.lost")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.byMonth.length === 0 ? <TableEmpty>{t("reports.noClosed")}</TableEmpty> : null}
                  {dashboard.byMonth.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="font-mono text-[0.8125rem] tabular-nums">{row.month}</TableCell>
                      <TableCell kind="number">{row.wonCount}</TableCell>
                      <TableCell kind="money">{f.money(row.wonValue)}</TableCell>
                      <TableCell kind="number">{row.lostCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableCard>
            {dashboard.lostReasons.length ? <p className="text-sm text-muted-foreground">{t("reports.lostReasons", { reasons: dashboard.lostReasons.map((row) => `${t(`enums.lostReason.${row.reason as "price"}`)} ${row.count}`).join(" · ") })}</p> : null}
          </section>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t("reports.nothing")}</p>
      )}

      {outlook ? (
        <TableCard>
          <TableCardHeader title={t("reports.outlook")} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{t("reports.month")}</TableHead>
                <TableHead kind="money">{t("reports.contracted")}</TableHead>
                <TableHead kind="money">{t("reports.weightedPipeline")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {outlook.map((row) => (
                <TableRow key={row.month}>
                  <TableCell className="font-mono text-[0.8125rem] tabular-nums">{row.month}</TableCell>
                  <TableCell kind="money">{f.money(row.contracted)}</TableCell>
                  <TableCell kind="money">{f.money(row.weighted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}

      {aging ? (
        <Section title={t("home.receivables")} action={<Link href="/crm/invoices">{t("home.openReceivables")}</Link>}>
          <TileGrid>
            <Tile label={t("invoices.totalOpen", { count: aging.invoices })} value={f.money(aging.total)} href="/crm/invoices" />
            <Tile label={t("invoices.statuses.overdue")} value={f.money(aging.total - aging.current)} tone={aging.total - aging.current > 0 ? "destructive" : undefined} href="/crm/invoices?status=overdue" />
          </TileGrid>
        </Section>
      ) : null}
    </Page>
  );
}
