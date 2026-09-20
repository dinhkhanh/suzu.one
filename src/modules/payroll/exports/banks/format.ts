// What a bulk-transfer format is, and the registry of the ones we have (FR-PAY-33).
//
// **Adding a bank is adding one file next to this one and one line in `BANK_FORMATS`.** Nothing
// else in payroll knows the name of a bank: the run asks the registry for a format by key, hands
// it rows, and gets a file back.
//
// A format is a pure function. It never reads the database, never decides who may be paid, and
// never drops anybody: a person whose pay account is missing or malformed comes back in `skipped`
// with a reason, so the accountant sees them and pays them another way rather than discovering the
// gap when someone says their salary has not arrived.
import type { BankAccount } from "@/modules/core-hr/service";

/** One person to be paid, as the run knows them. */
export type TransferRow = {
  personId: string;
  employeeCode: string | null;
  fullName: string;
  /** Integer VND. Always positive — a run never asks a bank to take money back. */
  amount: number;
  account: BankAccount | null;
  /** Free text for the bank's own reference column, e.g. "LUONG T08/2026". */
  narrative: string;
};

export type SkippedRow = { personId: string; fullName: string; employeeCode: string | null; reason: "no_account" | "account_not_numeric" | "account_too_short" | "no_holder" | "zero_amount" | "negative_amount" };

export type TransferFile = {
  fileName: string;
  /** The file's bytes as text; every format here is CSV, written with a BOM and CRLF for Excel. */
  content: string;
  contentType: string;
  rowCount: number;
  /** The sum of the rows written — reconciled against the run before the file is handed over. */
  total: number;
  skipped: SkippedRow[];
};

export type PayingAccount = {
  /** The company account the batch is debited from. */
  accountNumber: string;
  accountName: string;
  /** The branch the account is held at, where the template asks for it. */
  branch?: string | null;
};

export type TransferInput = {
  rows: readonly TransferRow[];
  payingAccount: PayingAccount;
  /** "2026-08" — the month being paid. */
  month: string;
  /** The day the batch should be executed, ISO. */
  valueDate: string;
  entityCode: string;
};

export type BankFormat = {
  /** The key stored on a generated file, and the one the screens post back. */
  key: string;
  /** The bank's name, for the screen. */
  name: string;
  /** Bumped whenever the columns change, so an old file can be told from a new one. */
  version: string;
  build(input: TransferInput): TransferFile;
};

// ── Shared helpers ──────────────────────────────────────────────────────────────────────────

/**
 * Vietnamese text without its diacritics, upper-cased. Bank bulk-payment templates are read by
 * core banking systems that are not reliably Unicode, and a rejected batch on pay day is worse
 * than a name without its accents on a bank statement.
 */
export function toAsciiUpper(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[đĐ]/g, (character) => (character === "đ" ? "d" : "D"))
    .toUpperCase()
    .replace(/[^A-Z0-9 .,\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** A bank account number: digits only here — every Vietnamese bank in scope numbers accounts so. */
export function checkAccount(row: TransferRow): SkippedRow["reason"] | null {
  if (row.amount === 0) return "zero_amount";
  if (row.amount < 0) return "negative_amount";
  if (!row.account?.accountNumber?.trim()) return "no_account";
  const number = row.account.accountNumber.replace(/[\s-]/g, "");
  if (!/^\d+$/.test(number)) return "account_not_numeric";
  if (number.length < 6) return "account_too_short";
  if (!(row.account.accountHolder ?? row.fullName).trim()) return "no_holder";
  return null;
}

export const normalizedAccountNumber = (account: BankAccount): string => account.accountNumber.replace(/[\s-]/g, "");

/** A CSV cell for a bank file: quoted when it has to be, never "neutralised" with an apostrophe. */
export function cell(value: string | number): string {
  const text = String(value);
  return /[",;\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** BOM + CRLF: what Excel in Vietnam opens without being asked twice. */
export const toCsvFile = (rows: string[][]): string => `﻿${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;

/** Splits the rows into the ones a format can write and the ones it must report. */
export function partition(rows: readonly TransferRow[]): { payable: TransferRow[]; skipped: SkippedRow[] } {
  const payable: TransferRow[] = [];
  const skipped: SkippedRow[] = [];
  for (const row of rows) {
    const reason = checkAccount(row);
    if (reason) skipped.push({ personId: row.personId, fullName: row.fullName, employeeCode: row.employeeCode, reason });
    else payable.push(row);
  }
  return { payable, skipped };
}
