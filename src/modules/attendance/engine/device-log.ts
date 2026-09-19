// Reading a time clock's export (FR-ATT-06). Pure: no I/O.
//
// Every device model writes its own file: a CSV with headers, an Excel sheet, or ZKTeco's
// `attlog.dat` (no header; user ID, timestamp and status codes separated by tabs). A mapping
// profile says where the three facts sit; what comes out is one table every import understands:
// device user ID · local timestamp "YYYY-MM-DD HH:mm:ss" · direction ("in", "out" or empty).
import { toSearchKey } from "@/lib/text";

export type ColumnRef = { header?: string; position?: number };

export type DeviceMapping = {
  hasHeader: boolean;
  userId: ColumnRef;
  timestamp: ColumnRef;
  /** A second column when the date and the time are exported apart; the format then describes "<date> <time>". */
  time?: ColumnRef;
  direction?: ColumnRef;
  /** Tokens YYYY MM DD HH mm ss (D, M, H may be one digit in the file), e.g. "DD/MM/YYYY HH:mm". */
  timestampFormat: string;
  /** Status code on the device → direction, e.g. { "0": "in", "1": "out" }. Compared without case. */
  directionCodes: Record<string, "in" | "out">;
  /** Codes not listed (or no direction column): the order of a person's punches in a day decides. */
  inferDirection: boolean;
};

export const CANONICAL_HEADERS = ["Device user ID", "Time", "Direction"] as const;

type Cell = string | number | boolean | Date | null | undefined;

const pad = (value: number, size = 2) => String(value).padStart(size, "0");

/** `attlog.dat` and its relatives: one event per line, fields apart by tabs (or runs of spaces). */
export function parseDat(source: string): string[][] {
  return source
    .replace(/^\uFEFF/, "")
    .replace(/(\r?\n)+$/, "")
    .split(/\r?\n/)
    .map((line) => {
      if (line.trim() === "") return [];
      if (line.includes("\t")) return line.split("\t").map((field) => field.trim());
      // Space-separated: a date followed by a time is one timestamp.
      const fields = line.trim().split(/\s+/);
      const merged: string[] = [];
      for (const field of fields) {
        if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(field) && merged.length > 0 && /\d[-/.]\d/.test(merged.at(-1)!)) merged[merged.length - 1] += ` ${field}`;
        else merged.push(field);
      }
      return merged;
    });
}

