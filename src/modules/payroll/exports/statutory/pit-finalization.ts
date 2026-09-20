// Annual PIT finalization data — form **05/QTT-TNCN** with appendices **05-1/BK-QTT-TNCN** and
// **05-2/BK-QTT-TNCN** — **UNVERIFIED AGAINST THE OFFICIAL TEMPLATE.**
//
// ⚠️ No HTKK specification was available when this was written. The finalization is one indicator
// sheet plus two appendices, so this export produces three files:
//
//   05/QTT-TNCN    the declaration's indicators for the year
//   05-1/BK        resident individuals with a labour contract of three months or more
//   05-2/BK        individuals without a contract, with a contract under three months, and
//                  non-residents
//
// Assumed indicators of the declaration ([21]…[37] below; the numbering is the likeliest error):
//
//   [21] Tổng số cá nhân đã chi trả thu nhập trong kỳ
//   [22] … cá nhân cư trú có hợp đồng từ 3 tháng
//   [23] … cá nhân không ký hợp đồng / dưới 3 tháng
//   [24] … cá nhân không cư trú
//   [25] Tổng số cá nhân thuộc diện phải khấu trừ thuế
//   [26] Tổng thu nhập chịu thuế trả cho cá nhân
//   [27] … cá nhân cư trú có hợp đồng từ 3 tháng
//   [28] … cá nhân không ký hợp đồng / dưới 3 tháng
//   [29] … cá nhân không cư trú
//   [30] Tổng các khoản giảm trừ (bản thân, người phụ thuộc, bảo hiểm, từ thiện)
//   [31] Tổng thu nhập tính thuế
//   [32] Tổng số thuế thu nhập cá nhân đã khấu trừ
//   [33] Tổng số thuế phải nộp theo quyết toán
//   [34] Tổng số thuế nộp thừa
//   [35] Tổng số thuế còn phải nộp
//   [36] Tổng số người phụ thuộc đã tính giảm trừ
//   [37] Tổng số cá nhân uỷ quyền quyết toán
//
// Assumed besides the indicators:
//  * the year's figures are the sum of the entity's runs for the year **plus** any year-to-date
//    figures imported for people whose year started outside the system (FR-PAY-35, YTD import);
//  * a person who authorised the company to finalize on their behalf is marked in 05-1's
//    `UY QUYEN QUYET TOAN` column — the system has no such register yet, so the column is written
//    empty and HR ticks it in the sheet. This is a **known gap**, listed in the phase's status note;
//  * `[33]` is computed by re-taxing the year's assessable income with the same progressive
//    brackets used monthly. Where the year's brackets changed mid-year, HTKK's own arithmetic is
//    authoritative — this figure is a check, not a filing;
//  * an individual appears in exactly one appendix, decided by the tax method of their **last**
//    run in the year.
import { type ExportColumn } from "@/modules/platform/export/csv";
import { asFormDate, csvFile, type Indicator, indicatorColumns, type StatutoryFile } from "./format";

/** One person's year, aggregated from every run and any imported year-to-date figures. */
export type FinalizationRow = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  taxCode: string | null;
  nationalId: string | null;
  method: "progressive" | "flat_without_contract" | "flat_non_resident" | "none";
  /** True when part of this person's year came from the year-to-date import rather than a run. */
  hasImportedPeriod: boolean;
  taxableIncome: number;
  insuranceDeduction: number;
  personalDeduction: number;
  dependentDeduction: number;
  otherDeductions: number;
  dependents: number;
  assessableIncome: number;
  taxWithheld: number;
  /** The year's tax recomputed on the year's assessable income — a check against `taxWithheld`. */
  taxDue: number;
};

const money = (pick: (row: FinalizationRow) => number) => (row: FinalizationRow) => pick(row);

const appendixColumns: ExportColumn<FinalizationRow & { index: number }>[] = [
  { header: "STT", value: (row) => row.index },
  { header: "HO VA TEN", value: (row) => row.fullName },
  { header: "MA SO THUE", value: (row) => row.taxCode },
  { header: "SO CCCD", value: (row) => row.nationalId },
  { header: "TONG THU NHAP CHIU THUE", value: money((row) => row.taxableIncome) },
  { header: "CAC KHOAN BAO HIEM DUOC TRU", value: money((row) => row.insuranceDeduction) },
  { header: "GIAM TRU BAN THAN", value: money((row) => row.personalDeduction) },
  { header: "GIAM TRU NGUOI PHU THUOC", value: money((row) => row.dependentDeduction) },
  { header: "SO NGUOI PHU THUOC", value: (row) => row.dependents },
  { header: "CAC KHOAN GIAM TRU KHAC", value: money((row) => row.otherDeductions) },
  { header: "THU NHAP TINH THUE", value: money((row) => row.assessableIncome) },
  { header: "SO THUE DA KHAU TRU", value: money((row) => row.taxWithheld) },
  { header: "SO THUE PHAI NOP", value: money((row) => row.taxDue) },
  // The system holds no register of who authorised the company to finalize for them.
  { header: "UY QUYEN QUYET TOAN", value: () => "" },
  { header: "MA NHAN VIEN", value: (row) => row.employeeCode },
  { header: "CO SO LIEU NHAP TU NGOAI HE THONG", value: (row) => (row.hasImportedPeriod ? "x" : "") },
];

