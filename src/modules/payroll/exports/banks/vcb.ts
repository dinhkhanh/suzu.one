// Vietcombank (VCB) bulk salary payment — **UNVERIFIED AGAINST THE BANK'S CURRENT TEMPLATE.**
//
// ⚠️ No official VCB specification was available when this was written. The layout below is the
// author's best reconstruction of the VCB DigiBiz / VCB-iB@nking "Chi lương" (salary payment) bulk
// upload, and **every column is an assumption**. Before the first real pay run the chief accountant
// must download the current template from the bank's portal, compare it with the list below, and
// either confirm it or say what differs — one edit to this file is then the whole change.
//
// Assumed columns, in this order (header row in Vietnamese, as the bank's own template is):
//
//  1. STT                  — row number, from 1
//  2. SO TAI KHOAN         — the employee's VCB account number, digits only
//  3. TEN NGUOI HUONG      — the account holder's name, upper case without diacritics
//  4. SO TIEN              — amount in VND, plain integer, no thousands separator
//  5. NOI DUNG             — the narrative shown on the employee's statement
//  6. MA NHAN VIEN         — the employee code, for the company's own reconciliation
//
// Assumed besides the columns:
//  * a single header row, then one row per employee, then **no total row** (the portal totals it);
//  * CSV with a UTF-8 BOM and CRLF line endings (the template is distributed as .xls; CSV is what
//    this can produce offline, and Excel opens it and saves it as .xls in one step);
//  * the debit account, value date and batch name are typed into the portal, not carried in the
//    file — they are written into the file name and reported on screen so they can be typed;
//  * amounts are whole đồng, which is all payroll ever produces.
import { type BankFormat, normalizedAccountNumber, partition, toAsciiUpper, toCsvFile, type TransferFile, type TransferInput } from "./format";

export const VCB_COLUMNS = ["STT", "SO TAI KHOAN", "TEN NGUOI HUONG", "SO TIEN", "NOI DUNG", "MA NHAN VIEN"] as const;

export const vcbFormat: BankFormat = {
  key: "vcb",
  name: "Vietcombank",
  version: "vcb-salary-csv-1",

  build(input: TransferInput): TransferFile {
    const { payable, skipped } = partition(input.rows);
    const rows: string[][] = [[...VCB_COLUMNS]];
    let total = 0;

    payable.forEach((row, index) => {
      total += row.amount;
      rows.push([
        String(index + 1),
        normalizedAccountNumber(row.account!),
        toAsciiUpper(row.account!.accountHolder ?? row.fullName),
        String(row.amount),
        toAsciiUpper(row.narrative),
        row.employeeCode ?? "",
      ]);
    });

    return {
      fileName: `VCB_${input.entityCode}_${input.month}_${input.valueDate}.csv`,
      content: toCsvFile(rows),
      contentType: "text/csv; charset=utf-8",
      rowCount: payable.length,
      total,
      skipped,
    };
  },
};
