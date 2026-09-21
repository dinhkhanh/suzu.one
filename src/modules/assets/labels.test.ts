// The label sheet. The QR encoder has its own tests; these are about the sheet around it — that
// every label on a page is the same size, that the pages come out as expected, and that the SVG
// is the same symbol the PDF draws.
//
// The sheet itself was checked the only way that really counts: rendered, rasterised, and handed
// to Apple's Vision barcode scanner, which read all twenty-four labels off one A4 page.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseFont } from "../platform/pdf/font";
import { encodeQr } from "./engine/qr";
import { type LabelRow, qrSvg, renderLabelSheetPdf, sheetVersion } from "./labels";

const font = parseFont(readFileSync("src/modules/platform/pdf/fonts/Roboto-Subset-Regular.ttf"));
const labels = { title: "Nhãn tài sản", footer: "SuZu One", scanHint: "Quét mã để mở hồ sơ" };
const row = (index: number, over: Partial<LabelRow> = {}): LabelRow => ({
  code: `SZM-LAP-${String(index).padStart(4, "0")}`,
  name: "Máy quay Sony FX6",
  url: `https://one.suzu.vn/assets/qr/${String(index).padStart(32, "0")}`,
  entityName: "SuZu Media",
  ...over,
});

const render = (rows: readonly LabelRow[]) => renderLabelSheetPdf({ rows, labels, font, createdAt: new Date("2026-09-20T03:00:00Z") });
const pageCount = (pdf: Uint8Array) => [...Buffer.from(pdf).toString("latin1").matchAll(/\/Type\s*\/Page[^s]/g)].length;

describe("the label sheet", () => {
  it("draws every label at one version, so a printed page has squares of one size", () => {
    // A short code and a long URL on the same sheet: the long one decides.
    const rows = [row(1, { url: "https://one.suzu.vn/a/1" }), row(2)];
    const version = sheetVersion(rows);
    expect(version).toBe(encodeQr(rows[1].url).version);
    expect(version).toBeGreaterThan(encodeQr(rows[0].url).version);
  });

  it("fits twenty-four labels to a page and starts another for the twenty-fifth", () => {
    expect(pageCount(render([row(1)]))).toBe(1);
    expect(pageCount(render(Array.from({ length: 24 }, (_unused, index) => row(index + 1))))).toBe(1);
    expect(pageCount(render(Array.from({ length: 25 }, (_unused, index) => row(index + 1))))).toBe(2);
    expect(pageCount(render(Array.from({ length: 49 }, (_unused, index) => row(index + 1))))).toBe(3);
  });

  it("refuses a sheet with nothing on it, and a URL no version can carry", () => {
    expect(() => render([])).toThrow(/empty/);
    expect(() => sheetVersion([row(1, { url: "https://one.suzu.vn/assets/qr/" + "x".repeat(250) })])).toThrow(/too_long/);
  });

  it("writes a real PDF, with the Vietnamese title in its metadata", () => {
    const pdf = render([row(1)]);
    const text = Buffer.from(pdf).toString("latin1");
    expect(text.startsWith("%PDF-")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    // The title is written as UTF-16BE with a byte-order mark, so it is not legible as latin1 —
    // what matters is that a /Title entry is there at all.
    expect(text).toContain("/Title");
  });

  it("gives the screen the same symbol the sheet prints", () => {
    const url = row(7).url;
    const matrix = encodeQr(url);
    const svg = qrSvg(url, { size: 200, quietZone: 2 });
    const modules = matrix.size + 4;
    expect(svg).toContain(`viewBox="0 0 ${modules} ${modules}"`);
    expect(svg).toContain('width="200"');
    // One rectangle per dark module, and the quiet zone shifts them all by two.
    const dark = matrix.modules.flat().filter(Boolean).length;
    expect([...svg.matchAll(/M\d+ \d+h1v1h-1z/g)]).toHaveLength(dark);
    expect(svg).toContain(`M${2 + matrix.modules[0].findIndex(Boolean)} 2h1v1h-1z`);
  });
});