const flatColumns: ExportColumn<FinalizationRow & { index: number }>[] = [
  { header: "STT", value: (row) => row.index },
  { header: "HO VA TEN", value: (row) => row.fullName },
  { header: "MA SO THUE", value: (row) => row.taxCode },
  { header: "SO CCCD", value: (row) => row.nationalId },
  { header: "DIEN TINH THUE", value: (row) => (row.method === "flat_non_resident" ? "Không cư trú" : "Không HĐLĐ / dưới 3 tháng") },
  { header: "TONG THU NHAP CHIU THUE", value: money((row) => row.taxableIncome) },
  { header: "SO THUE DA KHAU TRU", value: money((row) => row.taxWithheld) },
  { header: "MA NHAN VIEN", value: (row) => row.employeeCode },
  { header: "CO SO LIEU NHAP TU NGOAI HE THONG", value: (row) => (row.hasImportedPeriod ? "x" : "") },
];

const sum = (rows: readonly FinalizationRow[], pick: (row: FinalizationRow) => number) => rows.reduce((total, row) => total + pick(row), 0);

export const residentRows = (rows: readonly FinalizationRow[]) => rows.filter((row) => row.method === "progressive");
export const flatRows = (rows: readonly FinalizationRow[]) => rows.filter((row) => row.method === "flat_without_contract" || row.method === "flat_non_resident");

export function finalizationIndicators(rows: readonly FinalizationRow[]): Indicator[] {
  const resident = residentRows(rows);
  const withoutContract = rows.filter((row) => row.method === "flat_without_contract");
  const nonResident = rows.filter((row) => row.method === "flat_non_resident");
  const income = (subset: readonly FinalizationRow[]) => sum(subset, (row) => row.taxableIncome);
  const withheld = sum(rows, (row) => row.taxWithheld);
  const due = sum(rows, (row) => row.taxDue);

  return [
    { code: "[21]", label: "Tổng số cá nhân đã chi trả thu nhập trong kỳ", value: rows.length },
    { code: "[22]", label: "Trong đó: cá nhân cư trú có hợp đồng từ 3 tháng trở lên", value: resident.length },
    { code: "[23]", label: "Trong đó: cá nhân không ký hợp đồng hoặc hợp đồng dưới 3 tháng", value: withoutContract.length },
    { code: "[24]", label: "Trong đó: cá nhân không cư trú", value: nonResident.length },
    { code: "[25]", label: "Tổng số cá nhân thuộc diện phải khấu trừ thuế", value: rows.filter((row) => row.taxWithheld > 0).length },
    { code: "[26]", label: "Tổng thu nhập chịu thuế trả cho cá nhân", value: income(rows) },
    { code: "[27]", label: "Trong đó: cá nhân cư trú có hợp đồng từ 3 tháng trở lên", value: income(resident) },
    { code: "[28]", label: "Trong đó: cá nhân không ký hợp đồng hoặc hợp đồng dưới 3 tháng", value: income(withoutContract) },
    { code: "[29]", label: "Trong đó: cá nhân không cư trú", value: income(nonResident) },
    { code: "[30]", label: "Tổng các khoản giảm trừ", value: sum(resident, (row) => row.insuranceDeduction + row.personalDeduction + row.dependentDeduction + row.otherDeductions) },
    { code: "[31]", label: "Tổng thu nhập tính thuế", value: sum(resident, (row) => row.assessableIncome) },
    { code: "[32]", label: "Tổng số thuế thu nhập cá nhân đã khấu trừ", value: withheld },
    { code: "[33]", label: "Tổng số thuế phải nộp theo quyết toán", value: due },
    { code: "[34]", label: "Tổng số thuế nộp thừa", value: Math.max(0, withheld - due) },
    { code: "[35]", label: "Tổng số thuế còn phải nộp", value: Math.max(0, due - withheld) },
    { code: "[36]", label: "Tổng số người phụ thuộc đã tính giảm trừ", value: sum(rows, (row) => row.dependents) },
    { code: "[37]", label: "Tổng số cá nhân uỷ quyền quyết toán", value: "" },
  ];
}

