// The recruitment reports (FR-REC-11): funnel conversion, time to hire, source effectiveness.
// Pure arithmetic over rows a query has already scoped — no I/O, no clock, no permissions.
//
// The whole report rests on one decision taken back in week 1: **a rejection keeps the stage it
// was rejected at.** So an application's stage is not only where it is, it is how far it got, and
// the funnel can be counted without a second history table. `stage_moved` events would give the
// same answer more expensively and would be wrong for anybody moved backwards.
//
// Two things this file deliberately does not do:
//   · **no money** — cost per hire (FR-REC-11) would need recruitment spend, which nothing in this
//     system records; a made-up number is worse than a missing one, so it is absent and said to be;
//   · **no averages of one** — a rate computed from a handful of applications is noise dressed as
//     insight, so every rate carries the count it came from and the page shows both.

import { STAGE_CATEGORIES, type StageCategory } from "../enums";
import type { ApplicationStatus, CandidateSource } from "../enums";

/** One application, reduced to what a report needs. */
export type FunnelApplication = {
  /** The category of the stage it stands in — for a rejection, the stage it was rejected at. */
  category: StageCategory;
  status: ApplicationStatus;
  source: CandidateSource;
  /** Days from applying to the hire, for the ones that became a colleague. Null otherwise. */
  daysToHire: number | null;
};

export type FunnelStep = {
  category: StageCategory;
  /** How many applications got at least this far. */
  reached: number;
  /** Of the ones that reached the step before, the share that reached this one. Null for the first. */
  conversionFromPrevious: number | null;
  /** Of everybody who applied, the share that reached this step. */
  shareOfApplied: number;
};

const ORDER = new Map(STAGE_CATEGORIES.map((category, index) => [category, index]));

/**
 * How far one application got, as an index into `STAGE_CATEGORIES`. A hire counts as having
 * reached `hired` whatever stage the board happens to leave the card in — being on the books is
 * the fact; the column is a convenience.
 */
export function furthestIndex(application: FunnelApplication): number {
  const byStage = ORDER.get(application.category) ?? 0;
  return application.status === "hired" ? Math.max(byStage, ORDER.get("hired")!) : byStage;
}

const share = (part: number, whole: number): number => (whole === 0 ? 0 : Math.round((part / whole) * 1000) / 10);

/** The funnel: how many reached each rung, and the conversion between them. */
export function funnelSteps(applications: readonly FunnelApplication[]): FunnelStep[] {
  const indices = applications.map(furthestIndex);
  const applied = applications.length;
  let previous: number | null = null;
  return STAGE_CATEGORIES.map((category, index) => {
    const reached = indices.filter((value) => value >= index).length;
    const step: FunnelStep = {
      category,
      reached,
      conversionFromPrevious: previous === null ? null : share(reached, previous),
      shareOfApplied: share(reached, applied),
    };
    previous = reached;
    return step;
  });
}

export type TimeToHire = {
  hires: number;
  /** Days. Null when nobody has been hired: an average of nothing is not zero. */
  median: number | null;
  mean: number | null;
  fastest: number | null;
  slowest: number | null;
};

/** The middle value; with an even count, the mean of the two in the middle. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

export function timeToHire(applications: readonly FunnelApplication[]): TimeToHire {
  const days = applications.filter((application) => application.status === "hired" && application.daysToHire !== null).map((application) => application.daysToHire!);
  if (days.length === 0) return { hires: 0, median: null, mean: null, fastest: null, slowest: null };
  return {
    hires: days.length,
    median: median(days),
    mean: Math.round((days.reduce((total, value) => total + value, 0) / days.length) * 10) / 10,
    fastest: Math.min(...days),
    slowest: Math.max(...days),
  };
}

export type SourceRow = {
  source: CandidateSource;
  applications: number;
  /** Reached the interview rung or beyond: the cheapest honest measure of "was this lead any good". */
  interviewed: number;
  hires: number;
  /** Hires as a share of applications, in percent. */
  hireRate: number;
  medianDaysToHire: number | null;
};

/** Which sources actually produce colleagues. Ordered by hires, then by volume. */
export function sourceEffectiveness(applications: readonly FunnelApplication[]): SourceRow[] {
  const interviewIndex = ORDER.get("interview")!;
  const bySource = new Map<CandidateSource, FunnelApplication[]>();
  for (const application of applications) {
    const list = bySource.get(application.source);
    if (list) list.push(application);
    else bySource.set(application.source, [application]);
  }
  return [...bySource.entries()]
    .map(([source, rows]) => {
      const hires = rows.filter((row) => row.status === "hired");
      return {
        source,
        applications: rows.length,
        interviewed: rows.filter((row) => furthestIndex(row) >= interviewIndex).length,
        hires: hires.length,
        hireRate: share(hires.length, rows.length),
        medianDaysToHire: median(hires.map((row) => row.daysToHire).filter((value): value is number => value !== null)),
      };
    })
    .sort((a, b) => b.hires - a.hires || b.applications - a.applications || a.source.localeCompare(b.source));
}

export type FunnelReport = {
  applications: number;
  active: number;
  rejected: number;
  withdrawn: number;
  steps: FunnelStep[];
  timeToHire: TimeToHire;
  sources: SourceRow[];
};

export function funnelReport(applications: readonly FunnelApplication[]): FunnelReport {
  return {
    applications: applications.length,
    active: applications.filter((application) => application.status === "active").length,
    rejected: applications.filter((application) => application.status === "rejected").length,
    withdrawn: applications.filter((application) => application.status === "withdrawn").length,
    steps: funnelSteps(applications),
    timeToHire: timeToHire(applications),
    sources: sourceEffectiveness(applications),
  };
}