/** A timestamp in the profile's format → "YYYY-MM-DD HH:mm:ss", or null when it does not fit or is no real moment. */
export function parseTimestamp(text: string, format: string): string | null {
  const tokens = ["YYYY", "MM", "DD", "HH", "mm", "ss"] as const;
  const order: (typeof tokens)[number][] = [];
  const pattern = format.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/YYYY|MM|DD|HH|mm|ss/g, (token) => {
    order.push(token as (typeof tokens)[number]);
    return token === "YYYY" ? "(\\d{4})" : "(\\d{1,2})";
  }).replace(/\s+/g, "\\s+");
  const match = new RegExp(`^${pattern}$`).exec(text.trim());
  if (!match || !order.includes("YYYY") || !order.includes("MM") || !order.includes("DD") || !order.includes("HH") || !order.includes("mm")) return null;
  const part = (token: (typeof tokens)[number]) => (order.includes(token) ? Number(match[order.indexOf(token) + 1]) : 0);
  const [year, month, day, hour, minute, second] = tokens.map(part);
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) return null;
  return `${pad(year, 4)}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

const cellText = (cell: Cell): string => {
  if (cell === null || cell === undefined) return "";
  // A real date cell of a spreadsheet: its UTC fields are the clock's local reading.
  if (cell instanceof Date) return `${pad(cell.getUTCFullYear(), 4)}-${pad(cell.getUTCMonth() + 1)}-${pad(cell.getUTCDate())} ${pad(cell.getUTCHours())}:${pad(cell.getUTCMinutes())}:${pad(cell.getUTCSeconds())}`;
  return String(cell).trim();
};

const key = (value: string) => toSearchKey(value).replace(/[^a-z0-9]/g, "");

export type MappingProblem = "mapping_user_column" | "mapping_time_column" | "mapping_format";

export function mappingProblems(mapping: DeviceMapping): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const usable = (ref: ColumnRef | undefined) => !!ref && (mapping.hasHeader ? !!ref.header?.trim() || !!ref.position : !!ref.position && ref.position >= 1);
  if (!usable(mapping.userId)) problems.push("mapping_user_column");
  if (!usable(mapping.timestamp)) problems.push("mapping_time_column");
  // With a separate time column the format describes both cells, joined by a space.
  if (!["YYYY", "MM", "DD", "HH", "mm"].every((token) => mapping.timestampFormat.includes(token))) problems.push("mapping_format");
  return problems;
}

/**
 * The export as the canonical table (header row first). A file whose header row lacks a mapped
 * column comes back with that canonical header missing, so the import reports `column_missing`;
 * a timestamp that does not fit the format is passed through for the import to flag on its row.
 */
export function toCanonicalTable(table: readonly (readonly Cell[])[], mapping: DeviceMapping): { table: string[][]; headerless: boolean } {
  const body = mapping.hasHeader ? table.slice(1) : table;
  const header = mapping.hasHeader ? (table[0] ?? []).map((cell) => key(cellText(cell))) : [];
  const indexOf = (ref: ColumnRef | undefined): number => {
    if (!ref) return -1;
    if (mapping.hasHeader && ref.header?.trim()) return header.indexOf(key(ref.header));
    return ref.position ? ref.position - 1 : -1;
  };
  const columns = { userId: indexOf(mapping.userId), timestamp: indexOf(mapping.timestamp), time: indexOf(mapping.time), direction: indexOf(mapping.direction) };
  const codes = new Map(Object.entries(mapping.directionCodes).map(([code, direction]) => [code.trim().toLowerCase(), direction]));

  const headers = [columns.userId >= 0 ? CANONICAL_HEADERS[0] : "", columns.timestamp >= 0 ? CANONICAL_HEADERS[1] : "", CANONICAL_HEADERS[2]];
  const rows = body.map((cells) => {
    if (cells.every((cell) => cellText(cell) === "")) return ["", "", ""];
    const stamp = [cellText(cells[columns.timestamp]), columns.time >= 0 ? cellText(cells[columns.time]) : ""].filter(Boolean).join(" ");
    // Date cells arrive canonical already; text goes through the profile's format.
    const canonical = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp) && cells[columns.timestamp] instanceof Date ? stamp : parseTimestamp(stamp, mapping.timestampFormat);
    const code = columns.direction >= 0 ? cellText(cells[columns.direction]).toLowerCase() : "";
    return [cellText(cells[columns.userId]), canonical ?? (stamp || "?"), codes.get(code) ?? ""];
  });
  return { table: [headers, ...rows], headerless: !mapping.hasHeader };
}

/** in, out, in, out … for punches that came without a direction; `existing` = how many device punches the person-day already has. */
export const inferredDirection = (existing: number, indexInFile: number): "in" | "out" => ((existing + indexInFile) % 2 === 0 ? "in" : "out");

// Starter profiles (`pnpm db:seed`). HR copies and adjusts them per device model.
export const PROFILE_SEED: { name: string; deviceModel: string; fileKind: "csv" | "xlsx" | "dat"; mapping: DeviceMapping }[] = [
  {
    name: "CSV chung (có dòng tiêu đề)",
    deviceModel: "Generic CSV",
    fileKind: "csv",
    mapping: { hasHeader: true, userId: { header: "User ID" }, timestamp: { header: "Time" }, direction: { header: "Status" }, timestampFormat: "YYYY-MM-DD HH:mm:ss", directionCodes: { in: "in", out: "out", "check-in": "in", "check-out": "out", "c/in": "in", "c/out": "out", "0": "in", "1": "out" }, inferDirection: true },
  },
  {
    name: "ZKTeco attlog.dat",
    deviceModel: "ZKTeco (attlog.dat)",
    fileKind: "dat",
    // PIN · timestamp · device number · status (0 in, 1 out, 4 overtime in, 5 overtime out) · verify mode · work code
    mapping: { hasHeader: false, userId: { position: 1 }, timestamp: { position: 2 }, direction: { position: 4 }, timestampFormat: "YYYY-MM-DD HH:mm:ss", directionCodes: { "0": "in", "1": "out", "4": "in", "5": "out" }, inferDirection: true },
  },
];
