// Insurance increase / decrease list — data for form **D02-LT** (Danh sách lao động tham gia
// BHXH, BHYT, BHTNLĐ-BNN) — **UNVERIFIED AGAINST THE OFFICIAL TEMPLATE.**
//
// ⚠️ No BHXH portal specification was available when this was written. D02-LT is a multi-block
// form (I. Tăng — 1. Lao động, 2. Tiền lương; II. Giảm — same two blocks), and the real sheet
// carries merged headers that no CSV can reproduce. What this export gives the accountant is the
// **data** of those blocks in one flat table, in the order the form asks for it, so the rows can
// be pasted into the template block by block. The `Phương án` column is what decides which block
// a row belongs to.
//
// Assumed columns, in this order:
//
//  1. STT                  — row number, from 1
//  2. HO VA TEN            — full name as on file
//  3. MA SO BHXH           — the person's social-insurance number (blank for someone new)
//  4. SO CCCD              — national ID; the portal matches on it when the BHXH number is blank
//  5. NGAY SINH            — date of birth, dd/mm/yyyy
//  6. GIOI TINH            — "Nam" / "Nữ"
//  7. CAP BAC, CHUC VU     — position name
//  8. TU THANG             — the month the change applies from, mm/yyyy
//  9. MUC DONG CU          — the contribution base before the change (0 for a new participant)
// 10. MUC DONG MOI         — the contribution base from that month (0 for a leaver)
// 11. PHUONG AN            — the form's code for the change; see `D02LT_REASONS` below
// 12. GHI CHU              — why, in words: "Tuyển mới", "Nghỉ việc", "Tăng lương", …
// 13. MA NHAN VIEN         — the employee code, for the company's own reconciliation
//
// Assumed besides the columns:
//  * one row per person per change; a person who both joined and got a raise in the same month
//    appears once, as a join at the new base;
//  * the codes in `PHUONG AN` are the portal's usual short codes (TM / TL / GH / OF / KL). These
//    are the single most likely thing to be wrong here — the accountant should check them first;
//  * money is a plain integer VND with no separators, which is what the portal's importer expects;
//  * a person whose base did not move and who neither joined nor left is **not** in the file.
import { type ExportColumn } from "@/modules/platform/export/csv";
import { asFormDate, csvFile, type StatutoryFile } from "./format";

/** The change the row reports. The label is what goes in `GHI CHU` when nothing better is known. */
export const D02LT_REASONS = {
  new_participant: { code: "TM", label: "Tăng mới" },
  base_increase: { code: "TL", label: "Điều chỉnh tăng mức đóng" },
  base_decrease: { code: "TL", label: "Điều chỉnh giảm mức đóng" },
  left: { code: "GH", label: "Giảm do nghỉ việc" },
  unpaid_leave: { code: "KL", label: "Giảm do nghỉ không lương" },
  insurance_leave: { code: "OF", label: "Giảm do nghỉ ốm đau/thai sản" },
  other_stop: { code: "GH", label: "Giảm khác" },
} as const;

export type D02ltReason = keyof typeof D02LT_REASONS;

export type D02ltRow = {
  fullName: string;
  socialInsuranceNumber: string | null;
  nationalId: string | null;
  dateOfBirth: string | null;
  gender: "male" | "female" | "other" | null;
  positionName: string | null;
  /** The month the change applies from, "2026-08". */
  month: string;
  previousBase: number;
  newBase: number;
  reason: D02ltReason;
  note: string | null;
  employeeCode: string | null;
};

const asMonth = (month: string): string => {
  const [year, monthNumber] = month.split("-");
  return `${monthNumber}/${year}`;
};

const asGender = (gender: D02ltRow["gender"]): string => (gender === "male" ? "Nam" : gender === "female" ? "Nữ" : "");

const columns: ExportColumn<D02ltRow & { index: number }>[] = [
  { header: "STT", value: (row) => row.index },
  { header: "HO VA TEN", value: (row) => row.fullName },
  { header: "MA SO BHXH", value: (row) => row.socialInsuranceNumber },
  { header: "SO CCCD", value: (row) => row.nationalId },
  { header: "NGAY SINH", value: (row) => asFormDate(row.dateOfBirth) },
  { header: "GIOI TINH", value: (row) => asGender(row.gender) },
  { header: "CAP BAC, CHUC VU", value: (row) => row.positionName },
  { header: "TU THANG", value: (row) => asMonth(row.month) },
  { header: "MUC DONG CU", value: (row) => row.previousBase },
  { header: "MUC DONG MOI", value: (row) => row.newBase },
  { header: "PHUONG AN", value: (row) => D02LT_REASONS[row.reason].code },
  { header: "GHI CHU", value: (row) => row.note ?? D02LT_REASONS[row.reason].label },
  { header: "MA NHAN VIEN", value: (row) => row.employeeCode },
];

export function buildD02lt(input: { entityCode: string; month: string; rows: readonly D02ltRow[] }): StatutoryFile {
  const numbered = input.rows.map((row, index) => ({ ...row, index: index + 1 }));
  return csvFile(`D02LT_${input.entityCode}_${input.month}.csv`, columns, numbered, [
    "Mỗi dòng là một thay đổi; dán vào đúng khối Tăng / Giảm của biểu mẫu D02-LT.",
    "Cột PHUONG AN dùng mã rút gọn (TM/TL/GH/KL/OF) — cần đối chiếu với cổng BHXH.",
  ]);
}
