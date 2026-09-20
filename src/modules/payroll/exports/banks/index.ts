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

export { checkAccount } from "./format";
export type { BankFormat, PayingAccount, SkippedRow, TransferFile, TransferInput, TransferRow } from "./format";
