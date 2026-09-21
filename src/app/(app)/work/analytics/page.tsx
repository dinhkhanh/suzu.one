import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { defaultAnalyticsPeriod, getWorkAnalytics, loadViewer, type NamedGroup } from "@/modules/work/service";

export const metadata: Metadata = { title: "Work reports" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Work reports (FR-RPT-04): throughput, on-time rate, open workload and revision rounds, by team
 * and by client. No permission gates the page — what it counts is decided in SQL by
 * `visibleTaskCondition`, the same clause the board and the list use, so a person on no team sees
 * an empty table rather than a refusal, and nobody sees a task they could not open.
 */
export default async function WorkAnalyticsPage({ searchParams }: PageProps<"/work/analytics">) {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const params = await searchParams;
  const pick = (name: string, pattern: RegExp) => (typeof params[name] === "string" && pattern.test(params[name]) ? (params[name] as string) : undefined);
  const today = todayInVietnam();
  const fallback = defaultAnalyticsPeriod(today);
  const period = { from: pick("from", DAY) ?? fallback.from, to: pick("to", DAY) ?? fallback.to };
  if (period.from > period.to) period.from = period.to;
  const teamId = pick("team", UUID) ?? null;

  const analytics = await getWorkAnalytics(viewer, { ...period, teamId }, today);
  const [t, tWork, tExports, format, locale] = await Promise.all([getTranslations("reports.analytics"), getTranslations("work"), getTranslations("exports"), getFormatter(), getLocale()]);
  const percent = (rate: number | null) => (rate === null ? "—" : format.number(rate, { style: "percent", maximumFractionDigits: 0 }));
  const revisions = (value: number | null) => (value === null ? "—" : format.number(value, { maximumFractionDigits: 1 }));
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`;
  const link = (next: Record<string, string | null>) => {
    const query = new URLSearchParams({ from: period.from, to: period.to, ...(teamId ? { team: teamId } : {}) });
    for (const [key, value] of Object.entries(next)) if (value === null) query.delete(key);
      else query.set(key, value);
    return `/work/analytics?${query.toString()}`;
  };

  const rows: { label: string; groups: NamedGroup[] }[] = [
    { label: t("byTeam"), groups: analytics.byTeam },
    { label: t("byClient"), groups: analytics.byClient },
  ];

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/work" className="underline underline-offset-4">
              {tWork("title")}
            </Link>
          </p>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <ExportButton action={exportReportAction} input={{ reportKey: "work_analytics", parameters: teamId ? { teamId } : {}, from: period.from, to: period.to, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />
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

      {analytics.teams.length > 1 ? (
        <nav className="flex flex-wrap items-center gap-1">
          <Link href={link({ team: null })} className={tab(!teamId)}>
            {t("allTeams")}
          </Link>
          {analytics.teams.map((team) => (
            <Link key={team.id} href={link({ team: team.id })} className={tab(teamId === team.id)}>
              {team.name}
            </Link>
          ))}
        </nav>
      ) : null}

      {analytics.total.completed === 0 && analytics.total.open === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="flex flex-col gap-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead className="text-right">{t("columns.completed")}</TableHead>
                <TableHead className="text-right">{t("columns.onTime")}</TableHead>
                <TableHead className="text-right">{t("columns.late")}</TableHead>
                <TableHead className="text-right">{t("columns.onTimeRate")}</TableHead>
                <TableHead className="text-right">{t("columns.open")}</TableHead>
                <TableHead className="text-right">{t("columns.overdue")}</TableHead>
                <TableHead className="text-right">{t("columns.revisions")}</TableHead>
                <TableHead className="text-right">{t("columns.contributors")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableRow className="font-medium">
                <TableCell>{t("total")}</TableCell>
                <TableCell>—</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.completed}</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.onTime}</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.late}</TableCell>
                <TableCell className="text-right tabular-nums">{percent(analytics.total.onTimeRate)}</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.open}</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.overdue}</TableCell>
                <TableCell className="text-right tabular-nums">{revisions(analytics.total.revisionsPerTask)}</TableCell>
                <TableCell className="text-right tabular-nums">{analytics.total.contributors}</TableCell>
              </TableRow>
              {rows.flatMap(({ label, groups }) =>
                groups.map((group) => (
                  <TableRow key={`${label}-${group.id}`}>
                    <TableCell className="text-muted-foreground">{label}</TableCell>
                    <TableCell>{group.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.completed}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.onTime}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.late}</TableCell>
                    <TableCell className="text-right tabular-nums">{percent(group.cell.onTimeRate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.open}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.overdue}</TableCell>
                    <TableCell className="text-right tabular-nums">{revisions(group.cell.revisionsPerTask)}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.cell.contributors}</TableCell>
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">{t("hint")}</p>
          <p className="text-xs text-muted-foreground">{t("scoped")}</p>
        </div>
      )}
    </div>
  );
}
