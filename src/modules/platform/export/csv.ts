// CSV for list and report exports (FR-PLT-37). Pure. Excel in Vietnam opens it correctly thanks to
// the BOM; .xlsx and PDF output come later on the same column definitions.

export type ExportColumn<Row> = { header: string; value: (row: Row) => string | number | null | undefined };

/**
 * A cell that starts with = + - @ (or a tab / carriage return) is run as a formula by
 * spreadsheets. Exported data is typed by employees (names, notes), so such cells are prefixed
 * with an apostrophe: shown as text, never executed. Plain negative numbers stay numbers.
 */
function neutralize(cell: string): string {
  if (/^-?\d+([.,]\d+)?$/.test(cell)) return cell;
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

const quote = (cell: string) => (/[",;\n\r]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell);

export function toCsv<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): string {
  const line = (cells: string[]) => cells.map((cell) => quote(neutralize(cell))).join(",");
  const body = rows.map((row) => line(columns.map((column) => String(column.value(row) ?? ""))));
  return `﻿${[line(columns.map((column) => column.header)), ...body].join("\r\n")}\r\n`;
}

export type CsvFile = { fileName: string; csv: string; rowCount: number; /** The list had more rows than one export carries. */ truncated: boolean };

export const EXPORT_ROW_LIMIT = 5000;
