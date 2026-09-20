import { describe, expect, it } from "vitest";
import { toCsv } from "./csv";

describe("toCsv", () => {
  const columns = [
    { header: "Họ và tên", value: (row: { name: string; note: string | null; amount: number }) => row.name },
    { header: "Ghi chú", value: (row: { name: string; note: string | null; amount: number }) => row.note },
    { header: "Số", value: (row: { name: string; note: string | null; amount: number }) => row.amount },
  ];
  it("writes a BOM, CRLF lines and quotes what needs quoting", () => {
    expect(toCsv(columns, [{ name: 'Trần "Bo" An', note: "a, b; c\nd", amount: 12 }])).toBe('﻿Họ và tên,Ghi chú,Số\r\n"Trần ""Bo"" An","a, b; c\nd",12\r\n');
  });
  it("defuses cells a spreadsheet would run as formulas, but keeps negative numbers", () => {
    const csv = toCsv(columns, [
      { name: "=HYPERLINK(\"http://evil\")", note: "+84 912 345 678", amount: -5 },
      { name: "@cmd", note: "-2+3", amount: 0 },
    ]);
    const lines = csv.split("\r\n");
    expect(lines[1]).toBe(`"'=HYPERLINK(""http://evil"")",'+84 912 345 678,-5`);
    expect(lines[2]).toBe("'@cmd,'-2+3,0");
  });
  it("writes empty cells for null and undefined", () => {
    expect(toCsv(columns, [{ name: "A", note: null, amount: 1 }]).split("\r\n")[1]).toBe("A,,1");
  });
});
