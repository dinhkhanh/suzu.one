// Turns a spreadsheet (rows of cells) into typed rows plus a list of problems. Pure: no I/O.
// Used by every import (FR-PLT-36): people, contracts, leave balances, salary, assets, attendance.
import { toSearchKey } from "@/lib/text";

export type Cell = string | number | boolean | Date | null | undefined;

/** A problem with one cell, as a message key (`imports.problems.<code>`) and what it is about. */
export type Problem = { row: number; column: string | null; code: string };

export type CellResult<Value> = { ok: true; value: Value } | { ok: false; code: string };

export type Column<Value> = {
  /** Headers this column answers to, Vietnamese first; matched without accents, case or spacing. */
  headers: readonly [string, ...string[]];
  required?: boolean;
  /** Restricted or compensation data: encrypted while the batch waits for its commit, masked in the preview. */
  sensitive?: boolean;
  parse: (cell: string) => CellResult<Value>;
  example?: string;
};

export type Columns = Record<string, Column<unknown>>;
export type RowOf<C extends Columns> = { [Field in keyof C]: C[Field] extends Column<infer Value> ? Value | null : never };
export type ParsedRow<C extends Columns> = { row: number; values: RowOf<C> };

const headerKey = (value: string) => toSearchKey(value).replace(/[^a-z0-9]/g, "");

// Spreadsheets hand back dates and numbers as such; everything is parsed from one text form.
function cellText(cell: Cell): string {
  if (cell === null || cell === undefined) return "";
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  return String(cell).trim();
}

export function parseTable<C extends Columns>(table: readonly (readonly Cell[])[], columns: C): { rows: ParsedRow<C>[]; problems: Problem[] } {
  const problems: Problem[] = [];
  const [header = [], ...body] = table;

  // Which sheet column feeds which field.
  const position = new Map<string, number>();
  const known = new Set<number>();
  for (const [field, column] of Object.entries(columns)) {
    const accepted = column.headers.map(headerKey);
    const index = header.findIndex((cell) => accepted.includes(headerKey(cellText(cell))));
    if (index >= 0) {
      position.set(field, index);
      known.add(index);
    } else if (column.required) {
      problems.push({ row: 1, column: column.headers[0], code: "column_missing" });
    }
  }
  header.forEach((cell, index) => {
    if (!known.has(index) && cellText(cell)) problems.push({ row: 1, column: cellText(cell), code: "column_unknown" });
  });
  if (problems.some((problem) => problem.code === "column_missing")) return { rows: [], problems };

  const rows: ParsedRow<C>[] = [];
  body.forEach((cells, offset) => {
    if (cells.every((cell) => cellText(cell) === "")) return;
    const row = offset + 2; // as shown in the spreadsheet: 1-based, after the header
    const values: Record<string, unknown> = {};
    for (const [field, column] of Object.entries(columns)) {
      const index = position.get(field);
      const text = index === undefined ? "" : cellText(cells[index]);
      if (text === "") {
        values[field] = null;
        if (column.required) problems.push({ row, column: column.headers[0], code: "required" });
        continue;
      }
      const result = column.parse(text);
      if (result.ok) values[field] = result.value;
      else {
        values[field] = null;
        problems.push({ row, column: column.headers[0], code: result.code });
      }
    }
    rows.push({ row, values: values as RowOf<C> });
  });
  if (rows.length === 0 && problems.every((problem) => problem.code === "column_unknown")) problems.push({ row: 1, column: null, code: "no_rows" });
  return { rows, problems };
}

// ── Cell parsers ────────────────────────────────────────────────────────────────────────────

const ok = <Value>(value: Value): CellResult<Value> => ({ ok: true, value });
const bad = (code: string): CellResult<never> => ({ ok: false, code });

export const text = (maxLength: number) => (cell: string) => (cell.length > maxLength ? bad("too_long") : ok(cell.replace(/\s+/g, " ")));

export const code = (maxLength: number) => (cell: string) => (/^[A-Za-z0-9_-]+$/.test(cell) && cell.length <= maxLength ? ok(cell.toUpperCase()) : bad("bad_code"));

export const email = (cell: string) => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell) ? ok(cell.toLowerCase()) : bad("bad_email"));

export const integer = (cell: string) => {
  // "12.500.000" and "12,500,000" are how amounts get typed; decimals are never valid.
  const digits = cell.replace(/[.,\s](?=\d{3}(\D|$))/g, "");
  return /^-?\d+$/.test(digits) ? ok(Number(digits)) : bad("bad_number");
};

/** ISO (what spreadsheets' real date cells become) or the Vietnamese dd/mm/yyyy. */
export const day = (cell: string) => {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(cell);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(cell);
  const parts = iso ? [iso[1], iso[2], iso[3]] : local ? [local[3], local[2], local[1]] : null;
  if (!parts) return bad("bad_date");
  const [year, month, date] = parts;
  const value = `${year}-${month.padStart(2, "0")}-${date.padStart(2, "0")}`;
  const check = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(check.getTime()) && check.toISOString().slice(0, 10) === value ? ok(value) : bad("bad_date");
};

/** Accepts any of the listed spellings for each value, e.g. { employee: ["Chính thức", "employee"] }. */
export const oneOf = <Value extends string>(spellings: Record<Value, readonly string[]>) => {
  const lookup = new Map<string, Value>();
  for (const [value, labels] of Object.entries(spellings) as [Value, readonly string[]][]) for (const label of [value, ...labels]) lookup.set(headerKey(label), value);
  return (cell: string) => {
    const value = lookup.get(headerKey(cell));
    return value ? ok(value) : bad("bad_choice");
  };
};

// ── CSV ─────────────────────────────────────────────────────────────────────────────────────

/** RFC 4180 with the habits of Excel in Vietnam: optional BOM, and ";" when "," is the decimal mark. */
export function parseCsv(source: string): string[][] {
  const input = source.replace(/^﻿/, "");
  const firstLine = input.slice(0, input.search(/\r?\n|$/));
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const table: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === "") quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(field);
      table.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    table.push(row);
  }
  return table;
}

/** A starter file: the headers people should use, and one example row. With a BOM so Excel reads UTF-8. */
export function templateCsv(columns: Columns): string {
  const quote = (value: string) => (/[",;\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
  const list = Object.values(columns);
  return `﻿${list.map((column) => quote(column.headers[0])).join(",")}\n${list.map((column) => quote(column.example ?? "")).join(",")}\n`;
}
