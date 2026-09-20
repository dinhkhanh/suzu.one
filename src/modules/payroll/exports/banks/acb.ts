// ACB (Asia Commercial Bank) bulk salary payment — **UNVERIFIED AGAINST THE BANK'S CURRENT
// TEMPLATE.**
//
// ⚠️ No official ACB specification was available when this was written. The layout below is the
// author's best reconstruction of the ACB ONE BIZ bulk transfer ("Chuyển khoản theo lô" / salary)
// upload, and **every column is an assumption**. Before the first real pay run the chief accountant
// must download the current template from the bank's portal and confirm or correct this list.
//
// ACB's template is assumed to differ from Vietcombank's in three ways, which is the reason this is
// a separate file rather than a parameter of one:
//   * it carries the **beneficiary bank** on each row, because a batch may pay staff who bank
//     elsewhere through the interbank system (napas);
//   * it separates the transfer **fee payer** per row;
//   * it ends with a **total row**, which the portal reconciles against the batch it computes.
//
// Assumed columns, in this order:
//
//  1. STT                  — row number, from 1
//  2. TAI KHOAN THU HUONG  — the beneficiary's account number, digits only
//  3. TEN THU HUONG        — the account holder's name, upper case without diacritics
//  4. NGAN HANG THU HUONG  — the beneficiary's bank; "ACB" for an in-house account
//  5. SO TIEN              — amount in VND, plain integer
//  6. LOAI PHI             — who pays the transfer fee; "OUR" = the company does
//  7. NOI DUNG CHUYEN KHOAN — the narrative
//  8. MA NHAN VIEN         — the employee code, for the company's own reconciliation
//
// Assumed besides the columns:
//  * a header row, one row per employee, then a final row reading `TONG CONG` with the count in
//    the account column and the total in the amount column;
//  * CSV with a UTF-8 BOM and CRLF line endings (see the note in `vcb.ts`);
//  * the debit account and value date are typed into the portal; they go in the file name;
//  * the fee is paid by the company for every salary row ("OUR"), which is what a salary batch
//    normally does — if ACB expects "SHA" or a Vietnamese word here, this is the line to change.
import { type BankFormat, normalizedAccountNumber, partition, toAsciiUpper, toCsvFile, type TransferFile, type TransferInput } from "./format";

export const ACB_COLUMNS = ["STT", "TAI KHOAN THU HUONG", "TEN THU HUONG", "NGAN HANG THU HUONG", "SO TIEN", "LOAI PHI", "NOI DUNG CHUYEN KHOAN", "MA NHAN VIEN"] as const;

/** Who pays the transfer fee. The company does, for salary. */
const FEE_PAYER = "OUR";
const TOTAL_LABEL = "TONG CONG";

export const acbFormat: BankFormat = {
  key: "acb",
  name: "ACB",
  version: "acb-bulk-csv-1",

  build(input: TransferInput): TransferFile {
    const { payable, skipped } = partition(input.rows);
    const rows: string[][] = [[...ACB_COLUMNS]];
    let total = 0;

    payable.forEach((row, index) => {
      total += row.amount;
      rows.push([
        String(index + 1),
        normalizedAccountNumber(row.account!),
        toAsciiUpper(row.account!.accountHolder ?? row.fullName),
        toAsciiUpper(row.account!.bankName || "ACB"),
        String(row.amount),
        FEE_PAYER,
        toAsciiUpper(row.narrative),
        row.employeeCode ?? "",
      ]);
    });

    // The portal checks its own total against this line; a mismatch stops the batch at the bank
    // rather than after the money has moved.
    rows.push([TOTAL_LABEL, String(payable.length), "", "", String(total), "", "", ""]);

    return {
      fileName: `ACB_${input.entityCode}_${input.month}_${input.valueDate}.csv`,
      content: toCsvFile(rows),
      contentType: "text/csv; charset=utf-8",
      rowCount: payable.length,
      total,
      skipped,
    };
  },
};
