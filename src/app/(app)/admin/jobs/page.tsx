import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader, Section, Tile, TileGrid } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { statusTone } from "@/components/ui/tone";
import { isDevelopmentEnvironment } from "@/lib/env";
import { requireUser } from "@/modules/platform/auth/session";
import { canRunJobs, canSeeJobs } from "@/modules/platform/jobs/policy";
import { listLatestRunPerJob, listRecentJobRuns } from "@/modules/platform/jobs/service";
import { countFailedDeliveries, DELIVERY_CHANNELS } from "@/modules/platform/notifications/delivery-health";
import { pageTitle } from "@/i18n/page-title";
import vercel from "../../../../../vercel.json";
import { ALL_JOBS, DEVELOPMENT_ONLY, schedulesOf } from "../../../api/cron/registry";
import { RunNowButton } from "./run-now-button";

export const generateMetadata = pageTitle("scheduledJobs");

// "Run now" waits for the job, and a job may take minutes: the action gets the cron route's time.
export const maxDuration = 300;

// The schedule is Vercel's cron table: "<minute> <hour> * * *" in UTC, one line per schedule, the
// schedule's name being the last segment of its path. Read here so the screen says when each job
// runs next without a second copy of the timetable.
type Cron = { schedule: string; minute: number; hour: number };
const CRONS: Cron[] = (vercel.crons ?? []).flatMap(({ path, schedule }) => {
  const [minute, hour, day, month, weekday] = schedule.split(/\s+/);
  if (day !== "*" || month !== "*" || weekday !== "*") return [];
  return [{ schedule: path.split("/").at(-1) ?? path, minute: Number(minute), hour: Number(hour) }];
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

/** Failed deliveries are counted over a week: long enough to see a provider that stopped, short enough that a fixed one clears. */
const DELIVERY_WINDOW_DAYS = 7;

export default async function JobsPage() {
  const user = await requireUser();
  if (!canSeeJobs(user.principal)) notFound();
  const mayRun = canRunJobs(user.principal);

  const now = new Date();
  const [t, format, runs, latest, failedDeliveries] = await Promise.all([
    getTranslations("jobs"),
    getFormatter(),
    listRecentJobRuns(100),
    listLatestRunPerJob(),
    countFailedDeliveries(new Date(now.getTime() - DELIVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000)),
  ]);
  const dayAgo = now.getTime() - 24 * 60 * 60 * 1000;
  const seconds = (run: { startedAt: Date; finishedAt: Date | null }) => (run.finishedAt ? Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime()) / 1000 : null);

  // The figures over the hundred most recent runs: what broke since yesterday, how long a run
  // takes, and when the next schedule is due.
  const failedToday = runs.filter((run) => run.status === "failed" && run.startedAt.getTime() >= dayAgo).length;
  const medianSeconds = median(runs.map(seconds).filter((value): value is number => value !== null));
  const upcoming = CRONS.map((cron) => ({ ...cron, at: nextRunOf(cron, now) })).sort((a, b) => a.at.getTime() - b.at.getTime());
  const next = upcoming[0];
  const scheduleAt = new Map(upcoming.map((cron) => [cron.schedule, cron.at]));
  const took = (value: number) => t("seconds", { seconds: Math.round(value * 10) / 10 });
  const deliveriesFailed = DELIVERY_CHANNELS.reduce((sum, channel) => sum + failedDeliveries[channel], 0);
  const deliveryHint = DELIVERY_CHANNELS.filter((channel) => failedDeliveries[channel] > 0)
    .map((channel) => `${t(`channels.${channel}`)} ${failedDeliveries[channel]}`)
    .join(" · ");

  // Every job the app knows, with its schedule and its latest run. Development-only jobs are not offered elsewhere.
  const latestOf = new Map(latest.map((run) => [run.job, run]));
  const jobs = ALL_JOBS.filter((job) => isDevelopmentEnvironment() || !DEVELOPMENT_ONLY.has(job.name)).map((job) => ({ name: job.name, schedules: schedulesOf(job.name), latest: latestOf.get(job.name) ?? null }));
  const whenOf = (job: string) => {
    const times = schedulesOf(job).flatMap((schedule) => {
      const at = scheduleAt.get(schedule);
      return at ? [format.dateTime(at, { timeStyle: "short" })] : [];
    });
    return times.length > 0 ? t("daily", { time: times.join(", ") }) : null;
  };

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />

      <TileGrid>
        <Tile label={t("tiles.jobs")} value={jobs.length} />
        <Tile label={t("tiles.failed")} value={failedToday} tone={failedToday > 0 ? "destructive" : undefined} hint={t("tiles.last24h")} />
        <Tile label={t("tiles.deliveries")} value={deliveriesFailed} tone={deliveriesFailed > 0 ? "destructive" : undefined} hint={deliveryHint || t("tiles.lastDays", { days: DELIVERY_WINDOW_DAYS })} />
        <Tile label={t("tiles.median")} value={medianSeconds === null ? "—" : took(medianSeconds)} />
        <Tile label={t("tiles.next")} value={next ? format.dateTime(next.at, { timeStyle: "short" }) : "—"} hint={next ? `${next.schedule} · ${format.dateTime(next.at, { dateStyle: "medium" })}` : undefined} />
      </TileGrid>

      <Section title={t("jobsSection")} count={jobs.length}>
        <TableCard>
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead kind="id">{t("job")}</TableHead>
                <TableHead kind="time" className="text-left">{t("schedule")}</TableHead>
                <TableHead kind="date">{t("lastRun")}</TableHead>
                <TableHead kind="status">{t("status")}</TableHead>
                {mayRun ? <TableHead kind="actions" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const when = whenOf(job.name);
                return (
                  <TableRow key={job.name}>
                    <TableCell className="font-semibold">{job.name}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{when ?? t("onDemand")}</TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{job.latest ? format.dateTime(job.latest.startedAt, { dateStyle: "short", timeStyle: "short" }) : "—"}</TableCell>
                    <TableCell>{job.latest ? <Badge dot variant={statusTone(job.latest.status)}>{t(`statuses.${job.latest.status}`)}</Badge> : <span className="text-faint">—</span>}</TableCell>
                    {mayRun ? (
                      <TableCell kind="actions">
                        <RunNowButton job={job.name} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableCard>
      </Section>

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
                const when = whenOf(run.job);
                const length = seconds(run);
                return (
                  <TableRow key={run.id}>
                    <TableCell className="font-mono text-xs text-muted-foreground tabular-nums">{format.dateTime(run.startedAt, { dateStyle: "short", timeStyle: "medium" })}</TableCell>
                    <TableCell className="font-semibold">{run.job}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{when ?? <span className="text-faint">—</span>}</TableCell>
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
