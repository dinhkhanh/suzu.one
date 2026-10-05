// CSV for list and report exports (FR-PLT-37). Pure. Excel in Vietnam opens it correctly thanks to
// the BOM; the same table is also written as .xlsx (./xlsx.ts).
import { type ExportColumn, type ExportTable, toTable } from "./table";

export { EXPORT_ROW_LIMIT, type ExportColumn, type ExportFile } from "./table";

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

export function tableToCsv(table: ExportTable): string {
  const line = (cells: readonly (string | number | null)[]) => cells.map((cell) => quote(neutralize(cell === null ? "" : String(cell)))).join(",");
  return `﻿${[line(table.header), ...table.rows.map(line)].join("\r\n")}\r\n`;
}

export function toCsv<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): string {
  return tableToCsv(toTable(columns, rows));
}
