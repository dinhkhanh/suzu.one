// The bank formats payroll can write (FR-PAY-33). One line per bank — adding a third is adding a
// file beside this one and an entry here; nothing else in payroll mentions a bank by name.
//
// Both formats are reconstructions and are marked **unverified against the bank's current
// template** in their own files; the screens repeat that warning to the accountant.
import { acbFormat } from "./acb";
import type { BankFormat } from "./format";
import { vcbFormat } from "./vcb";

export const BANK_FORMATS: Record<string, BankFormat> = { [vcbFormat.key]: vcbFormat, [acbFormat.key]: acbFormat };

export const BANK_KEYS = Object.keys(BANK_FORMATS);

export const bankFormat = (key: string): BankFormat | null => BANK_FORMATS[key] ?? null;

/**
 * The format whose bank this is, read off the bank name typed on a person's pay account — or null
 * when it is none of ours. Each format lists how its bank is written (`aliases`).
 */
export function formatOfBankName(bankName: string | null | undefined): BankFormat | null {
  const name = (bankName ?? "").toLowerCase();
  if (!name.trim()) return null;
  return Object.values(BANK_FORMATS).find((format) => format.aliases.some((alias) => name.includes(alias))) ?? null;
}

/**
 * The format that carries people who bank elsewhere: the first in the registry whose layout has a
 * beneficiary-bank column. null = no file can pay another bank's account.
 */
export const interbankFormat = (): BankFormat | null => Object.values(BANK_FORMATS).find((format) => format.interbank) ?? null;

export { checkAccount } from "./format";
export type { BankFormat, PayingAccount, SkippedRow, TransferFile, TransferInput, TransferRow } from "./format";
