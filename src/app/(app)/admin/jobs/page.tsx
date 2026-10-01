import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { listRecentJobRuns } from "@/modules/platform/jobs/service";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";
import vercel from "../../../../../vercel.json";

export const generateMetadata = pageTitle("scheduledJobs");

// The schedule is Vercel's cron table: "<minute> <hour> * * *" in UTC, one line per job, the job's
// name being the last segment of its path. Read here so the screen says when each job runs next
// without a second copy of the timetable.
type Cron = { job: string; minute: number; hour: number };
const CRONS: Cron[] = (vercel.crons ?? []).flatMap(({ path, schedule }) => {
  const [minute, hour, day, month, weekday] = schedule.split(/\s+/);
  if (day !== "*" || month !== "*" || weekday !== "*") return [];
  return [{ job: path.split("/").at(-1) ?? path, minute: Number(minute), hour: Number(hour) }];
});

/** The next moment this daily UTC schedule fires after `now`. */
function nextRunOf(cron: Cron, now: Date): Date {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), cron.hour, cron.minute));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export default async function JobsPage() {
  const user = await requireUser();
  // System health is a group-level concern, same audience as the full audit log.
  if (!can(user.principal, "audit:read", {})) notFound();

  const [t, format, runs] = await Promise.all([getTranslations("jobs"), getFormatter(), listRecentJobRuns(100)]);
  const now = new Date();
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const seconds = (run: { startedAt: Date; finishedAt: Date | null }) => (run.finishedAt ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()) / 1000 : null);

  // The figures over the hundred most recent runs: how many jobs there are, what broke since
  // yesterday, how long a run takes, and when the next one is due.
  const jobNames = new Set([...CRONS.map((cron) => cron.job), ...runs.map((run) => run.job)]);
  const failedToday = runs.filter((run) => run.status === "failed" && run.startedAt.getTime() >= dayAgo).length;
  const medianSeconds = median(runs.map(seconds).filter((value): value is number => value !== null));
  const upcoming = CRONS.map((cron) => ({ ...cron, at: nextRunOf(cron, now) })).sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = upcoming[0];
  const scheduleOf = new Map(upcoming.map((cron) => [cron.job, cron.at]));
  const took = (value: number) => t("seconds", { seconds: Math.round(value * 10) / 10 });

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />

      <TileGrid>
        <Tile label={t("tiles.jobs")} value={jobNames.size} />
        <Tile label={t("tiles.failed")} value={failedToday} tone={failedToday > 0 ? "destructive" : undefined} hint={t("tiles.last24h")} />
        <Tile label={t("tiles.median")} value={medianSeconds === null ? "—" : took(medianSeconds)} />
        <Tile label={t("tiles.next")} value={next ? format.dateTime(next.at, { timeStyle: "short" }) : "—"} hint={next ? `${next.job} · ${format.dateTime(next.at, { dateStyle: "medium" })}` : undefined} />
      </TileGrid>

      <Section title={t("runs")} count={runs.length}>
        <TableCard>
          <Table className="min-w-[48rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="date">{t("started")}</TableHead>
                <TableHead kind="id">{t("job")}</TableHead>
                <TableHead kind="time" className="text-left">{t("schedule")}</TableHead>
                <TableHead kind="status">{t("status")}</TableHead>
                <TableHead kind="time">{t("took")}</TableHead>
                <TableHead kind="text">{t("result")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
              {runs.map((run) => {
                const at = scheduleOf.get(run.job);
                const length = seconds(run);
                return (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{format.dateTime(run.startedAt, { dateStyle: "short", timeStyle: "medium" })}</TableCell>
                    <TableCell className="font-semibold">{run.job}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{at ? t("daily", { time: format.dateTime(at, { timeStyle: "short" }) }) : <span className="text-faint">—</span>}</TableCell>
                    <TableCell>
                      <Badge dot variant={statusTone(run.status)}>{t(`statuses.${run.status}`)}</Badge>
                    </TableCell>
                    <TableCell kind="time" className="text-muted-foreground">{length === null ? "—" : took(length)}</TableCell>
                    <TableCell className="max-w-md truncate font-mono text-xs text-muted-foreground" title={run.error ?? (run.result ? JSON.stringify(run.result) : undefined)}>
                      {run.error ? <span className="text-destructive">{run.error}</span> : run.result ? JSON.stringify(run.result) : "—"}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      </Section>
    </Page>
  );
}
