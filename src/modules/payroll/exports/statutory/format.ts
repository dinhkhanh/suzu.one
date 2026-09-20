// What a statutory export is, and the registry of the ones we have (FR-PAY-35).
//
// **Adding a declaration is adding one file next to this one and one line in `STATUTORY_FORMATS`.**
// Each format is a pure function: it takes rows the service has already gathered and authorized,
// and returns a file. It never reads the database and never decides who may see anything.
//
// ⚠️ **Every layout in this folder is UNVERIFIED against the official template.** No HTKK or BHXH
// portal specification was available offline when they were written, so each file's header lists
// the columns it assumes. Before the first real filing the chief accountant must open the current
// template in HTKK / the BHXH portal and confirm or correct the list. The *figures* come from the
// same stored run results as the payslips and the reports, so they are as right as the payroll
// itself; what is guessed is the shape of the sheet, not the numbers in it.
import { type ExportColumn, toCsv } from "@/modules/platform/export/csv";

/** A file a statutory export produces. Always text; the browser saves it, nothing is stored. */
export type StatutoryFile = {
  fileName: string;
  content: string;
  contentType: string;
  rowCount: number;
  /** Shown beside the download: what the accountant must check before filing. */
  caveats: string[];
};

export const UNVERIFIED_CAVEAT = "Bố cục cột chưa được đối chiếu với biểu mẫu chính thức — kế toán trưởng cần kiểm tra trước khi nộp.";

/** Every format writes CSV with a BOM and CRLF, which is what HTKK and Excel in Vietnam read. */
export function csvFile<Row>(fileName: string, columns: readonly ExportColumn<Row>[], rows: readonly Row[], caveats: string[] = []): StatutoryFile {
  return { fileName, content: toCsv(columns, rows), contentType: "text/csv; charset=utf-8", rowCount: rows.length, caveats: [UNVERIFIED_CAVEAT, ...caveats] };
}

/**
 * A declaration whose body is a list of indicators ("chỉ tiêu") rather than a table of people:
 * two columns, the indicator's number and its value, which is how HTKK's import sheets are built.
 */
export type Indicator = { code: string; label: string; value: number | string };

export const indicatorColumns: ExportColumn<Indicator>[] = [
  { header: "Chỉ tiêu", value: (row) => row.code },
  { header: "Nội dung", value: (row) => row.label },
  { header: "Giá trị", value: (row) => row.value },
];

/** Vietnamese date as the tax and insurance forms write it. */
export const asFormDate = (iso: string | null): string => (iso ? iso.split("-").reverse().join("/") : "");
