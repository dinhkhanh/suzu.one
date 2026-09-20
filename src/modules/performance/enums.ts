// Value lists and small pure helpers shared by the server and the forms (a "use client" file
// cannot export constants to the server). Goals and key results: FR-PRF-01.

export const GOAL_LEVELS = ["group", "entity", "department", "team", "individual"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
/** 0 = the group. A parent sits at the same level or higher (a lower rank number). */
export const levelRank = (level: GoalLevel): number => GOAL_LEVELS.indexOf(level);

export const GOAL_STATUSES = ["draft", "active", "closed", "cancelled"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const METRIC_TYPES = ["number", "percent", "currency", "milestone"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];

export const CONFIDENCES = ["on_track", "at_risk", "off_track"] as const;
export type Confidence = (typeof CONFIDENCES)[number];

export type Milestone = { title: string; done: boolean };

/**
 * Key-result values are integers. Numbers and percentages are kept in hundredths (12.5 → 1250);
 * money is whole VND. The engine only ever divides two values of one key result, so the scale
 * never enters a score — it matters for reading and writing only.
 */
export const scaleOf = (metricType: MetricType): number => (metricType === "number" || metricType === "percent" ? 100 : 1);

/** "12,5" / "12.5" → 1250 for numbers and percentages; "1.500.000" / "1,500,000" → 1500000 for VND. */
export function parseMetricValue(metricType: MetricType, text: string): number | null {
  const cell = text.trim().replace(/\s/g, "");
  if (metricType === "milestone") return null;
  if (metricType === "currency") {
    const digits = cell.replace(/[.,]/g, "");
    if (!/^-?\d{1,15}$/.test(digits)) return null;
    return Number(digits);
  }
  const match = /^(-?)(\d{1,12})(?:[.,](\d{1,2}))?$/.exec(cell);
  if (!match) return null;
  const hundredths = Number(match[2]) * 100 + Number((match[3] ?? "0").padEnd(2, "0"));
  return match[1] ? -hundredths : hundredths;
}

/** The plain text a form field starts from; screens format through the reader's locale instead. */
export function metricValueText(metricType: MetricType, value: number): string {
  if (scaleOf(metricType) === 1) return String(value);
  const sign = value < 0 ? "-" : "";
  const absolute = Math.abs(value);
  const fraction = absolute % 100;
  return `${sign}${Math.trunc(absolute / 100)}${fraction === 0 ? "" : `,${String(fraction).padStart(2, "0").replace(/0$/, "")}`}`;
}

export const PERIOD_KEY = /^(\d{4})(?:-Q([1-4]))?$/;
export const isPeriodKey = (value: unknown): value is string => typeof value === "string" && PERIOD_KEY.test(value);
export const yearOfPeriod = (periodKey: string): number => Number(periodKey.slice(0, 4));
export const isAnnual = (periodKey: string): boolean => periodKey.length === 4;
export const periodsOfYear = (year: number): string[] => [String(year), `${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`];

/** A check-in that is a week old is due again. */
export const STALE_AFTER_DAYS = 7;

// ── KPIs (FR-PRF-02) ────────────────────────────────────────────────────────────────────────

/** Same scale rule as key results: numbers and percentages in hundredths, money in whole VND. */
export const KPI_UNITS = ["number", "percent", "currency"] as const;
export type KpiUnit = (typeof KPI_UNITS)[number];

export const KPI_DIRECTIONS = ["higher_better", "lower_better"] as const;
export type KpiDirection = (typeof KPI_DIRECTIONS)[number];

export const KPI_FREQUENCIES = ["monthly", "quarterly"] as const;
export type KpiFrequency = (typeof KPI_FREQUENCIES)[number];

/** Attainment is capped at 120 % unless the KPI says otherwise; nothing is floored by default. */
export const DEFAULT_CAP_BP = 12000;
export const DEFAULT_FLOOR_BP = 0;

export const MONTH_KEY = /^(\d{4})-(0[1-9]|1[0-2])$/;
export const QUARTER_KEY = /^(\d{4})-Q([1-4])$/;
export const isKpiMonth = (value: unknown): value is string => typeof value === "string" && MONTH_KEY.test(value);

/** "2027-03" → "2027-Q1". */
export const quarterOfMonth = (month: string): string => `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`;
/** Only months are closed: a quarterly KPI is scored in its quarter's last month (Mar, Jun, Sep, Dec). */
export const isQuarterEnd = (month: string): boolean => Number(month.slice(5, 7)) % 3 === 0;
/** "2027-Q1" → "2027-03"; a month is its own scoring month. */
export const scoringMonthOf = (periodKey: string): string => {
  const quarter = QUARTER_KEY.exec(periodKey);
  return quarter ? `${quarter[1]}-${String(Number(quarter[2]) * 3).padStart(2, "0")}` : periodKey;
};
/** The period a KPI of this frequency reports for when `month` is scored; null when it is not due then. */
export const periodDueIn = (frequency: KpiFrequency, month: string): string | null => (frequency === "monthly" ? month : isQuarterEnd(month) ? quarterOfMonth(month) : null);
export const periodFits = (frequency: KpiFrequency, periodKey: string): boolean => (frequency === "monthly" ? MONTH_KEY.test(periodKey) : QUARTER_KEY.test(periodKey));
export const monthsOfYear = (year: number): string[] => Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
/** Does an assignment running from `from` to `to` (open when null) cover `month`? Month keys sort as text. */
export const coversMonth = (assignment: { fromPeriod: string; toPeriod: string | null }, month: string): boolean => assignment.fromPeriod <= month && (assignment.toPeriod === null || month <= assignment.toPeriod);

export const KPI_PERIOD_STATUSES = ["open", "closed"] as const;
export type KpiPeriodStatus = (typeof KPI_PERIOD_STATUSES)[number];

// ── Review cycles (FR-PRF-03, Phase 8 week 1) ───────────────────────────────────────────────

export const REVIEW_CYCLE_KINDS = ["probation", "mid_year", "annual"] as const;
export type ReviewCycleKind = (typeof REVIEW_CYCLE_KINDS)[number];

/**
 * draft → active (self and manager write) → calibration (forms locked, HR levels the ratings)
 *       → released (each participant, one at a time) → closed.
 * `released` on the cycle means every participant has been released; a participant carries its own.
 */
export const REVIEW_CYCLE_STATUSES = ["draft", "active", "calibration", "released", "closed"] as const;
export type ReviewCycleStatus = (typeof REVIEW_CYCLE_STATUSES)[number];

export const REVIEW_FORM_KINDS = ["self", "manager", "peer"] as const;
export type ReviewFormKind = (typeof REVIEW_FORM_KINDS)[number];

export const REVIEW_FORM_STATUSES = ["draft", "submitted"] as const;
export type ReviewFormStatus = (typeof REVIEW_FORM_STATUSES)[number];

/** Where one person's review has got to. Only ever moves forward. */
export const REVIEW_STAGES = ["pending", "self_done", "manager_done", "calibrated", "released", "acknowledged"] as const;
export type ReviewStage = (typeof REVIEW_STAGES)[number];
export const stageRank = (stage: ReviewStage): number => REVIEW_STAGES.indexOf(stage);
/** Stages never go backwards: a re-release of an acknowledged review keeps the acknowledgement. */
export const laterStage = (a: ReviewStage, b: ReviewStage): ReviewStage => (stageRank(a) >= stageRank(b) ? a : b);

export const REVIEW_SECTION_KINDS = ["rating", "text"] as const;
export type ReviewSectionKind = (typeof REVIEW_SECTION_KINDS)[number];

export const PEER_NOMINATION_STATUSES = ["pending", "approved", "declined"] as const;
export type PeerNominationStatus = (typeof PEER_NOMINATION_STATUSES)[number];

/**
 * One question on a review form. `weight` counts only for rating sections; a text section is
 * prose and scores nothing. `askedOf` says which of the three forms carries the question — a
 * peer is rarely asked the same things as the person's manager.
 */
export type ReviewSection = {
  key: string;
  title: string;
  titleEn: string | null;
  kind: ReviewSectionKind;
  weight: number;
  required: boolean;
  askedOf: ReviewFormKind[];
};

/**
 * One point of the rating scale, with **what it is worth**. The mapping is configuration, not a
 * constant in code (SRS D13: the year-end bonus is computed from it): "meets expectations" is
 * worth 100 % on one scale and 80 % on another, and the company decides which.
 */
export type RatingPoint = { value: number; label: string; labelEn: string | null; scoreBp: number };

export type ReviewFormShape = { sections: ReviewSection[]; ratingScale: RatingPoint[] };

/** What one author wrote: section key → the chosen rating value, or the text. */
export type ReviewAnswers = Record<string, number | string>;

export const sectionsFor = (shape: ReviewFormShape, kind: ReviewFormKind): ReviewSection[] => shape.sections.filter((section) => section.askedOf.includes(kind));
