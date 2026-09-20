// The bulk-transfer formats (FR-PAY-33). Pure functions, so these are plain unit tests — and the
// things they check are the ones that would go wrong quietly: a name with diacritics reaching a
// bank that cannot read them, an account the format should have refused, a total that does not
// match the run, and somebody dropped from the file without a word.
import { describe, expect, it } from "vitest";
import { acbFormat, ACB_COLUMNS } from "./acb";
import { bankFormat, BANK_FORMATS, BANK_KEYS } from "./index";
import { checkAccount, toAsciiUpper, type TransferInput, type TransferRow } from "./format";
import { vcbFormat, VCB_COLUMNS } from "./vcb";

const account = (over: Partial<NonNullable<TransferRow["account"]>> = {}) => ({ bankName: "VCB", accountNumber: "0123456789", accountHolder: "NGUYEN VAN A", branch: null, ...over });

const row = (over: Partial<TransferRow> = {}): TransferRow => ({
  personId: crypto.randomUUID(),
  employeeCode: "SZM-0001",
  fullName: "Nguyễn Văn A",
  amount: 12_345_678,
  account: account(),
  narrative: "LUONG T08/2026 SZM",
  ...over,
});

const input = (rows: TransferRow[]): TransferInput => ({
  rows,
  payingAccount: { accountNumber: "0071000123456", accountName: "CONG TY TNHH SUZU MEDIA" },
  month: "2026-08",
  valueDate: "2026-09-05",
  entityCode: "SZM",
});

/** The body rows of a produced CSV, without the BOM and the header. */
const body = (content: string) => content.replace(/^﻿/, "").trim().split("\r\n").slice(1);

describe("the registry", () => {
  it("has the two banks the company uses, each answering to its own key", () => {
    expect(BANK_KEYS.sort()).toEqual(["acb", "vcb"]);
    expect(bankFormat("vcb")?.name).toBe("Vietcombank");
    expect(bankFormat("acb")?.name).toBe("ACB");
    expect(bankFormat("techcombank")).toBeNull();
  });

  it("gives every format a version, so a file made last month can be told from this month's", () => {
    for (const format of Object.values(BANK_FORMATS)) {
      expect(format.version).toMatch(/^[a-z0-9-]+$/);
      expect(format.key).toMatch(/^[a-z]+$/);
    }
  });
});

describe("stripping a name down for a bank", () => {
  it("drops the diacritics and upper-cases, đ included", () => {
    expect(toAsciiUpper("Nguyễn Thị Hằng")).toBe("NGUYEN THI HANG");
    expect(toAsciiUpper("Đặng Vũ Ưu")).toBe("DANG VU UU");
    expect(toAsciiUpper("Trần Đức Đạt")).toBe("TRAN DUC DAT");
  });

  it("keeps what a bank narrative needs and throws away the rest", () => {
    expect(toAsciiUpper("LUONG T08/2026 - SZM")).toBe("LUONG T08/2026 - SZM");
    expect(toAsciiUpper("Lương  tháng   8")).toBe("LUONG THANG 8");
    expect(toAsciiUpper("a*b#c")).toBe("A B C");
  });
});

describe("refusing an account rather than guessing", () => {
  it("names the reason for every kind of bad row", () => {
    expect(checkAccount(row())).toBeNull();
    expect(checkAccount(row({ account: null }))).toBe("no_account");
    expect(checkAccount(row({ account: account({ accountNumber: "  " }) }))).toBe("no_account");
    expect(checkAccount(row({ account: account({ accountNumber: "VCB-12345678" }) }))).toBe("account_not_numeric");
    expect(checkAccount(row({ account: account({ accountNumber: "12345" }) }))).toBe("account_too_short");
    expect(checkAccount(row({ amount: 0 }))).toBe("zero_amount");
    expect(checkAccount(row({ amount: -1 }))).toBe("negative_amount");
  });

  it("accepts an account written with spaces or dashes and normalises it", () => {
    expect(checkAccount(row({ account: account({ accountNumber: "0123 4567 89" }) }))).toBeNull();
    const file = vcbFormat.build(input([row({ account: account({ accountNumber: "0123 4567 89" }) })]));
    expect(body(file.content)[0].split(",")[1]).toBe("0123456789");
  });
});

