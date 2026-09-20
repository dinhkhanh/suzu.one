// From raw clock events to a day's in/out pairs (FR-ATT-08). Pure: no I/O.
//
// A person may have punches from the app, from a fingerprint clock, or both, plus punches that came
// out of an approved correction ("request") or were typed in by HR ("manual"). Two questions are
// answered here: which day does a punch belong to (someone leaving at 00:40, a night shift ending
// at 06:00), and which punches make the day's presence under the entity's merge rule.
import type { PlannedSegment } from "./calendar";

export type PunchSource = "app" | "device" | "manual" | "request";
export type MergeRule = "first_in_last_out" | "prefer_device" | "prefer_app";

/** `at`: minutes from the midnight (Vietnam time) of the day the punch is being considered for; may be below 0 or above 1440. */
export type DayPunch = { at: number; direction: "in" | "out"; source: PunchSource };

export type Pair = { in: number | null; out: number | null };

export type MergeOptions = {
  rule: MergeRule;
  duplicateWindowMinutes: number;
  /** "span": earliest to latest (one block of presence). "sequence": in, out, in, out … (split shifts). */
  pairing: "span" | "sequence";
};

export type MergedDay = { pairs: Pair[]; used: DayPunch[]; ignored: number; duplicates: number; trace: string[] };

// Two punches of the same moment (the phone and the clock at the door) keep one fixed order, so
// that the same inputs always read the same.
const inOrder = <P extends { at: number; source: string; direction: string }>(a: P, b: P) => a.at - b.at || a.source.localeCompare(b.source) || a.direction.localeCompare(b.direction);

// Corrections and HR's manual entries are decisions about the day: no rule sets them aside.
const ALWAYS: readonly PunchSource[] = ["request", "manual"];

export function mergePunches(punches: readonly DayPunch[], options: MergeOptions): MergedDay {
  const trace: string[] = [];
  const sorted = [...punches].sort(inOrder);

  let chosen = sorted;
  if (options.rule !== "first_in_last_out") {
    const preferred: PunchSource = options.rule === "prefer_device" ? "device" : "app";
    if (sorted.some((punch) => punch.source === preferred)) {
      chosen = sorted.filter((punch) => punch.source === preferred || ALWAYS.includes(punch.source));
      trace.push(`merge:${options.rule}:using_${preferred}`);
    } else if (sorted.length > 0) trace.push(`merge:${options.rule}:no_${preferred}_punches`);
  } else if (new Set(sorted.map((punch) => punch.source)).size > 1) trace.push("merge:first_in_last_out:across_sources");
  const ignored = sorted.length - chosen.length;

  // Tapping twice, or the clock and the phone within moments of each other: one event. The
  // earlier one stays for an arrival, which is also the first of any run.
  const used: DayPunch[] = [];
  for (const punch of chosen) {
    const previous = used.at(-1);
    if (previous && punch.at - previous.at <= options.duplicateWindowMinutes && (options.pairing === "span" || previous.direction === punch.direction)) continue;
    used.push(punch);
  }
  const duplicates = chosen.length - used.length;
  if (duplicates > 0) trace.push(`merge:duplicates_dropped:${duplicates}`);

  if (used.length === 0) return { pairs: [], used, ignored, duplicates, trace };

  if (options.pairing === "span") {
    // First in, last out: directions are not trusted (many clocks record none). A lone punch is an
    // arrival without a departure unless it says it is a departure.
    if (used.length === 1) return { pairs: [used[0].direction === "out" ? { in: null, out: used[0].at } : { in: used[0].at, out: null }], used, ignored, duplicates, trace };
    // The very first and the very last event, duplicates included: the latest tap is the departure.
    return { pairs: [{ in: chosen[0].at, out: chosen.at(-1)!.at }], used, ignored, duplicates, trace };
  }

  const pairs: Pair[] = [];
  let open: number | null = null;
  for (const punch of used) {
    if (punch.direction === "in") {
      if (open !== null) pairs.push({ in: open, out: null });
      open = punch.at;
    } else {
      pairs.push({ in: open, out: punch.at });
      open = null;
    }
  }
  if (open !== null) pairs.push({ in: open, out: null });
  return { pairs, used, ignored, duplicates, trace };
}

// ── Which day a punch belongs to ────────────────────────────────────────────────────────────

export type RawPunch = { /** Milliseconds since the epoch (server clock). */ at: number; direction: "in" | "out"; source: PunchSource };
export type PlannedDay = { date: string; segments: readonly PlannedSegment[] };

// How long after a night shift's planned end a departure still belongs to it, and how long
// before a shift's start a punch belongs to that shift.
const AFTER_SHIFT = 360;
const BEFORE_SHIFT = 180;
// Vietnam has one zone and no daylight saving: local time is UTC+7 all year.
const VIETNAM_OFFSET_MS = 7 * 3_600_000;

/** The Vietnam calendar date and minute of the day of an instant. */
export function vietnamDateAndMinute(at: number): { date: string; minute: number } {
  const local = new Date(at + VIETNAM_OFFSET_MS);
  return { date: local.toISOString().slice(0, 10), minute: local.getUTCHours() * 60 + local.getUTCMinutes() };
}

/** The instant of a minute counted from a Vietnam date's midnight. */
export const instantOf = (date: string, minute: number): number => Date.parse(`${date}T00:00:00Z`) - VIETNAM_OFFSET_MS + minute * 60_000;

const previousDate = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * Gives every punch to a day. A punch normally belongs to its own calendar day; it closes the day
 * before when that day's shift runs past midnight (22:00–06:00 belongs to the day it starts), or
 * when someone on an ordinary day left after midnight but before the policy's day boundary.
 */
export function assignPunchesToDays(days: readonly PlannedDay[], punches: readonly RawPunch[], dayBoundary: number): Map<string, DayPunch[]> {
  const planOf = new Map(days.map((day) => [day.date, day.segments]));
  const result = new Map<string, DayPunch[]>(days.map((day) => [day.date, []]));
  const openIn = (date: string) => result.get(date)?.at(-1)?.direction === "in";

  for (const punch of [...punches].sort(inOrder)) {
    const { date, minute } = vietnamDateAndMinute(punch.at);
    const before = previousDate(date);
    const ownStart = planOf.get(date)?.[0]?.start;
    const startsSoon = ownStart !== undefined && minute >= ownStart - BEFORE_SHIFT;
    const overnightEnd = Math.max(0, ...(planOf.get(before) ?? []).map((segment) => segment.end)) - 1440;

    let toPrevious = false;
    if (result.has(before)) {
      if (overnightEnd > 0 && minute <= overnightEnd + AFTER_SHIFT) toPrevious = openIn(before) || (!startsSoon && (punch.direction === "out" || ownStart === undefined));
      else toPrevious = punch.direction === "out" && openIn(before) && minute < dayBoundary && !startsSoon;
    }
    if (toPrevious) result.get(before)!.push({ at: minute + 1440, direction: "out", source: punch.source });
    else result.get(date)?.push({ at: minute, direction: punch.direction, source: punch.source });
  }
  return result;
}
