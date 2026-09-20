// Dependants registration list — data for form **07/ĐK-NPT-TNCN** (đăng ký người phụ thuộc) —
// **UNVERIFIED AGAINST THE OFFICIAL TEMPLATE.**
//
// ⚠️ No HTKK specification was available when this was written. The official form registers
// dependants per employee, with a block for dependants who already have a tax code and a block
// for those who do not (where the identity documents matter). This export is one flat table of
// every dependant claimed in the period, with the columns both blocks need.
//
// Assumed columns, in this order:
//
//  1. STT                   — row number, from 1
//  2. HO VA TEN NLD         — the employee claiming the deduction
//  3. MA SO THUE NLD        — their tax code
//  4. MA NHAN VIEN          — the employee code, for the company's own reconciliation
//  5. HO VA TEN NPT         — the dependant
//  6. NGAY SINH NPT         — dd/mm/yyyy
//  7. MA SO THUE NPT        — blank when the dependant has none
//  8. SO CCCD / GIAY KHAI SINH — national ID, or the birth-certificate number for a child
//  9. QUAN HE               — relationship, in Vietnamese
// 10. TU THANG              — first month of the deduction, mm/yyyy
// 11. DEN THANG             — last month, mm/yyyy; blank while it continues
//
// Assumed besides the columns:
//  * a dependant registered for part of the period appears once, with its own from/to months;
//  * the relationship words are the form's usual ones (Con, Vợ/Chồng, Cha/Mẹ, …) — mapped below;
//  * the tax office's own form separates newly registered dependants from continuing ones. This
//    file contains **all** dependants claimed in the period; the accountant filters by `TU THANG`.
import type { DependantRegistration } from "@/modules/core-hr/service";
import { type ExportColumn } from "@/modules/platform/export/csv";
import { asFormDate, csvFile, type StatutoryFile } from "./format";

export const RELATIONSHIP_LABELS: Record<string, string> = {
  child: "Con",
  spouse: "Vợ/Chồng",
  parent: "Cha/Mẹ",
  parent_in_law: "Cha/Mẹ vợ (chồng)",
  sibling: "Anh/Chị/Em ruột",
  grandparent: "Ông/Bà",
  other: "Khác",
};

const asMonth = (iso: string | null): string => (iso ? iso.split("-").slice(0, 2).reverse().join("/") : "");

const columns: ExportColumn<DependantRegistration & { index: number }>[] = [
  { header: "STT", value: (row) => row.index },
  { header: "HO VA TEN NLD", value: (row) => row.personName },
  { header: "MA SO THUE NLD", value: (row) => row.personTaxCode },
  { header: "MA NHAN VIEN", value: (row) => row.employeeCode },
  { header: "HO VA TEN NPT", value: (row) => row.dependantName },
  { header: "NGAY SINH NPT", value: (row) => asFormDate(row.dateOfBirth) },
  { header: "MA SO THUE NPT", value: (row) => row.taxCode },
  { header: "SO CCCD / GIAY KHAI SINH", value: (row) => row.idNumber },
  { header: "QUAN HE", value: (row) => RELATIONSHIP_LABELS[row.relationship] ?? row.relationship },
  { header: "TU THANG", value: (row) => asMonth(row.deductionFrom) },
  { header: "DEN THANG", value: (row) => asMonth(row.deductionTo) },
];

export function buildDependants(input: { entityCode: string; period: string; rows: readonly DependantRegistration[] }): StatutoryFile {
  const numbered = input.rows.map((row, index) => ({ ...row, index: index + 1 }));
  return csvFile(`07DK-NPT-TNCN_${input.entityCode}_${input.period}.csv`, columns, numbered, [
    "Biểu mẫu chính thức tách người phụ thuộc đã có mã số thuế và chưa có — lọc theo cột MA SO THUE NPT.",
  ]);
}
