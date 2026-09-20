// The PDF writer and the TrueType reader behind it. Pure code, so these are plain unit tests —
// but they check the things that would silently produce an unreadable file: the glyph lookup for
// Vietnamese, the widths, and the structure a reader needs to open the document at all.
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { glyphsOf, parseFont, truncateToWidth, widthOfText } from "./font";
import { A4, Page, renderPdf } from "./writer";

const font = parseFont(readFileSync("src/modules/platform/pdf/fonts/Roboto-Subset-Regular.ttf"));
const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

describe("reading the font", () => {
  it("reads the head, hhea and maxp tables", () => {
    expect(font.unitsPerEm).toBe(2048);
    expect(font.numGlyphs).toBeGreaterThan(700);
    expect(font.ascender).toBeGreaterThan(0);
    expect(font.descender).toBeLessThan(0);
  });

  it("finds a glyph for every character a Vietnamese payslip uses", () => {
    // The whole alphabet's worth of diacritics, the đồng sign, and the letters only Vietnamese has.
    const text = "Phiếu lương tháng 08/2026 — Nguyễn Thị Hằng · Đặng Vũ Ưu · 12.345.678 ₫ (BHXH, BHYT, BHTN)";
    for (const character of text) {
      expect(font.glyphOf(character.codePointAt(0)!), `no glyph for ${character} (U+${character.codePointAt(0)!.toString(16)})`).toBeGreaterThan(0);
    }
  });

  it("answers 0 for a character outside the subset, rather than throwing", () => {
    expect(font.glyphOf("漢".codePointAt(0)!)).toBe(0);
    expect(font.glyphOf(0x1f600)).toBe(0);
    expect(glyphsOf(font, "a漢")).toEqual([font.glyphOf(0x61), 0]);
  });

  it("measures text, and a wider string is wider", () => {
    expect(widthOfText(font, "", 9)).toBe(0);
    expect(widthOfText(font, "12.345.678 ₫", 9)).toBeGreaterThan(0);
    expect(widthOfText(font, "iiii", 9)).toBeLessThan(widthOfText(font, "MMMM", 9));
    // Twice the size is twice the width.
    expect(widthOfText(font, "Nguyễn", 18)).toBeCloseTo(widthOfText(font, "Nguyễn", 9) * 2, 5);
  });

  it("truncates to a width and marks what it dropped", () => {
    const long = "Công ty Trách nhiệm hữu hạn Truyền thông Suzu Media Việt Nam";
    const cut = truncateToWidth(font, long, 9, 80);
    expect(cut.endsWith("…")).toBe(true);
    expect(widthOfText(font, cut, 9)).toBeLessThanOrEqual(80);
    // What already fits is left exactly alone.
    expect(truncateToWidth(font, "ngắn", 9, 200)).toBe("ngắn");
  });
});