describe.each([
  ["VCB", vcbFormat, VCB_COLUMNS],
  ["ACB", acbFormat, ACB_COLUMNS],
])("%s", (_name, format, columns) => {
  it("writes the assumed header, in order", () => {
    const file = format.build(input([row()]));
    expect(file.content.replace(/^﻿/, "").split("\r\n")[0]).toBe(columns.join(","));
  });

  it("starts with a BOM and uses CRLF, so Excel in Vietnam opens it as it is", () => {
    const file = format.build(input([row()]));
    expect(file.content.startsWith("﻿")).toBe(true);
    expect(file.content).toContain("\r\n");
  });

  it("writes the amount as a plain integer with no separators", () => {
    const file = format.build(input([row({ amount: 12_345_678 })]));
    expect(file.content).toContain("12345678");
    expect(file.content).not.toContain("12.345.678");
    expect(file.content).not.toContain("12,345,678");
  });

  it("numbers the rows from 1 and names the file after the entity, month and value date", () => {
    const file = format.build(input([row(), row({ employeeCode: "SZM-0002" })]));
    expect(body(file.content)[0].startsWith("1,")).toBe(true);
    expect(body(file.content)[1].startsWith("2,")).toBe(true);
    expect(file.fileName).toContain("SZM");
    expect(file.fileName).toContain("2026-08");
    expect(file.fileName).toContain("2026-09-05");
  });

  it("reports everyone it could not write, and writes nobody it reported", () => {
    const good = row({ employeeCode: "OK" });
    const bad = row({ employeeCode: "BAD", fullName: "Trần Thị B", account: null });
    const file = format.build(input([good, bad]));
    expect(file.rowCount).toBe(1);
    expect(file.skipped).toHaveLength(1);
    expect(file.skipped[0]).toMatchObject({ fullName: "Trần Thị B", reason: "no_account" });
    expect(file.content).not.toContain("TRAN THI B");
    // The skipped person's money is not in the total either.
    expect(file.total).toBe(good.amount);
  });

  it("totals exactly what it wrote — the figure the run is reconciled against", () => {
    const rows = [row({ amount: 10_000_000 }), row({ amount: 7_500_500 }), row({ amount: 3_000_000, account: null })];
    const file = format.build(input(rows));
    expect(file.total).toBe(17_500_500);
    expect(file.rowCount).toBe(2);
    // And the amounts in the file add up to the same thing.
    const amountColumn = columns.indexOf("SO TIEN" as never);
    const written = body(file.content)
      .filter((line) => /^\d+,/.test(line))
      .reduce((sum, line) => sum + Number(line.split(",")[amountColumn]), 0);
    expect(written).toBe(file.total);
  });

  it("carries no diacritics at all into the file", () => {
    const file = format.build(input([row({ fullName: "Lê Thị Ngọc Ánh", account: account({ accountHolder: "Lê Thị Ngọc Ánh" }), narrative: "Lương tháng 8" })]));
    expect(file.content.replace(/^﻿/, "")).toMatch(/^[\x20-\x7e\r\n,"]*$/);
    expect(file.content).toContain("LE THI NGOC ANH");
  });

  it("produces an empty batch without falling over", () => {
    const file = format.build(input([]));
    expect(file.rowCount).toBe(0);
    expect(file.total).toBe(0);
  });
});

describe("what makes the two formats different", () => {
  it("ACB carries the beneficiary's bank and a fee payer; VCB does not", () => {
    const rows = [row({ account: account({ bankName: "Techcombank" }) })];
    const acb = body(acbFormat.build(input(rows)).content)[0].split(",");
    expect(acb[3]).toBe("TECHCOMBANK");
    expect(acb[5]).toBe("OUR");
    expect(VCB_COLUMNS).not.toContain("NGAN HANG THU HUONG" as never);
  });

  it("ACB ends with a total row the portal reconciles against; VCB has none", () => {
    const rows = [row({ amount: 1_000_000 }), row({ amount: 2_000_000 })];
    const acb = body(acbFormat.build(input(rows)).content);
    expect(acb.at(-1)).toBe("TONG CONG,2,,,3000000,,,");
    expect(body(vcbFormat.build(input(rows)).content).at(-1)!.startsWith("2,")).toBe(true);
  });

  it("a comma in a name is quoted, not left to split the row", () => {
    const file = vcbFormat.build(input([row({ account: account({ accountHolder: "NGUYEN VAN A, JR" }) })]));
    expect(file.content).toContain('"NGUYEN VAN A, JR"');
    expect(body(file.content)[0].split(",").length).toBeGreaterThan(VCB_COLUMNS.length - 1);
  });
});
