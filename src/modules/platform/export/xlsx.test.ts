import { crc32 as nodeCrc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { exportFile, toTable } from "./table";
import { columnName, crc32, tableToXlsx, zipStored } from "./xlsx";

const decoder = new TextDecoder();

/** Reads a stored ZIP back through its central directory, checking every entry's CRC. */
function unzip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, string>();
  for (let index = 0; index < count; index++) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const offset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    const start = offset + 30 + view.getUint16(offset + 26, true);
    const data = bytes.subarray(start, start + size);
    expect(nodeCrc32(data)).toBe(crc);
    files.set(name, decoder.decode(data));
    at += 46 + nameLength;
  }
  return files;
}

describe("xlsx", () => {
  it("computes the ZIP checksum the standard way", () => {
    const bytes = new TextEncoder().encode("Nguyễn Văn A, 12.000.000");
    expect(crc32(bytes)).toBe(nodeCrc32(bytes));
  });

  it("names columns as a spreadsheet does", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("stores files a ZIP reader can list and check", () => {
    const files = unzip(
      zipStored([
        { name: "a.txt", data: new TextEncoder().encode("hello") },
        { name: "thư mục/b.xml", data: new Uint8Array() },
      ]),
    );
    expect([...files.entries()]).toEqual([
      ["a.txt", "hello"],
      ["thư mục/b.xml", ""],
    ]);
  });

  it("writes text as text and numbers as numbers, with a bold header", () => {
    const table = toTable(
      [
        { header: "Mã", value: (row: { code: string; name: string; amount: number | null }) => row.code },
        { header: "Họ và tên", value: (row) => row.name },
        { header: "Số tiền", value: (row) => row.amount },
      ],
      [
        { code: "0012", name: '=HYPERLINK("http://evil") & <b>', amount: 12_000_000 },
        { code: "SZM-1", name: "Trần\u0007 An", amount: null },
      ],
    );
    const files = unzip(tableToXlsx(table, "Nhân sự: tháng 10/2026"));
    expect([...files.keys()]).toEqual(["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]);
    const sheet = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Mã</t></is></c>');
    // A leading zero survives; a would-be formula is a string, escaped; a number is a value.
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">0012</t></is></c>');
    expect(sheet).toContain("=HYPERLINK(&quot;http://evil&quot;) &amp; &lt;b&gt;");
    expect(sheet).not.toContain("<f>");
    expect(sheet).toContain('<c r="C2"><v>12000000</v></c>');
    // An empty cell is left out; a control character XML cannot hold is dropped.
    expect(sheet).not.toContain('r="C3"');
    expect(sheet).toContain(">Trần An<");
    expect(files.get("xl/workbook.xml")).toContain('name="Nhân sự  tháng 10 2026"');
  });

  it("cuts a long list to one export's worth and says so", () => {
    const file = exportFile(
      "people",
      [{ header: "n", value: (row: number) => row }],
      Array.from({ length: 5001 }, (_, index) => index),
    );
    expect(file.rowCount).toBe(5000);
    expect(file.truncated).toBe(true);
    expect(file.table.rows.at(-1)).toEqual([4999]);
  });
});