describe("writing a document", () => {
  const build = () => {
    const page = new Page(A4, font);
    page.text("Phiếu lương tháng 08/2026", 48, 760, { size: 14, bold: true });
    page.textRight("12.345.678 đ", 547, 700);
    page.line(48, 690, 547, 690);
    page.rectangle(48, 640, 499, 24);
    return renderPdf([page], font, { title: "Phiếu lương — Nguyễn Thị Hằng", author: "Suzu Media", createdAt: new Date("2026-09-05T10:00:00Z") });
  };

  it("produces a file a reader can open: header, xref, trailer and EOF", () => {
    const text = latin1(build());
    expect(text.startsWith("%PDF-1.7")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("/Type /Catalog");
    expect(text).toContain("/Type /Pages");
    expect(text).toContain("trailer");

    // The offset in `startxref` must really be where the xref table begins, or nothing opens.
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("every object the xref table points at really starts there", () => {
    const bytes = build();
    const text = latin1(bytes);
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    const table = text.slice(startxref).split("\n");
    const size = Number(table[1].split(" ")[1]);
    for (let id = 1; id < size; id++) {
      const entry = table[2 + id];
      if (!entry || entry.endsWith("f ")) continue;
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset).startsWith(`${id} 0 obj`), `object ${id} is not at ${offset}`).toBe(true);
    }
  });

  it("embeds the font whole, as a deflated stream of the right length", () => {
    const bytes = build();
    const text = latin1(bytes);
    expect(text).toContain(`/Length1 ${font.bytes.length}`);
    expect(text).toContain("/FontFile2 5 0 R");
    expect(text).toContain("/Subtype /CIDFontType2");
    expect(text).toContain("/Encoding /Identity-H");
    expect(text).toContain("/CIDToGIDMap /Identity");

    // Pull object 5's stream out and inflate it: it must be the font file, byte for byte.
    const at = text.indexOf("5 0 obj");
    const start = text.indexOf("stream\n", at) + "stream\n".length;
    const length = Number(text.slice(at, start).match(/\/Length (\d+)/)![1]);
    expect(Buffer.compare(inflateSync(bytes.slice(start, start + length)), Buffer.from(font.bytes))).toBe(0);
  });

  it("writes the text as glyph ids and maps them back for copy and search", () => {
    const bytes = build();
    const text = latin1(bytes);
    // The content stream is deflated, so the drawn text is never literally in the file …
    expect(text).not.toContain("Phiếu");
    const at = text.indexOf("10 0 obj");
    const start = text.indexOf("stream\n", at) + "stream\n".length;
    const length = Number(text.slice(at, start).match(/\/Length (\d+)/)![1]);
    const content = inflateSync(bytes.slice(start, start + length)).toString("latin1");
    // … it is there as the glyph ids of "Phiếu lương tháng 08/2026".
    const expected = glyphsOf(font, "Phiếu lương tháng 08/2026")
      .map((glyph) => glyph.toString(16).padStart(4, "0"))
      .join("");
    expect(content).toContain(`<${expected}> Tj`);

    // And the ToUnicode map carries each of those glyphs back to its character.
    const cmapAt = text.indexOf("6 0 obj");
    const cmapStart = text.indexOf("stream\n", cmapAt) + "stream\n".length;
    const cmapLength = Number(text.slice(cmapAt, cmapStart).match(/\/Length (\d+)/)![1]);
    const cmap = inflateSync(bytes.slice(cmapStart, cmapStart + cmapLength)).toString("utf8");
    expect(cmap).toContain("beginbfchar");
    const e = "ế".codePointAt(0)!;
    expect(cmap).toContain(`<${font.glyphOf(e).toString(16).padStart(4, "0")}> <${e.toString(16).padStart(4, "0")}>`);
  });

  it("gives a width for every glyph it drew", () => {
    const text = latin1(build());
    const widths = text.match(/\/W \[(.*?)\] \/CIDToGIDMap/s)![1];
    for (const glyph of glyphsOf(font, "Phiếu lương")) {
      // Each glyph falls inside one of the `first [w w w]` runs.
      const runs = [...widths.matchAll(/(\d+) \[([\d ]+)\]/g)];
      const covered = runs.some((run) => glyph >= Number(run[1]) && glyph < Number(run[1]) + run[2].trim().split(/\s+/).length);
      expect(covered, `glyph ${glyph} has no width`).toBe(true);
    }
  });

  it("writes a title that carries its diacritics (UTF-16, not Latin-1)", () => {
    const text = latin1(build());
    const title = text.match(/\/Title <([0-9a-f]+)>/)![1];
    expect(title.startsWith("feff")).toBe(true);
    // "ễ" survives the round trip.
    expect(title).toContain("ễ".codePointAt(0)!.toString(16).padStart(4, "0"));
  });

  it("refuses to write a document with no pages", () => {
    expect(() => renderPdf([], font, { title: "x" })).toThrow(/at least one page/);
  });

  it("stays small: the font is the bulk of it, and it is only embedded once", () => {
    const one = build().length;
    const many = renderPdf(
      Array.from({ length: 5 }, () => {
        const page = new Page(A4, font);
        page.text("Phiếu lương", 48, 760);
        return page;
      }),
      font,
      { title: "five" },
    ).length;
    expect(one).toBeLessThan(60_000);
    // Four more pages cost a few hundred bytes, not another font.
    expect(many - one).toBeLessThan(5_000);
  });
});
