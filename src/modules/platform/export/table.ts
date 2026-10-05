// What a list export carries (FR-PLT-37): the table itself — headers and typed cells — rather than
// one file format. The server builds it with the screen's own query and principal (and audits it);
// the browser writes it as Excel (.xlsx) or CSV, whichever the person asked for. Pure.

export type ExportColumn<Row> = { header: string; value: (row: Row) => string | number | null | undefined };

export type ExportCell = string | number | null;
export type ExportTable = { header: string[]; rows: ExportCell[][] };

/** One export: a file name without its extension, the table, and whether the list had more rows than one export carries. */
export type ExportFile = { fileName: string; table: ExportTable; rowCount: number; truncated: boolean };

export const EXPORT_ROW_LIMIT = 5000;

export const EXPORT_FORMATS = ["xlsx", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function toTable<Row>(columns: readonly ExportColumn<Row>[], rows: readonly Row[]): ExportTable {
  return {
    header: columns.map((column) => column.header),
    rows: rows.map((row) =>
      columns.map((column) => {
        const value = column.value(row);
        return value === undefined || value === null ? null : typeof value === "number" ? (Number.isFinite(value) ? value : null) : String(value);
      }),
    ),
  };
}

/** The list cut to what one export carries, and the file that says so. */
export function exportFile<Row>(fileName: string, columns: readonly ExportColumn<Row>[], rows: readonly Row[], total: number = rows.length): ExportFile {
  const kept = rows.slice(0, EXPORT_ROW_LIMIT);
  return { fileName, table: toTable(columns, kept), rowCount: kept.length, truncated: total > kept.length };
}
