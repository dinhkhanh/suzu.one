// The client report (FR-PJM-58): a period's figures from the register, the publish log and its
// results, the milestones reached and the status updates — plus the author's own summary and plan
// for the next period. Pure: no I/O.
//
// This is what the client reads, so what it may say is decided here and nowhere else: never a fee,
// never a cost, and internal hours only when the author ticks "show hours".
import type { IsoDate } from "@/lib/dates";

export type ReportLine = { title: string; promised: number; accepted: number; delivered: number };
export type ReportPublish = { platform: string; url: string | null; publishedOn: IsoDate; title: string; metrics: { reach?: number; views?: number; engagement?: number; clicks?: number } };
export type ReportMilestone = { name: string; doneOn: IsoDate };
export type ReportUpdate = { on: IsoDate; health: string; summary: string };

export type ReportInput = {
  lines: readonly ReportLine[];
  publishes: readonly ReportPublish[];
  milestones: readonly ReportMilestone[];
  updates: readonly ReportUpdate[];
  hours: { loggedMinutes: number; billableMinutes: number } | null;
};

export type ReportFigures = {
  register: { promised: number; accepted: number; delivered: number; percent: number | null };
  lines: ReportLine[];
  publishing: { count: number; byPlatform: Record<string, number>; totals: { reach: number; views: number; engagement: number; clicks: number } };
  publishes: ReportPublish[];
  milestones: ReportMilestone[];
  updates: ReportUpdate[];
  /** Present only when the author chose to show hours. */
  hours?: { loggedMinutes: number; billableMinutes: number };
};

const within = (date: IsoDate, period: { from: IsoDate; to: IsoDate }) => date >= period.from && date <= period.to;

/** The figures of one period. Rows outside the period are dropped here, whatever the caller loaded. */
export function reportFigures(input: ReportInput, period: { from: IsoDate; to: IsoDate }, options: { showHours: boolean }): ReportFigures {
  const publishes = input.publishes.filter((row) => within(row.publishedOn, period)).sort((a, b) => a.publishedOn.localeCompare(b.publishedOn));
  const byPlatform: Record<string, number> = {};
  const totals = { reach: 0, views: 0, engagement: 0, clicks: 0 };
  for (const row of publishes) {
    byPlatform[row.platform] = (byPlatform[row.platform] ?? 0) + 1;
    for (const key of ["reach", "views", "engagement", "clicks"] as const) totals[key] += Math.max(0, row.metrics[key] ?? 0);
  }
  const promised = input.lines.reduce((sum, line) => sum + line.promised, 0);
  const accepted = input.lines.reduce((sum, line) => sum + line.accepted, 0);
  const delivered = input.lines.reduce((sum, line) => sum + line.delivered, 0);
  return {
    register: { promised, accepted, delivered, percent: promised > 0 ? Math.floor((accepted / promised) * 100) : null },
    lines: [...input.lines],
    publishing: { count: publishes.length, byPlatform, totals },
    publishes,
    milestones: input.milestones.filter((row) => within(row.doneOn, period)),
    updates: input.updates.filter((row) => within(row.on, period)).sort((a, b) => a.on.localeCompare(b.on)),
    ...(options.showHours && input.hours ? { hours: input.hours } : {}),
  };
}

export type ReportWords = {
  period: string;
  summary: string;
  register: string;
  registerLine: (line: ReportLine) => string;
  registerTotal: (figures: ReportFigures["register"]) => string;
  publishing: string;
  publishingTotal: (figures: ReportFigures["publishing"]) => string;
  milestones: string;
  updates: string;
  hours: (hours: { loggedMinutes: number; billableMinutes: number }) => string;
  nextPlan: string;
  none: string;
  platform: (platform: string) => string;
  health: (health: string) => string;
  date: (date: IsoDate) => string;
};

/** The report as the body of a letterhead PDF: headed sections of plain text. */
export function reportText(report: { periodFrom: IsoDate; periodTo: IsoDate; summary: string | null; nextPlan: string | null }, figures: ReportFigures, words: ReportWords): string {
  const section = (title: string, body: string[]) => [title.toUpperCase(), ...(body.length ? body : [words.none]), ""];
  return [
    `${words.period}: ${words.date(report.periodFrom)} – ${words.date(report.periodTo)}`,
    "",
    ...section(words.summary, report.summary ? [report.summary] : []),
    ...section(words.register, [words.registerTotal(figures.register), ...figures.lines.map((line) => `- ${words.registerLine(line)}`)]),
    ...section(words.publishing, figures.publishing.count ? [words.publishingTotal(figures.publishing), ...figures.publishes.map((row) => `- ${words.date(row.publishedOn)} · ${words.platform(row.platform)} · ${row.title}${row.url ? ` · ${row.url}` : ""}`)] : []),
    ...section(words.milestones, figures.milestones.map((row) => `- ${words.date(row.doneOn)} · ${row.name}`)),
    ...section(words.updates, figures.updates.map((row) => `- ${words.date(row.on)} · ${words.health(row.health)}: ${row.summary}`)),
    ...(figures.hours ? [words.hours(figures.hours), ""] : []),
    ...section(words.nextPlan, report.nextPlan ? [report.nextPlan] : []),
  ]
    .join("\n")
    .trimEnd();
}
