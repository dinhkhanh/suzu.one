import { describe, expect, it } from "vitest";
import { code, type Column, day, email, integer, oneOf, parseCsv, parseTable, templateCsv, text } from "./table";

const columns = {
  fullName: { headers: ["Họ và tên", "Full name"], required: true, parse: text(120), example: "Nguyễn Văn A" } as Column<string>,
  startDate: { headers: ["Ngày vào làm", "Start date"], required: true, parse: day, example: "01/03/2026" } as Column<string>,
  workEmail: { headers: ["Email công ty", "Work email"], parse: email } as Column<string>,
  salary: { headers: ["Lương"], parse: integer } as Column<number>,
  type: { headers: ["Loại"], parse: oneOf({ employee: ["Chính thức"], intern: ["Thực tập"] }) } as Column<"employee" | "intern">,
};

describe("parseTable", () => {
  it("matches headers without accents, case or spacing, in any order, and types every cell", () => {
    const { rows, problems } = parseTable(
      [
        ["EMAIL CONG TY", " ho va ten ", "Ngày vào làm", "Lương", "Loại"],
        ["Dat@SuZu.vn", "Nguyễn  Văn Đạt", new Date("2026-03-01T00:00:00Z"), "12.500.000", "chinh thuc"],
        [null, null, "", null, null],
        ["", "Trần Thị B", "5/3/2026", 9000000, "Thực tập"],
      ],
      columns,
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { row: 2, values: { fullName: "Nguyễn Văn Đạt", startDate: "2026-03-01", workEmail: "dat@suzu.vn", salary: 12_500_000, type: "employee" } },
      { row: 4, values: { fullName: "Trần Thị B", startDate: "2026-03-05", workEmail: null, salary: 9_000_000, type: "intern" } },
    ]);
  });

  it("reports every problem with the row and column people see in their spreadsheet", () => {
    const { problems } = parseTable(
      [
        ["Họ và tên", "Ngày vào làm", "Email công ty", "Lương", "Loại", "Ghi chú"],
        ["", "31/02/2026", "not-an-email", "12,5", "sếp", "x"],
      ],
      columns,
    );
    expect(problems).toEqual([
      { row: 1, column: "Ghi chú", code: "column_unknown" },
      { row: 2, column: "Họ và tên", code: "required" },
      { row: 2, column: "Ngày vào làm", code: "bad_date" },
      { row: 2, column: "Email công ty", code: "bad_email" },
      { row: 2, column: "Lương", code: "bad_number" },
      { row: 2, column: "Loại", code: "bad_choice" },
    ]);
  });

  it("stops at once when a required column is missing, and says so for an empty sheet", () => {
    expect(parseTable([["Họ và tên"], ["A"]], columns)).toEqual({ rows: [], problems: [{ row: 1, column: "Ngày vào làm", code: "column_missing" }] });
    expect(parseTable([["Họ và tên", "Ngày vào làm"]], columns).problems).toEqual([{ row: 1, column: null, code: "no_rows" }]);
    expect(parseTable([], columns).problems.map((problem) => problem.code)).toEqual(["column_missing", "column_missing"]);
  });
});

describe("cell parsers", () => {
  it("reads amounts the way they are typed, and refuses decimals", () => {
    expect(integer("12.500.000")).toEqual({ ok: true, value: 12_500_000 });
    expect(integer("12,500,000")).toEqual({ ok: true, value: 12_500_000 });
    expect(integer("1500")).toEqual({ ok: true, value: 1500 });
    expect(integer("12.5")).toEqual({ ok: false, code: "bad_number" });
  });

  it("reads Vietnamese and ISO dates and refuses impossible ones", () => {
    expect(day("1/3/2026")).toEqual({ ok: true, value: "2026-03-01" });
    expect(day("2026-12-31")).toEqual({ ok: true, value: "2026-12-31" });
    expect(day("29/02/2027")).toEqual({ ok: false, code: "bad_date" });
    expect(day("March 1")).toEqual({ ok: false, code: "bad_date" });
  });

  it("normalises codes and refuses odd characters", () => {
    expect(code(12)("des-01")).toEqual({ ok: true, value: "DES-01" });
    expect(code(12)("thiết kế")).toEqual({ ok: false, code: "bad_code" });
  });
});

describe("csv", () => {
  it("handles a BOM, quotes, embedded newlines and Excel's semicolons", () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""","line1\nline2"\r\n')).toEqual([["a", "b"], ['x, "y"', "line1\nline2"]]);
    expect(parseCsv("a;b\n1,5;2")).toEqual([["a", "b"], ["1,5", "2"]]);
  });

  it("round-trips its own template", () => {
    const template = templateCsv(columns);
    expect(template.startsWith("﻿Họ và tên,Ngày vào làm")).toBe(true);
    expect(parseTable(parseCsv(template), columns).rows[0].values).toMatchObject({ fullName: "Nguyễn Văn A", startDate: "2026-03-01" });
  });
});
