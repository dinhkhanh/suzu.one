import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableEmpty, TableHead } from "@/components/ui/table";
import { cn } from "cn";
import { todayInVietnam } from "@/lib/dates";
import { canManageOps, canReadOps, COLOUR_SEVERITY, getDashboard, worstColour } from "@/modules/ops/service";
import { SyncButton } from "@/modules/ops/ui/library";
import { OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("compliance");

// A cell takes the tint of its worst obligation: red when something is overdue, amber when
// something is due soon, orange for a late submission, green when everything is in.
const CELL_TONE: Record<string, string> = {
  overdue: "border-destructive/30 bg-destructive/6",
  due_soon: "border-warning/30 bg-warning/8",
  done_late: "border-tone-orange/30 bg-tone-orange/8",
  upcoming: "",
  done: "border-success/25 bg-success/6",
};

// The compliance dashboard (FR-OPS-07): entity × month, every entity the viewer reads at once.
// Someone without an ops role has no dashboard — only the list of what is theirs to do.
export default async function OpsDashboardPage({ searchParams }: PageProps<"/ops">) {
  const user = await requireUser();
  if (!canReadOps(user.principal)) redirect("/ops/list");
  const query = overviewQuery(await searchParams);
  const today = todayInVietnam();
  const dashboard = await getDashboard({ principal: user.principal, personId: user.person.id }, query, today);
  const t = await getTranslations("ops");
  const format = await getFormatter();
  const monthName = (month: string) => format.dateTime(new Date(`${month}-01T00:00:00`), { month: "short", year: "numeric" });

  return (
    <Page width="wide">
      <PageHeader title={t("title")} description={t("dashboard.description")} actions={canManageOps(user.principal) ? <SyncButton /> : null} />
      <OpsNav active="dashboard" reads />
      <OverviewFilters action="/ops" query={query} owners={dashboard.owners} />

      {/* The three figures the dashboard counts in SQL; each opens the list cut to that colour. */}
      <TileGrid>
        <Tile
          label={t("dashboard.tiles.overdue")}
          value={dashboard.totals.overdue}
          tone={dashboard.totals.overdue > 0 ? "destructive" : undefined}
          href={`/ops/list${overviewParams(query, { colour: "overdue" })}`}
          hint={dashboard.totals.overdue > 0 ? t("dashboard.seeOverdue") : undefined}
        />
        <Tile label={t("dashboard.tiles.dueSoon")} value={dashboard.totals.dueSoon} tone={dashboard.totals.dueSoon > 0 ? "warning" : undefined} href={`/ops/list${overviewParams(query, { colour: "due_soon" })}`} />
        <Tile label={t("dashboard.tiles.escalated")} value={dashboard.totals.escalated} tone={dashboard.totals.escalated > 0 ? "destructive" : undefined} />
      </TileGrid>

      <Section title={t("dashboard.entity")}>
        {/* A heatmap, not a register: the grid's frame and header, but its own spaced, tinted cells. */}
        <Table numbered={false} className="min-w-[720px] border-separate border-spacing-1 p-1">
          <thead>
            <tr>
              <TableHead kind="org" className="w-32 px-2">
                {t("dashboard.entity")}
              </TableHead>
              {dashboard.months.map((month) => (
                <TableHead key={month} className={cn("px-2", month === today.slice(0, 7) && "font-semibold text-foreground")}>
                  <Link href={`/ops/calendar${overviewParams(query, { month })}`} className="hover:underline">
                    {monthName(month)}
                  </Link>
                </TableHead>
              ))}
            </tr>
          </thead>
          <tbody>
            {dashboard.rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {dashboard.rows.map((row) => (
              <tr key={row.entity.id}>
                <th scope="row" className="px-2 text-left align-top">
                  <Link href={`/ops/list${overviewParams(query, { entity: row.entity.id })}`} className="font-mono text-[0.8125rem] font-medium hover:underline">
                    {row.entity.code}
                  </Link>
                  <p className="text-xs font-normal text-faint">
                    <RecordLink kind="entity" id={row.entity.id}>
                      {row.entity.shortName}
                    </RecordLink>
                  </p>
                </th>
                {row.cells.map((cell) => {
                  const worst = worstColour(cell);
                  return (
                    <td key={cell.month} className={cn("rounded-[10px] border border-border/70 p-2 align-top", worst ? CELL_TONE[worst] : "")}>
                      {cell.total === 0 ? (
                        <span className="text-xs text-faint">—</span>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {COLOUR_SEVERITY.filter((colour) => (cell.counts[colour] ?? 0) > 0).map((colour) => (
                            <Link key={colour} href={`/ops/list${overviewParams(query, { entity: row.entity.id, month: cell.month, colour })}`} className="flex items-center gap-1.5 hover:underline">
                              <StatusBadge colour={colour} label={String(cell.counts[colour])} />
                              <span className="text-xs">{t(`enums.colour.${colour}`)}</span>
                            </Link>
                          ))}
                          {cell.escalated > 0 ? <span className="text-xs font-medium text-destructive">{t("dashboard.escalated", { count: cell.escalated })}</span> : null}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="text-xs text-muted-foreground">{t("dashboard.legend")}</p>
      </Section>
    </Page>
  );
}
