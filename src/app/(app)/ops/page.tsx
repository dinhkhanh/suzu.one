import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { canManageOps, canReadOps, COLOUR_SEVERITY, getDashboard, worstColour } from "@/modules/ops/service";
import { SyncButton } from "@/modules/ops/ui/library";
import { OpsNav, OverviewFilters, overviewParams, overviewQuery } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";

export const metadata: Metadata = { title: "Compliance" };

const CELL_TONE: Record<string, string> = {
  overdue: "border-destructive/50 bg-destructive/5",
  due_soon: "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40",
  done_late: "border-orange-200 bg-orange-50/60 dark:border-orange-900 dark:bg-orange-950/30",
  upcoming: "",
  done: "border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30",
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
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("dashboard.description")}</p>
        </div>
        {canManageOps(user.principal) ? <SyncButton /> : null}
      </header>
      <OpsNav active="dashboard" reads />
      <OverviewFilters action="/ops" query={query} owners={dashboard.owners} />

      <p className="text-sm text-muted-foreground">
        {t("dashboard.totals", dashboard.totals)}{" "}
        {dashboard.totals.overdue > 0 ? (
          <Link href={`/ops/list${overviewParams(query, { colour: "overdue" })}`} className="underline">
            {t("dashboard.seeOverdue")}
          </Link>
        ) : null}
      </p>

      {dashboard.rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
            <thead>
              <tr>
                <th className="w-32 px-2 text-left text-xs font-medium text-muted-foreground">{t("dashboard.entity")}</th>
                {dashboard.months.map((month) => (
                  <th key={month} className={`px-2 text-left text-xs font-medium ${month === today.slice(0, 7) ? "text-foreground" : "text-muted-foreground"}`}>
                    <Link href={`/ops/calendar${overviewParams(query, { month })}`} className="hover:underline">
                      {monthName(month)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dashboard.rows.map((row) => (
                <tr key={row.entity.id}>
                  <th scope="row" className="px-2 text-left align-top">
                    <Link href={`/ops/list${overviewParams(query, { entity: row.entity.id })}`} className="font-medium hover:underline">
                      {row.entity.code}
                    </Link>
                    <p className="text-xs font-normal text-muted-foreground">{row.entity.shortName}</p>
                  </th>
                  {row.cells.map((cell) => {
                    const worst = worstColour(cell);
                    return (
                      <td key={cell.month} className={`rounded-lg border p-2 align-top ${worst ? CELL_TONE[worst] : ""}`}>
                        {cell.total === 0 ? (
                          <span className="text-xs text-muted-foreground">—</span>
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
          </table>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t("dashboard.legend")}</p>
    </div>
  );
}
