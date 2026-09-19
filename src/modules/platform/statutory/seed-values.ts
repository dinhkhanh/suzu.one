// SRS Appendix A: a snapshot gathered 2026-09-19 from public sources. Seeded as approved but
// *unverified*; the chief accountant confirms each value before payroll relies on it.
import type { ParameterKey, ParameterValue } from "./catalogue";

type Seed = { [Key in ParameterKey]: { key: Key; validFrom: string; value: ParameterValue<Key>; legalReference: string; note?: string } }[ParameterKey];

export const STATUTORY_SEED: Seed[] = [
  { key: "insurance.employee_rates", validFrom: "2026-01-01", value: { bhxh: 800, bhyt: 150, bhtn: 100 }, legalReference: "Luật BHXH 2024; Luật BHYT; Luật Việc làm" },
  { key: "insurance.employer_rates", validFrom: "2026-01-01", value: { bhxh: 1750, bhyt: 300, bhtn: 100 }, legalReference: "Luật BHXH 2024; Luật BHYT; Luật Việc làm", note: "BHXH 17.5% includes the occupational accident and disease fund." },
  { key: "insurance.reference_level", validFrom: "2026-07-01", value: { amount: 2_530_000 }, legalReference: "Verify the decree", note: "Reported as 2,530,000 from 2026-07-01 (previously 2,340,000)." },
  { key: "insurance.cap_multipliers", validFrom: "2026-01-01", value: { bhxhBhyt: 20, bhtn: 20 }, legalReference: "Luật BHXH 2024; Luật Việc làm" },
  { key: "union.rates", validFrom: "2026-01-01", value: { employerFund: 200, memberDues: 100 }, legalReference: "Luật Công đoàn", note: "Member dues are capped; applies if the entity has a union." },
  { key: "wage.regional_minimum", validFrom: "2026-01-01", value: { region1: 5_310_000, region2: 4_730_000, region3: 4_140_000, region4: 3_700_000 }, legalReference: "Verify the decree and each entity's region" },
  { key: "pit.deductions", validFrom: "2026-01-01", value: { personal: 15_500_000, dependent: 6_200_000 }, legalReference: "Applies from tax period 2026" },
  {
    key: "pit.brackets",
    validFrom: "2026-01-01",
    value: [
      { upTo: 10_000_000, rate: 500 },
      { upTo: 30_000_000, rate: 1000 },
      { upTo: 60_000_000, rate: 2000 },
      { upTo: 100_000_000, rate: 3000 },
      { upTo: null, rate: 3500 },
    ],
    legalReference: "Luật Thuế TNCN sửa đổi 109/2025/QH15",
    note: "Five brackets. Confirm the application date for salary income and the transition rules.",
  },
  { key: "pit.flat_rates", validFrom: "2026-01-01", value: { nonResident: 2000, withoutContract: 1000, withoutContractThreshold: 2_000_000 }, legalReference: "Luật Thuế TNCN", note: "Verify the current per-payment threshold for the 10% withholding." },
  { key: "overtime.multipliers", validFrom: "2021-01-01", value: { weekday: 150, restDay: 200, holiday: 300, nightPremium: 30, nightOvertimeExtra: 20 }, legalReference: "Bộ luật Lao động 2019, Điều 98" },
  { key: "overtime.caps", validFrom: "2021-01-01", value: { monthlyHours: 40, yearlyHours: 200, yearlyHoursExtended: 300 }, legalReference: "Bộ luật Lao động 2019, Điều 107" },
  { key: "leave.annual", validFrom: "2021-01-01", value: { baseDays: 12, yearsOfServicePerExtraDay: 5 }, legalReference: "Bộ luật Lao động 2019, Điều 113–114" },
  { key: "probation.limits", validFrom: "2021-01-01", value: { managerDays: 180, professionalDays: 60, intermediateDays: 30, otherDays: 6, minimumPayPercent: 85 }, legalReference: "Bộ luật Lao động 2019, Điều 25–26" },
  { key: "contract.fixed_term", validFrom: "2021-01-01", value: { maxMonths: 36, maxFixedTermRenewals: 1 }, legalReference: "Bộ luật Lao động 2019, Điều 20" },
  { key: "hr.alert_thresholds", validFrom: "2021-01-01", value: { contractExpiryDays: [45, 30, 15], probationEndDays: [10, 3], documentExpiryDays: [30] }, legalReference: "SRS FR-CHR-05 (company practice, not law)", note: "Probation results must be announced before the period ends (Điều 27)." },
];
