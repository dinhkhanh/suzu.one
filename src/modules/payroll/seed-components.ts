// The starter pay component catalogue (FR-PAY-02), group-wide, seeded by `pnpm db:seed` as
// approved versions from 2026-01-01. Re-seeding only adds codes that have no version at all, so
// nothing C&B proposed or the owner approved is ever touched. Plain module (the seed runs under tsx).
//
// Tax and insurance attributes here are starting points for the chief accountant to confirm —
// above all the meal allowance cap, which the law has changed more than once.
type Seed = {
  code: string;
  name: string;
  nameEn: string;
  kind: "earning" | "deduction" | "employer_cost";
  category: "salary" | "allowance" | "overtime" | "bonus" | "commission" | "thirteenth_month" | "holiday_bonus" | "leave_payout" | "retro" | "insurance" | "pit" | "union" | "advance" | "penalty" | "asset_compensation" | "loan" | "other";
  source: "structure" | "formula" | "engine" | "input";
  taxTreatment?: "taxable" | "exempt" | "exempt_up_to_cap";
  exemptCap?: number;
  subjectToInsurance?: boolean;
  proration?: "fixed" | "attendance";
  note?: string;
};

const SEEDS: Seed[] = [
  { code: "BASE", name: "Lương cơ bản", nameEn: "Base salary", kind: "earning", category: "salary", source: "structure", subjectToInsurance: true, proration: "attendance" },
  { code: "ALW_RESPONSIBILITY", name: "Phụ cấp trách nhiệm", nameEn: "Responsibility allowance", kind: "earning", category: "allowance", source: "structure", subjectToInsurance: true, proration: "attendance" },
  { code: "ALW_MEAL", name: "Phụ cấp ăn trưa", nameEn: "Meal allowance", kind: "earning", category: "allowance", source: "structure", taxTreatment: "exempt_up_to_cap", exemptCap: 730_000, proration: "attendance", note: "Mức miễn thuế 730.000 đ/tháng là mức cũ — kế toán trưởng xác nhận mức hiện hành." },
  { code: "ALW_PHONE", name: "Phụ cấp điện thoại", nameEn: "Phone allowance", kind: "earning", category: "allowance", source: "structure", taxTreatment: "exempt", proration: "fixed", note: "Miễn thuế trong mức khoán theo quy chế công ty — kế toán trưởng xác nhận." },
  { code: "ALW_TRANSPORT", name: "Phụ cấp xăng xe, đi lại", nameEn: "Transport allowance", kind: "earning", category: "allowance", source: "structure", proration: "attendance" },
  { code: "ALW_HOUSING", name: "Phụ cấp nhà ở", nameEn: "Housing allowance", kind: "earning", category: "allowance", source: "structure", proration: "fixed" },
  { code: "OT_WEEKDAY", name: "Làm thêm ngày thường", nameEn: "Overtime — weekday", kind: "earning", category: "overtime", source: "engine" },
  { code: "OT_REST_DAY", name: "Làm thêm ngày nghỉ hằng tuần", nameEn: "Overtime — rest day", kind: "earning", category: "overtime", source: "engine" },
  { code: "OT_HOLIDAY", name: "Làm thêm ngày lễ, Tết", nameEn: "Overtime — public holiday", kind: "earning", category: "overtime", source: "engine" },
  { code: "NIGHT_PREMIUM", name: "Phụ cấp làm đêm", nameEn: "Night-work premium", kind: "earning", category: "overtime", source: "engine" },
  { code: "KPI_BONUS", name: "Thưởng KPI / hiệu suất", nameEn: "KPI / performance bonus", kind: "earning", category: "bonus", source: "input" },
  { code: "COMMISSION", name: "Hoa hồng", nameEn: "Commission", kind: "earning", category: "commission", source: "input" },
  { code: "BONUS", name: "Thưởng khác", nameEn: "Other bonus", kind: "earning", category: "bonus", source: "input" },
  { code: "THIRTEENTH_MONTH", name: "Lương tháng 13", nameEn: "13th-month salary", kind: "earning", category: "thirteenth_month", source: "input" },
  { code: "HOLIDAY_BONUS", name: "Thưởng lễ, Tết", nameEn: "Holiday bonus", kind: "earning", category: "holiday_bonus", source: "input" },
  { code: "LEAVE_PAYOUT", name: "Thanh toán phép năm chưa nghỉ", nameEn: "Unused leave payout", kind: "earning", category: "leave_payout", source: "engine" },
  { code: "RETRO_PAY", name: "Truy lĩnh kỳ trước", nameEn: "Retroactive pay", kind: "earning", category: "retro", source: "engine", note: "Chênh lệch của kỳ đã trả, tính thuế vào tháng chi trả (FR-PAY-17)." },
  { code: "RETRO_RECOVERY", name: "Truy thu kỳ trước", nameEn: "Retroactive recovery", kind: "deduction", category: "retro", source: "engine", note: "Khoản thu hồi của kỳ đã trả (FR-PAY-17)." },
  { code: "INS_BHXH_EE", name: "BHXH (người lao động)", nameEn: "Social insurance (employee)", kind: "deduction", category: "insurance", source: "engine" },
  { code: "INS_BHYT_EE", name: "BHYT (người lao động)", nameEn: "Health insurance (employee)", kind: "deduction", category: "insurance", source: "engine" },
  { code: "INS_BHTN_EE", name: "BHTN (người lao động)", nameEn: "Unemployment insurance (employee)", kind: "deduction", category: "insurance", source: "engine" },
  { code: "PIT", name: "Thuế thu nhập cá nhân", nameEn: "Personal income tax", kind: "deduction", category: "pit", source: "engine" },
  { code: "UNION_DUES", name: "Đoàn phí công đoàn", nameEn: "Union dues", kind: "deduction", category: "union", source: "engine" },
  { code: "ADVANCE", name: "Tạm ứng lương", nameEn: "Salary advance", kind: "deduction", category: "advance", source: "input" },
  { code: "PENALTY", name: "Khấu trừ vi phạm", nameEn: "Penalty", kind: "deduction", category: "penalty", source: "input" },
  { code: "ASSET_COMPENSATION", name: "Bồi thường tài sản", nameEn: "Asset compensation", kind: "deduction", category: "asset_compensation", source: "input" },
  { code: "LOAN_REPAYMENT", name: "Trả nợ vay công ty", nameEn: "Loan repayment", kind: "deduction", category: "loan", source: "input" },
  // Phase 6 (FR-REQ-03): an approved expense claim is paid back through the month's run. It is a
  // refund of the employee's own money, so it is not income — not taxed, not insured, and never
  // pro-rated by attendance. The chief accountant confirms the treatment.
  {
    code: "EXPENSE_REIMBURSE",
    name: "Hoàn ứng chi phí",
    nameEn: "Expense reimbursement",
    kind: "earning",
    category: "other",
    source: "input",
    taxTreatment: "exempt",
    subjectToInsurance: false,
    proration: "fixed",
    note: "Hoàn lại tiền người lao động đã chi hộ công ty theo đề nghị thanh toán chi phí đã duyệt — không phải thu nhập chịu thuế, không tính bảo hiểm. Kế toán trưởng xác nhận.",
  },
  { code: "INS_BHXH_ER", name: "BHXH (công ty đóng)", nameEn: "Social insurance (employer)", kind: "employer_cost", category: "insurance", source: "engine" },
  { code: "INS_BHYT_ER", name: "BHYT (công ty đóng)", nameEn: "Health insurance (employer)", kind: "employer_cost", category: "insurance", source: "engine" },
  { code: "INS_BHTN_ER", name: "BHTN (công ty đóng)", nameEn: "Unemployment insurance (employer)", kind: "employer_cost", category: "insurance", source: "engine" },
  { code: "UNION_FUND", name: "Kinh phí công đoàn (công ty đóng)", nameEn: "Union fund (employer)", kind: "employer_cost", category: "union", source: "engine" },
];

export const PAY_COMPONENT_SEED_VALID_FROM = "2026-01-01";

export const payComponentSeedRows = () =>
  SEEDS.map((seed, index) => ({
    entityId: null,
    code: seed.code,
    name: seed.name,
    nameEn: seed.nameEn,
    kind: seed.kind,
    category: seed.category,
    source: seed.source,
    taxTreatment: seed.taxTreatment ?? ("taxable" as const),
    exemptCap: seed.exemptCap ?? null,
    subjectToInsurance: seed.subjectToInsurance ?? false,
    proration: seed.proration ?? ("fixed" as const),
    roundingRule: "half_up",
    formula: null,
    sortOrder: (index + 1) * 10,
    validFrom: PAY_COMPONENT_SEED_VALID_FROM,
    status: "approved" as const,
    note: seed.note ?? "Danh mục khởi tạo — kế toán trưởng rà soát thuộc tính thuế và bảo hiểm.",
  }));
