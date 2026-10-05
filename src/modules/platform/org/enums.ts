// Value lists shared by the server and the forms. Plain module: never "use client".

// What a unit is called. A "team" may hold teams and a "department" may hold departments — the
// name is a label for people, not a level (FR-PLT-16); only the two derived placement columns
// (`person.department_id`, `person.team_id`) read it.
export const ORG_UNIT_KINDS = ["department", "team"] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

// The banks the group pays salary from (SRS D12). A key here is the key of payroll's bulk-file
// format for the same bank (FR-PAY-33): a third bank is one more line here and one format module
// there, and a payroll test holds the two lists together.
export const PAYING_BANKS = [
  { key: "vcb", name: "Vietcombank" },
  { key: "acb", name: "ACB" },
] as const;
export type PayingBankKey = (typeof PAYING_BANKS)[number]["key"];
export const PAYING_BANK_KEYS = PAYING_BANKS.map((bank) => bank.key) as [PayingBankKey, ...PayingBankKey[]];
export const payingBankName = (key: string): string => PAYING_BANKS.find((bank) => bank.key === key)?.name ?? key;
