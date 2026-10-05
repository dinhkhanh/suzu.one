import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Suspense } from "react";
import { Page, PageHeader } from "@/components/ui/page";
import { SectionSkeleton } from "@/components/ui/page-skeleton";
import { RecordLink } from "@/components/ui/record-link";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { type IsoDate, todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { defaultAnalyticsPeriod, getWorkAnalytics, loadViewer, type NamedGroup, type WorkViewer } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("workReports");

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

  const [t, tWork, tExports, locale] = await Promise.all([getTranslations("reports.analytics"), getTranslations("work"), getTranslations("exports"), getLocale()]);
  const tab = (active: boolean) => `rounded-md px-2 py-1 text-sm ${active ? "pill-on" : "pill-off"}`;
  const link = (next: Record<string, string | null>) => {
    const query = new URLSearchParams({ from: period.from, to: period.to, ...(teamId ? { team: teamId } : {}) });
    for (const [key, value] of Object.entries(next)) if (value === null) query.delete(key);
      else query.set(key, value);
    return `/work/analytics?${query.toString()}`;
  };

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/work" className="hover:underline">
            {tWork("title")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
        actions={<ExportButton action={exportReportAction} input={{ reportKey: "work_analytics", parameters: teamId ? { teamId } : {}, from: period.from, to: period.to, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />}
      />

      <form className="flex flex-wrap items-end gap-3 text-sm">
        {teamId ? <input type="hidden" name="team" value={teamId} /> : null}
        <label className="flex flex-col gap-1">
          {t("from")}
          <DatePicker name="from" defaultValue={period.from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          {t("to")}
          <DatePicker name="to" defaultValue={period.to} className="w-auto" />
        </label>
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      {/* The figures are counted over every visible task of the period: the header and the filter come first. */}
      <Suspense key={link({})} fallback={<SectionSkeleton rows={5} />}>
        <AnalyticsTable viewer={viewer} period={period} teamId={teamId} today={today} link={link} tab={tab} />
      </Suspense>
    </Page>
  );
}

async function AnalyticsTable({ viewer, period, teamId, today, link, tab }: { viewer: WorkViewer; period: { from: IsoDate; to: IsoDate }; teamId: string | null; today: IsoDate; link: (next: Record<string, string | null>) => string; tab: (active: boolean) => string }) {
  const [analytics, t, format] = await Promise.all([getWorkAnalytics(viewer, { ...period, teamId }, today), getTranslations("reports.analytics"), getFormatter()]);
  const percent = (rate: number | null) => (rate === null ? "—" : format.number(rate, { style: "percent", maximumFractionDigits: 0 }));
  const revisions = (value: number | null) => (value === null ? "—" : format.number(value, { maximumFractionDigits: 1 }));
  const empty = analytics.total.completed === 0 && analytics.total.open === 0;
  const rows: { label: string; kind: "team" | "account"; groups: NamedGroup[] }[] = [
    { label: t("byTeam"), kind: "team", groups: analytics.byTeam },
    { label: t("byClient"), kind: "account", groups: analytics.byClient },
  ];

  return (
    <>
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

      <div className="flex flex-col gap-6">
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="select">{t("columns.kind")}</TableHead>
              <TableHead kind="text">{t("columns.name")}</TableHead>
              <TableHead kind="number">{t("columns.completed")}</TableHead>
              <TableHead kind="number">{t("columns.onTime")}</TableHead>
              <TableHead kind="number">{t("columns.late")}</TableHead>
              <TableHead kind="percent">{t("columns.onTimeRate")}</TableHead>
              <TableHead kind="number">{t("columns.open")}</TableHead>
              <TableHead kind="number">{t("columns.overdue")}</TableHead>
              <TableHead kind="number">{t("columns.revisions")}</TableHead>
              <TableHead kind="number">{t("columns.contributors")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {empty ? (
              <TableEmpty>{t("none")}</TableEmpty>
            ) : (
              <TableRow className="font-medium">
                <TableCell>{t("total")}</TableCell>
                <TableCell>—</TableCell>
                <TableCell kind="number">{analytics.total.completed}</TableCell>
                <TableCell kind="number">{analytics.total.onTime}</TableCell>
                <TableCell kind="number">{analytics.total.late}</TableCell>
                <TableCell kind="percent">{percent(analytics.total.onTimeRate)}</TableCell>
                <TableCell kind="number">{analytics.total.open}</TableCell>
                <TableCell kind="number">{analytics.total.overdue}</TableCell>
                <TableCell kind="number">{revisions(analytics.total.revisionsPerTask)}</TableCell>
                <TableCell kind="number">{analytics.total.contributors}</TableCell>
              </TableRow>
            )}
            {empty
              ? null
              : rows.flatMap(({ label, kind, groups }) =>
                  groups.map((group) => (
                    <TableRow key={`${label}-${group.id}`}>
                      <TableCell className="text-muted-foreground">{label}</TableCell>
                      <TableCell>
                        <RecordLink kind={kind} id={group.id}>{group.name}</RecordLink>
                      </TableCell>
                      <TableCell kind="number">{group.cell.completed}</TableCell>
                      <TableCell kind="number">{group.cell.onTime}</TableCell>
                      <TableCell kind="number">{group.cell.late}</TableCell>
                      <TableCell kind="percent">{percent(group.cell.onTimeRate)}</TableCell>
                      <TableCell kind="number">{group.cell.open}</TableCell>
                      <TableCell kind="number">{group.cell.overdue}</TableCell>
                      <TableCell kind="number">{revisions(group.cell.revisionsPerTask)}</TableCell>
                      <TableCell kind="number">{group.cell.contributors}</TableCell>
                    </TableRow>
                  )),
                )}
          </TableBody>
        </Table>
        {empty ? null : (
          <>
            <p className="text-xs text-muted-foreground">{t("hint")}</p>
            <p className="text-xs text-muted-foreground">{t("scoped")}</p>
          </>
        )}
      </div>
    </>
  );
}
