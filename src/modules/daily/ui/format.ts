// Small display helpers shared by the day's screens. A plain module: no hooks, no JSX.

/** 90 → "1.5", 45 → "0.8": hours with one decimal, for "{value} h" messages. */
export const hoursOf = (minutes: number): string => (Math.round((minutes / 60) * 10) / 10).toString();

/** "1h30", "90", "1.5h", "45m", "2g" → minutes; null when it cannot be read. */
export function parseDuration(text: string): number | null {
  const value = text.trim().toLowerCase().replace(",", ".");
  if (!value) return null;
  const hoursAndMinutes = /^(\d+)\s*[hg:]\s*(\d{1,2})$/.exec(value);
  if (hoursAndMinutes) return Number(hoursAndMinutes[1]) * 60 + Number(hoursAndMinutes[2]);
  const hours = /^(\d+(?:\.\d+)?)\s*(h|g|giờ|gio)$/.exec(value);
  if (hours) return Math.round(Number(hours[1]) * 60);
  const minutes = /^(\d+)\s*(m|p|phút|phut)?$/.exec(value);
  if (minutes) return Number(minutes[1]);
  return null;
}

export const TEXTAREA = "min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-base md:text-sm";

/** Taps for the quick log: the usual lengths of a stretch of work. */
export const QUICK_MINUTES = [15, 30, 60, 90, 120] as const;

/**
 * A cell of the week grid: a bare number up to 24 is hours ("2" = 2 h, "1.5" = 90 min) — in a
 * timesheet people type hours — and anything larger, or written with a unit, reads as
 * `parseDuration` does. Empty is 0 (clearing the cell); null when it cannot be read.
 */
export function parseCellDuration(text: string): number | null {
  const value = text.trim().replace(",", ".");
  if (!value) return 0;
  if (/^\d+(\.\d+)?$/.test(value) && Number(value) <= 24) return Math.round(Number(value) * 60);
  return parseDuration(value);
}

/** 90 → "1h30", 120 → "2h", 45 → "45m", 0 → "": what a grid cell shows, and reads back. */
export function durationText(minutes: number): string {
  if (minutes <= 0) return "";
  if (minutes < 60) return `${minutes}m`;
  const rest = minutes % 60;
  return rest === 0 ? `${minutes / 60}h` : `${Math.floor(minutes / 60)}h${String(rest).padStart(2, "0")}`;
}

/** A ratio as a whole percentage ("80"), or null. */
export const percentOf = (ratio: number | null): string | null => (ratio === null ? null : Math.round(ratio * 100).toString());
