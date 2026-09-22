// A person's week of time (FR-PJM-24, 25, 26). Pure: the grid a week's entries make, what typing
// a number into one of its cells does to the entries under it, the week's approval states, and the
// attendance hint beside each day. The service reads the rows and writes what these return.

type IsoDate = string;

const addDays = (date: IsoDate, days: number): IsoDate => {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
};

/** The seven dates of the week that starts on `weekStart` (a Monday). */
export const weekDates = (weekStart: IsoDate): IsoDate[] => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));

// ── Approval (FR-PJM-25) ────────────────────────────────────────────────────────────────────

/**
 * open → submitted → approved | returned. Returned is open again for the person: they fix and
 * submit anew. Approved is locked; only an approver reopens it, with a reason.
 */
export const TIMESHEET_STATUSES = ["open", "submitted", "approved", "returned"] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

export type TimesheetEvent = { type: "submit" } | { type: "approve" } | { type: "return"; comment: string | null } | { type: "reopen"; reason: string | null };

export type Transition = { ok: true; status: TimesheetStatus } | { ok: false; error: "timesheet_not_submitted" | "timesheet_not_open" | "timesheet_not_approved" | "timesheet_comment_required" };

export function transition(status: TimesheetStatus, event: TimesheetEvent): Transition {
  switch (event.type) {
    case "submit":
      return status === "open" || status === "returned" ? { ok: true, status: "submitted" } : { ok: false, error: "timesheet_not_open" };
    case "approve":
      return status === "submitted" ? { ok: true, status: "approved" } : { ok: false, error: "timesheet_not_submitted" };
    case "return":
      if (status !== "submitted") return { ok: false, error: "timesheet_not_submitted" };
      // Sending a week back without saying why leaves the person guessing.
      return event.comment?.trim() ? { ok: true, status: "returned" } : { ok: false, error: "timesheet_comment_required" };
    case "reopen":
      if (status !== "approved") return { ok: false, error: "timesheet_not_approved" };
      return event.reason?.trim() ? { ok: true, status: "open" } : { ok: false, error: "timesheet_comment_required" };
  }
}

/** The person may add, change and remove entries only in a week that is theirs to edit. */
export const isWeekEditable = (status: TimesheetStatus | null): boolean => status === null || status === "open" || status === "returned";

// ── The week grid ───────────────────────────────────────────────────────────────────────────

export type GridEntry = { id: string; date: IsoDate; taskId: string | null; category: string | null; minutes: number; billable: boolean; createdAt: Date };

/** A row of the grid: one task, or one category of time not on a task. */
export type RowKey = `task:${string}` | `category:${string}`;
export const rowKeyOf = (entry: Pick<GridEntry, "taskId" | "category">): RowKey => (entry.taskId ? `task:${entry.taskId}` : `category:${entry.category ?? "internal"}`);
export function parseRowKey(key: string): { taskId: string; category: null } | { taskId: null; category: string } | null {
  const [kind, id] = key.split(":");
  if (!id) return null;
  if (kind === "task") return { taskId: id, category: null };
  if (kind === "category") return { taskId: null, category: id };
  return null;
}

export type GridRow = { key: RowKey; cells: number[]; total: number; billable: number };
export type WeekGrid = { dates: IsoDate[]; rows: GridRow[]; dayTotals: number[]; total: number; billable: number };

/**
 * Tasks and categories down, the seven days across, a total at the end of each row and at the foot
 * of each day. Rows keep the order the person first logged on them; entries outside the week are
 * ignored. `extraRows` adds empty rows (copied from last week, or just added) after the others.
 */
export function buildWeekGrid(weekStart: IsoDate, entries: readonly GridEntry[], extraRows: readonly RowKey[] = []): WeekGrid {
  const dates = weekDates(weekStart);
  const rows = new Map<RowKey, GridRow>();
  const rowOf = (key: RowKey) => {
    let row = rows.get(key);
    if (!row) rows.set(key, (row = { key, cells: dates.map(() => 0), total: 0, billable: 0 }));
    return row;
  };
  const dayTotals = dates.map(() => 0);
  const ordered = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
  for (const entry of ordered) {
    const index = dates.indexOf(entry.date);
    if (index < 0) continue;
    const row = rowOf(rowKeyOf(entry));
    row.cells[index] += entry.minutes;
    row.total += entry.minutes;
    if (entry.billable) row.billable += entry.minutes;
    dayTotals[index] += entry.minutes;
  }
  for (const key of extraRows) rowOf(key);
  const all = [...rows.values()];
  return { dates, rows: all, dayTotals, total: dayTotals.reduce((sum, value) => sum + value, 0), billable: all.reduce((sum, row) => sum + row.billable, 0) };
}

/** "Copy last week's rows": last week's tasks and categories, as empty rows this week does not have yet. */
export function rowsToCopy(lastWeek: readonly Pick<GridEntry, "taskId" | "category">[], thisWeek: readonly Pick<GridEntry, "taskId" | "category">[]): RowKey[] {
  const have = new Set(thisWeek.map(rowKeyOf));
  return [...new Set(lastWeek.map(rowKeyOf))].filter((key) => !have.has(key));
}

export type CellChange = { updates: { id: string; minutes: number }[]; deletes: string[]; insert: number | null };

/**
 * Typing a total into a cell (one row, one day). The entries already there keep their notes and
 * billable flags: more time is added to the newest entry; less is taken from the newest first,
 * and an entry brought to nothing is removed. An empty cell gets one new entry.
 */
export function planCellChange(entries: readonly Pick<GridEntry, "id" | "minutes" | "createdAt">[], target: number): CellChange {
  const change: CellChange = { updates: [], deletes: [], insert: null };
  const newestFirst = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const current = newestFirst.reduce((sum, entry) => sum + entry.minutes, 0);
  const wanted = Math.max(0, Math.round(target));
  if (wanted === current) return change;
  if (newestFirst.length === 0) return { ...change, insert: wanted };
  if (wanted > current) {
    const newest = newestFirst[0];
    return { ...change, updates: [{ id: newest.id, minutes: newest.minutes + wanted - current }] };
  }
  let cut = current - wanted;
  for (const entry of newestFirst) {
    if (cut === 0) break;
    const taken = Math.min(entry.minutes, cut);
    cut -= taken;
    if (taken === entry.minutes) change.deletes.push(entry.id);
    else change.updates.push({ id: entry.id, minutes: entry.minutes - taken });
  }
  return change;
}

// ── Time vs attendance (FR-PJM-26) ──────────────────────────────────────────────────────────

/** Attendance's day, as far as the hint needs it (the timesheet_day columns). */
export type AttendanceDay = { status: string; workedMinutes: number; wfhMinutes: number; tripMinutes: number };
export type AttendanceHint = { kind: "attended"; minutes: number } | { kind: "untracked" } | { kind: "none" };

/**
 * What attendance says of a day, beside the hours logged on it — information only; neither record
 * changes the other. Attended = time present plus approved work from home and business trips.
 * An untracked Saturday has no punches to compare with, and says so.
 */
export function attendanceHint(day: AttendanceDay | null): AttendanceHint {
  if (!day) return { kind: "none" };
  if (day.status === "untracked") return { kind: "untracked" };
  return { kind: "attended", minutes: day.workedMinutes + day.wfhMinutes + day.tripMinutes };
}