export function buildFinalization(input: { entityCode: string; year: number; rows: readonly FinalizationRow[] }): StatutoryFile {
  return csvFile(`05QTT-TNCN_${input.entityCode}_${input.year}.csv`, indicatorColumns, finalizationIndicators(input.rows), [
    "Số hiệu chỉ tiêu là giả định — cần đối chiếu với HTKK.",
    "Chỉ tiêu [37] (uỷ quyền quyết toán) hệ thống chưa quản lý, cần HR điền tay.",
    "Số thuế phải nộp theo quyết toán là số tính lại để đối chiếu, không thay cho kết quả của HTKK.",
  ]);
}

export function buildFinalizationAppendix1(input: { entityCode: string; year: number; rows: readonly FinalizationRow[] }): StatutoryFile {
  const rows = residentRows(input.rows).map((row, index) => ({ ...row, index: index + 1 }));
  return csvFile(`05-1BK-QTT-TNCN_${input.entityCode}_${input.year}.csv`, appendixColumns, rows, ["Phụ lục 05-1/BK: cá nhân cư trú có hợp đồng từ 3 tháng trở lên."]);
}

export function buildFinalizationAppendix2(input: { entityCode: string; year: number; rows: readonly FinalizationRow[] }): StatutoryFile {
  const rows = flatRows(input.rows).map((row, index) => ({ ...row, index: index + 1 }));
  return csvFile(`05-2BK-QTT-TNCN_${input.entityCode}_${input.year}.csv`, flatColumns, rows, ["Phụ lục 05-2/BK: cá nhân không ký hợp đồng, hợp đồng dưới 3 tháng và cá nhân không cư trú."]);
}

// ── The withholding certificate / income confirmation for one person (FR-PAY-35) ────────────

export type WithholdingCertificate = {
  entityName: string;
  entityTaxCode: string | null;
  entityAddress: string | null;
  year: number;
  person: FinalizationRow & { dateOfBirth: string | null };
  /** The months the person was actually paid in the year, "2026-01" … */
  months: string[];
  issuedOn: string;
};

/** The certificate's own data as a two-column sheet; the printable version is a page in `ui`. */
export function buildWithholdingCertificateData(certificate: WithholdingCertificate): StatutoryFile {
  const person = certificate.person;
  const rows: Indicator[] = [
    { code: "1", label: "Tên tổ chức trả thu nhập", value: certificate.entityName },
    { code: "2", label: "Mã số thuế của tổ chức trả thu nhập", value: certificate.entityTaxCode ?? "" },
    { code: "3", label: "Địa chỉ", value: certificate.entityAddress ?? "" },
    { code: "4", label: "Họ và tên cá nhân nhận thu nhập", value: person.fullName },
    { code: "5", label: "Mã số thuế cá nhân", value: person.taxCode ?? "" },
    { code: "6", label: "Số CCCD", value: person.nationalId ?? "" },
    { code: "7", label: "Ngày sinh", value: asFormDate(certificate.person.dateOfBirth) },
    { code: "8", label: "Kỳ tính thuế", value: String(certificate.year) },
    { code: "9", label: "Số tháng được chi trả trong kỳ", value: certificate.months.length },
    { code: "10", label: "Tổng thu nhập chịu thuế", value: person.taxableIncome },
    { code: "11", label: "Các khoản bảo hiểm được trừ", value: person.insuranceDeduction },
    { code: "12", label: "Giảm trừ bản thân", value: person.personalDeduction },
    { code: "13", label: "Giảm trừ người phụ thuộc", value: person.dependentDeduction },
    { code: "14", label: "Thu nhập tính thuế", value: person.assessableIncome },
    { code: "15", label: "Số thuế thu nhập cá nhân đã khấu trừ", value: person.taxWithheld },
    { code: "16", label: "Ngày cấp chứng từ", value: asFormDate(certificate.issuedOn) },
  ];
  return csvFile(`chung-tu-khau-tru-${person.employeeCode ?? person.personId}-${certificate.year}.csv`, indicatorColumns, rows, [
    "Chứng từ khấu trừ thuế TNCN chính thức phải in theo mẫu của cơ quan thuế hoặc phát hành điện tử; đây là dữ liệu để lập chứng từ.",
  ]);
}
