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
