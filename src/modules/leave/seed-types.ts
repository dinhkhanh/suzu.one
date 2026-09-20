// Starter leave types and policies, inserted by `pnpm db:seed` when there are none. Data, not
// rules: HR edits them on /leave/admin. The day counts of paid personal leave follow Điều 115 of
// the labour code and sit in the rows (max days per request), like every other limit.
// The annual base (12 days) and the seniority step (5 years) are NOT here: they come from the
// statutory parameter `leave.annual`.
type TypeSeed = {
  code: string;
  name: string;
  nameEn: string;
  category: "annual" | "sick" | "maternity" | "paternity" | "personal_paid" | "unpaid" | "compensatory" | "company";
  payrollTreatment: "paid_company" | "paid_insurance" | "unpaid";
  tracksBalance?: boolean;
  allowHalfDay?: boolean;
  allowHourly?: boolean;
  requiresAttachment?: boolean;
  noticeDays?: number;
  allowBackdated?: boolean;
  maxDaysPerRequestCenti?: number;
  eligibleWorkforceTypes?: string[];
  gender?: "male" | "female";
  isLongTerm?: boolean;
  countsUntrackedDays?: boolean;
  policy?: {
    accrualMethod: "none" | "monthly_accrual" | "yearly_grant";
    baseSource: "statutory_annual" | "fixed";
    fixedDaysCenti?: number;
    seniorityBonus?: boolean;
    prorate?: boolean;
    rounding?: "none" | "half_day" | "full_day";
    probationRule?: "accrue_and_use" | "accrue_no_use" | "no_accrual";
    carryOverCapCenti?: number | null;
    carryOverExpiry?: string | null;
    payoutOnTermination?: boolean;
  };
};

const STAFF = ["employee", "probation", "part_time"];

export const LEAVE_POLICY_SEED_FROM = "2026-01-01";

export const LEAVE_TYPE_SEED: TypeSeed[] = [
  { code: "ANNUAL", name: "Nghỉ phép năm", nameEn: "Annual leave", category: "annual", payrollTreatment: "paid_company", tracksBalance: true, allowHourly: true, noticeDays: 3, eligibleWorkforceTypes: STAFF, policy: { accrualMethod: "monthly_accrual", baseSource: "statutory_annual", seniorityBonus: true, prorate: true, rounding: "half_day", probationRule: "accrue_no_use", carryOverCapCenti: 500, carryOverExpiry: "03-31", payoutOnTermination: true } },
  { code: "SICK", name: "Nghỉ ốm (BHXH chi trả)", nameEn: "Sick leave (paid by social insurance)", category: "sick", payrollTreatment: "paid_insurance", requiresAttachment: true, allowBackdated: true, eligibleWorkforceTypes: STAFF, countsUntrackedDays: true },
  { code: "MATERNITY", name: "Nghỉ thai sản", nameEn: "Maternity leave", category: "maternity", payrollTreatment: "paid_insurance", allowHalfDay: false, requiresAttachment: true, noticeDays: 30, gender: "female", eligibleWorkforceTypes: ["employee", "part_time"], isLongTerm: true, countsUntrackedDays: true },
  { code: "PATERNITY", name: "Nghỉ khi vợ sinh con", nameEn: "Paternity leave", category: "paternity", payrollTreatment: "paid_insurance", allowHalfDay: false, requiresAttachment: true, allowBackdated: true, maxDaysPerRequestCenti: 1400, gender: "male", eligibleWorkforceTypes: ["employee", "part_time"], countsUntrackedDays: true },
  { code: "MARRIAGE", name: "Nghỉ kết hôn (bản thân)", nameEn: "Own marriage", category: "personal_paid", payrollTreatment: "paid_company", allowHalfDay: false, noticeDays: 7, maxDaysPerRequestCenti: 300, eligibleWorkforceTypes: STAFF },
  { code: "CHILD_MARRIAGE", name: "Nghỉ con kết hôn", nameEn: "Child's marriage", category: "personal_paid", payrollTreatment: "paid_company", allowHalfDay: false, noticeDays: 7, maxDaysPerRequestCenti: 100, eligibleWorkforceTypes: STAFF },
  { code: "BEREAVEMENT", name: "Nghỉ tang (cha mẹ, vợ/chồng, con)", nameEn: "Bereavement", category: "personal_paid", payrollTreatment: "paid_company", allowHalfDay: false, allowBackdated: true, maxDaysPerRequestCenti: 300, eligibleWorkforceTypes: STAFF },
  { code: "UNPAID", name: "Nghỉ không lương", nameEn: "Unpaid leave", category: "unpaid", payrollTreatment: "unpaid", noticeDays: 3, countsUntrackedDays: true },
  { code: "SABBATICAL", name: "Nghỉ không lương dài hạn", nameEn: "Unpaid sabbatical", category: "unpaid", payrollTreatment: "unpaid", allowHalfDay: false, noticeDays: 30, eligibleWorkforceTypes: ["employee"], isLongTerm: true, countsUntrackedDays: true },
  { code: "COMP", name: "Nghỉ bù (từ làm thêm giờ)", nameEn: "Time off in lieu", category: "compensatory", payrollTreatment: "paid_company", tracksBalance: true, allowHourly: true, noticeDays: 1, eligibleWorkforceTypes: STAFF, policy: { accrualMethod: "none", baseSource: "fixed", probationRule: "accrue_and_use", carryOverCapCenti: null, carryOverExpiry: "06-30", payoutOnTermination: true } },
  { code: "BIRTHDAY", name: "Nghỉ sinh nhật", nameEn: "Birthday leave", category: "company", payrollTreatment: "paid_company", tracksBalance: true, allowHalfDay: false, noticeDays: 1, eligibleWorkforceTypes: ["employee", "part_time"], policy: { accrualMethod: "yearly_grant", baseSource: "fixed", fixedDaysCenti: 100, prorate: false, rounding: "none", probationRule: "no_accrual", carryOverCapCenti: 0, payoutOnTermination: false } },
];

