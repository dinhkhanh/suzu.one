// Value lists shared by the server and the forms. Plain module (a "use client" file's constants
// are client references on the server).
export const WORKFORCE_TYPES = ["employee", "probation", "intern", "part_time", "collaborator", "advisor"] as const;
export const LEAVE_CATEGORIES = ["annual", "sick", "maternity", "paternity", "personal_paid", "unpaid", "compensatory", "company"] as const;
export const PAYROLL_TREATMENTS = ["paid_company", "paid_insurance", "unpaid"] as const;
export const ACCRUAL_METHODS = ["none", "monthly_accrual", "yearly_grant"] as const;
export const BASE_SOURCES = ["statutory_annual", "fixed"] as const;
export const ROUNDINGS = ["none", "half_day", "full_day"] as const;
export const PROBATION_RULES = ["accrue_and_use", "accrue_no_use", "no_accrual"] as const;
export const PORTIONS = ["full", "am", "pm", "hours"] as const;

/** 150 → "1.5"; the screens localize the decimal mark. */
export const centiToDays = (centi: number): number => centi / 100;
