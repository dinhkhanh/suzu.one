// Monthly / quarterly PIT declaration data — form **05/KK-TNCN** — **UNVERIFIED AGAINST THE
// OFFICIAL TEMPLATE.**
//
// ⚠️ No HTKK specification was available when this was written. 05/KK-TNCN is an indicator form:
// the declaration itself is a short list of numbered boxes ("chỉ tiêu"), not a table of people.
// This export therefore produces **two files**: the indicators, in the order and numbering the
// form is believed to use, and a working sheet naming every person behind them so the figures can
// be traced and the declaration checked line by line before it is typed into HTKK.
//
// Assumed indicators (the numbering is the most likely thing to be wrong — check it first):
//
//   [21] Tổng số người lao động                               — everyone paid in the period
//   [22] … trong đó: cá nhân cư trú có hợp đồng từ 3 tháng     — the progressive-tax population
//   [23] Tổng số cá nhân đã khấu trừ thuế                      — people with tax > 0
//   [24] Tổng thu nhập chịu thuế trả cho cá nhân               — taxable income paid, all people
//   [25] … trong đó: cá nhân cư trú có hợp đồng từ 3 tháng
//   [26] … trong đó: cá nhân không ký hợp đồng / dưới 3 tháng
//   [27] … trong đó: cá nhân không cư trú
//   [28] Tổng thu nhập tính thuế                               — after deductions, resident staff
//   [29] Tổng số thuế thu nhập cá nhân đã khấu trừ             — the tax to be paid over
//   [30] … trong đó: cá nhân cư trú có hợp đồng từ 3 tháng
//   [31] … trong đó: cá nhân không ký hợp đồng / dưới 3 tháng
//   [32] … trong đó: cá nhân không cư trú
//
// Assumed besides the indicators:
//  * the period is a month ("2026-08") or a quarter ("2026-Q3"); a quarterly declaration is the
//    sum of its three months' runs;
//  * off-cycle runs of a month are part of that month's declaration — a bonus paid on the 20th is
//    declared with the salary paid on the 5th;
//  * "thu nhập chịu thuế" is taxable income **after** the exempt portions the engine computed
//    (exempt allowances up to their caps, the overtime/night exemption), not gross pay;
//  * a person appears once per period even when several runs paid them.
//
// The working sheet's own columns: Mã NV · Họ và tên · Mã số thuế · Diện tính thuế · Thu nhập
// chịu thuế · Các khoản giảm trừ · Thu nhập tính thuế · Số người phụ thuộc · Thuế đã khấu trừ.
import { type ExportColumn } from "@/modules/platform/export/csv";
import { csvFile, type Indicator, indicatorColumns, type StatutoryFile } from "./format";

/** One person's PIT figures for the period, already aggregated over the period's runs. */
export type PitPersonRow = {
  personId: string;
  fullName: string;
  employeeCode: string | null;
  taxCode: string | null;
  method: "progressive" | "flat_without_contract" | "flat_non_resident" | "none";
  taxableIncome: number;
  deductions: number;
  assessableIncome: number;
  dependents: number;
  tax: number;
};

export const PIT_METHOD_LABELS: Record<PitPersonRow["method"], string> = {
  progressive: "Cư trú, HĐLĐ từ 3 tháng",
  flat_without_contract: "Không HĐLĐ / dưới 3 tháng",
  flat_non_resident: "Không cư trú",
  none: "Không khấu trừ",
};

const personColumns: ExportColumn<PitPersonRow>[] = [
  { header: "Mã NV", value: (row) => row.employeeCode },
  { header: "Họ và tên", value: (row) => row.fullName },
  { header: "Mã số thuế", value: (row) => row.taxCode },
  { header: "Diện tính thuế", value: (row) => PIT_METHOD_LABELS[row.method] },
  { header: "Thu nhập chịu thuế", value: (row) => row.taxableIncome },
  { header: "Các khoản giảm trừ", value: (row) => row.deductions },
  { header: "Thu nhập tính thuế", value: (row) => row.assessableIncome },
  { header: "Số người phụ thuộc", value: (row) => row.dependents },
  { header: "Thuế đã khấu trừ", value: (row) => row.tax },
];

const sum = (rows: readonly PitPersonRow[], pick: (row: PitPersonRow) => number) => rows.reduce((total, row) => total + pick(row), 0);
const only = (rows: readonly PitPersonRow[], method: PitPersonRow["method"]) => rows.filter((row) => row.method === method);

export function pitIndicators(rows: readonly PitPersonRow[]): Indicator[] {
  const resident = only(rows, "progressive");
  const withoutContract = only(rows, "flat_without_contract");
  const nonResident = only(rows, "flat_non_resident");
  const income = (subset: readonly PitPersonRow[]) => sum(subset, (row) => row.taxableIncome);
  const tax = (subset: readonly PitPersonRow[]) => sum(subset, (row) => row.tax);

  return [
    { code: "[21]", label: "Tổng số người lao động", value: rows.length },
    { code: "[22]", label: "Trong đó: cá nhân cư trú có hợp đồng từ 3 tháng trở lên", value: resident.length },
    { code: "[23]", label: "Tổng số cá nhân đã khấu trừ thuế", value: rows.filter((row) => row.tax > 0).length },
    { code: "[24]", label: "Tổng thu nhập chịu thuế trả cho cá nhân", value: income(rows) },
    { code: "[25]", label: "Trong đó: cá nhân cư trú có hợp đồng từ 3 tháng trở lên", value: income(resident) },
    { code: "[26]", label: "Trong đó: cá nhân không ký hợp đồng hoặc hợp đồng dưới 3 tháng", value: income(withoutContract) },
    { code: "[27]", label: "Trong đó: cá nhân không cư trú", value: income(nonResident) },
    { code: "[28]", label: "Tổng thu nhập tính thuế", value: sum(resident, (row) => row.assessableIncome) },
    { code: "[29]", label: "Tổng số thuế thu nhập cá nhân đã khấu trừ", value: tax(rows) },
    { code: "[30]", label: "Trong đó: cá nhân cư trú có hợp đồng từ 3 tháng trở lên", value: tax(resident) },
    { code: "[31]", label: "Trong đó: cá nhân không ký hợp đồng hoặc hợp đồng dưới 3 tháng", value: tax(withoutContract) },
    { code: "[32]", label: "Trong đó: cá nhân không cư trú", value: tax(nonResident) },
  ];
}

export function buildPitMonthly(input: { entityCode: string; period: string; rows: readonly PitPersonRow[] }): StatutoryFile {
  return csvFile(`05KK-TNCN_${input.entityCode}_${input.period}.csv`, indicatorColumns, pitIndicators(input.rows), [
    "Số hiệu chỉ tiêu ([21]…[32]) là giả định — cần đối chiếu với HTKK trước khi nhập.",
    "Kỳ khai quý là tổng của ba tháng; các đợt trả ngoài kỳ đã được cộng vào tháng chi trả.",
  ]);
}

/** The people behind the indicators, so the declaration can be checked before it is filed. */
export function buildPitWorkingSheet(input: { entityCode: string; period: string; rows: readonly PitPersonRow[] }): StatutoryFile {
  return csvFile(`05KK-TNCN_${input.entityCode}_${input.period}_chi-tiet.csv`, personColumns, input.rows, ["Bảng kê nội bộ, không nộp cho cơ quan thuế."]);
}