/** Rows ready for `leave_type` and, per type code, for `leave_policy`. */
export function leaveSeedRows() {
  return LEAVE_TYPE_SEED.map((seed, index) => ({
    type: {
      entityId: null,
      code: seed.code,
      name: seed.name,
      nameEn: seed.nameEn,
      category: seed.category,
      isPaid: seed.payrollTreatment !== "unpaid",
      payrollTreatment: seed.payrollTreatment,
      tracksBalance: seed.tracksBalance ?? false,
      allowHalfDay: seed.allowHalfDay ?? true,
      allowHourly: seed.allowHourly ?? false,
      requiresAttachment: seed.requiresAttachment ?? false,
      noticeDays: seed.noticeDays ?? 0,
      allowBackdated: seed.allowBackdated ?? false,
      maxDaysPerRequestCenti: seed.maxDaysPerRequestCenti ?? null,
      eligibleWorkforceTypes: seed.eligibleWorkforceTypes ?? null,
      gender: seed.gender ?? null,
      isLongTerm: seed.isLongTerm ?? false,
      countsUntrackedDays: seed.countsUntrackedDays ?? false,
      sortOrder: (index + 1) * 10,
    },
    policy: seed.policy
      ? {
          entityId: null,
          validFrom: LEAVE_POLICY_SEED_FROM,
          accrualMethod: seed.policy.accrualMethod,
          baseSource: seed.policy.baseSource,
          fixedDaysCenti: seed.policy.fixedDaysCenti ?? 0,
          seniorityBonus: seed.policy.seniorityBonus ?? false,
          prorate: seed.policy.prorate ?? true,
          rounding: seed.policy.rounding ?? ("half_day" as const),
          probationRule: seed.policy.probationRule ?? ("accrue_no_use" as const),
          carryOverCapCenti: seed.policy.carryOverCapCenti === undefined ? null : seed.policy.carryOverCapCenti,
          carryOverExpiry: seed.policy.carryOverExpiry ?? null,
          payoutOnTermination: seed.policy.payoutOnTermination ?? false,
          note: "Chính sách khởi tạo — HR rà soát lại",
        }
      : null,
  }));
}
