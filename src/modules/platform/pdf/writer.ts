// A small PDF writer: enough to lay out a payslip, and nothing more. Pure — it takes text and a
// parsed font and returns the bytes of a document.
//
// Why write one instead of taking a library: the two things a payslip needs — Vietnamese text and
// a few tables of right-aligned numbers — are the two things a PDF library mostly charges a large
// dependency for. Everything below is the PDF 1.7 spec's own furniture:
//
//   * the file is a list of numbered objects, then a table saying where each one starts (`xref`),
//     then a trailer pointing at the catalogue;
//   * a page's marks are a content stream: `BT … ET` around text, `Tf` to pick a font and size,
//     `Td` to move, `Tj` to draw, `re f` to fill a rectangle;
//   * the font is embedded as a CIDFontType2 with `Identity-H` encoding, which means the strings
//     in the content stream are **glyph ids**, two bytes each — so `CIDToGIDMap` is `/Identity`
//     and the `W` array gives each glyph's width;
//   * a `ToUnicode` CMap maps those glyph ids back to characters, so the text can still be
//     selected, copied and searched in a reader.
//
// Everything is deflated, including the embedded font, which is what keeps a payslip near 35 KB.
import { deflateSync } from "node:zlib";
import { glyphsOf, type ParsedFont, widthOfText } from "./font";

export type PageSize = { width: number; height: number };
/** A4 in points (72 per inch), the paper Vietnamese payroll is printed on. */
export const A4: PageSize = { width: 595.28, height: 841.89 };

export type TextOptions = {
  size?: number;
  /** Drawn by stroking the outline as well as filling it — the font has no bold of its own. */
  bold?: boolean;
  /** 0 = black, 1 = white. */
  grey?: number;
};

const escapeName = (text: string) => text.replace(/[^\w.-]/g, "");

/** A PDF string of two-byte glyph ids, hex-encoded — the `Identity-H` form. */
function hexGlyphs(font: ParsedFont, text: string): string {
  let hex = "";
  for (const glyph of glyphsOf(font, text)) hex += glyph.toString(16).padStart(4, "0");
  return `<${hex}>`;
}

/**
 * One page being drawn on. Coordinates are PDF's own: x from the left, **y from the bottom**.
 * `Cursor` in the payslip document works downwards and converts, which reads better.
 */
export class Page {
  readonly marks: string[] = [];
  /** Every character drawn on this page, so the document can build one ToUnicode map. */
  readonly used = new Set<number>();

  constructor(
    readonly size: PageSize,
    private readonly font: ParsedFont,
  ) {}

  text(value: string, x: number, y: number, options: TextOptions = {}): void {
    if (value === "") return;
    const size = options.size ?? 9;
    for (const character of value) this.used.add(character.codePointAt(0)!);
    const grey = options.grey ?? 0;
    // Tr 2 = fill then stroke: the outline is drawn on top of itself, which thickens the letters.
    // A real bold face would be better; one font keeps the file small, and this is only for headings.
    const weight = options.bold ? `2 Tr ${(size / 26).toFixed(3)} w ${grey} G` : "0 Tr";
    this.marks.push(`BT ${grey} g ${weight} /F1 ${size} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${hexGlyphs(this.font, value)} Tj ET`);
  }

  /** Right-aligned — what every figure on a payslip is. */
  textRight(value: string, right: number, y: number, options: TextOptions = {}): void {
    this.text(value, right - widthOfText(this.font, value, options.size ?? 9), y, options);
  }

  line(x1: number, y1: number, x2: number, y2: number, grey = 0.8): void {
    this.marks.push(`${grey} G 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  rectangle(x: number, y: number, width: number, height: number, grey = 0.95): void {
    this.marks.push(`${grey} g ${x.toFixed(2)} ${y.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f`);
  }
}

export type PdfMetadata = { title: string; author?: string; subject?: string; createdAt?: Date };

/** A PDF date: `D:YYYYMMDDHHmmSS+07'00'` — Vietnam keeps one offset all year. */
function pdfDate(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(at);
  const of = (type: string) => parts.find((part) => part.type === type)!.value;
  return `D:${of("year")}${of("month")}${of("day")}${of("hour")}${of("minute")}${of("second")}+07'00'`;
}

/** `\` `(` and `)` are the only characters that need escaping inside a PDF literal string. */
const literal = (text: string) => text.replace(/[\\()]/g, (character) => `\\${character}`);

/**
 * Metadata is written as UTF-16BE with a byte-order mark, which is how a PDF carries anything
 * outside Latin-1 — an entity's name has diacritics like everything else here.
 */
function textString(value: string): string {
  let hex = "feff";
  for (const character of value) {
    const code = character.codePointAt(0)!;
    if (code > 0xffff) {
      const offset = code - 0x10000;
      hex += (0xd800 + (offset >> 10)).toString(16).padStart(4, "0") + (0xdc00 + (offset & 0x3ff)).toString(16).padStart(4, "0");
    } else hex += code.toString(16).padStart(4, "0");
  }
  return `<${hex}>`;
}

/** The map from glyph id back to the character it draws, so selecting and searching still work. */
function toUnicodeCMap(font: ParsedFont, used: ReadonlySet<number>): string {
  const pairs = [...used]
    .map((codePoint) => ({ glyph: font.glyphOf(codePoint), codePoint }))
    .filter((pair) => pair.glyph !== 0)
    .sort((left, right) => left.glyph - right.glyph);

  // bfchar takes at most 100 entries per block.
  const blocks: string[] = [];
  for (let index = 0; index < pairs.length; index += 100) {
    const slice = pairs.slice(index, index + 100);
    const lines = slice.map((pair) => `<${pair.glyph.toString(16).padStart(4, "0")}> <${pair.codePoint.toString(16).padStart(4, "0")}>`).join("\n");
    blocks.push(`${slice.length} beginbfchar\n${lines}\nendbfchar`);
  }

  return [
    "/CIDInit /ProcSet findresource begin",
    "12 dict begin",
    "begincmap",
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
    "/CMapName /Adobe-Identity-UCS def",
    "/CMapType 2 def",
    "1 begincodespacerange",
    "<0000> <ffff>",
    "endcodespacerange",
    ...blocks,
    "endcmap",
    "CMapName currentdict /CMap defineresource pop",
    "end",
    "end",
  ].join("\n");
}

/** The `W` array: the width of every glyph that was actually drawn, in thousandths of an em. */
function widthsArray(font: ParsedFont, used: ReadonlySet<number>): string {
  const glyphs = [...new Set([...used].map((codePoint) => font.glyphOf(codePoint)))].filter((glyph) => glyph !== 0).sort((left, right) => left - right);
  // Consecutive glyphs share one `first last [w w w]` run; a gap starts a new one.
  const runs: string[] = [];
  let index = 0;
  while (index < glyphs.length) {
    let end = index;
    while (end + 1 < glyphs.length && glyphs[end + 1] === glyphs[end] + 1) end++;
    const widths = glyphs.slice(index, end + 1).map((glyph) => Math.round((font.widthOf(glyph) * 1000) / font.unitsPerEm));
    runs.push(`${glyphs[index]} [${widths.join(" ")}]`);
    index = end + 1;
  }
  return `[${runs.join(" ")}]`;
}

/**
 * Serialises the pages into a PDF file. Every stream is deflated; the font is embedded whole, once,
 * however many pages there are.
 */
export function renderPdf(pages: readonly Page[], font: ParsedFont, metadata: PdfMetadata): Uint8Array {
  if (pages.length === 0) throw new Error("a pdf needs at least one page");
  const used = new Set<number>();
  for (const page of pages) for (const codePoint of page.used) used.add(codePoint);

  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (text: string | Uint8Array) => {
    const bytes = typeof text === "string" ? Buffer.from(text, "latin1") : text;
    chunks.push(bytes);
    length += bytes.length;
  };

  // Object 1 is the catalogue, 2 the page tree, 3 the font, 4 its descendant, 5 the file itself,
  // 6 the ToUnicode map, 7 the document information, 8 the font descriptor; then a pair of objects
  // per page. Numbers run without gaps: the cross-reference table has a row for every number up to
  // the highest, so a sparse numbering would cost 20 bytes a row for nothing.
  const DESCRIPTOR = 8;
  const pageIds = pages.map((_, index) => 9 + index * 2);
  const object = (id: string | number, body: string | Uint8Array) => {
    offsets[Number(id)] = length;
    push(`${id} 0 obj\n`);
    push(body);
    push("\nendobj\n");
  };
  const stream = (dictionary: string, payload: Uint8Array): Uint8Array => {
    const deflated = deflateSync(payload, { level: 9 });
    return Buffer.concat([Buffer.from(`<< ${dictionary} /Filter /FlateDecode /Length ${deflated.length} >>\nstream\n`, "latin1"), deflated, Buffer.from("\nendstream", "latin1")]);
  };

  push("%PDF-1.7\n");
  // A comment of high bytes: it tells anything moving the file that it is binary, not text.
  push(Buffer.from([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  object(1, `<< /Type /Catalog /Pages 2 0 R >>`);
  object(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`);
  object(3, `<< /Type /Font /Subtype /Type0 /BaseFont /${escapeName("SuzuPayslip")} /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 6 0 R >>`);
  object(
    4,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${escapeName("SuzuPayslip")} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${DESCRIPTOR} 0 R /DW 1000 /W ${widthsArray(font, used)} /CIDToGIDMap /Identity >>`,
  );
  object(5, stream(`/Length1 ${font.bytes.length}`, font.bytes));
  object(6, stream("", Buffer.from(toUnicodeCMap(font, used), "utf8")));
  object(
    7,
    `<< /Title ${textString(metadata.title)} ${metadata.author ? `/Author ${textString(metadata.author)} ` : ""}${metadata.subject ? `/Subject ${textString(metadata.subject)} ` : ""}/Producer (${literal("Suzu One")}) /CreationDate (${pdfDate(metadata.createdAt ?? new Date())}) >>`,
  );

  pages.forEach((page, index) => {
    const id = pageIds[index];
    object(id, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.size.width.toFixed(2)} ${page.size.height.toFixed(2)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    object(id + 1, stream("", Buffer.from(page.marks.join("\n"), "latin1")));
  });

  // The descriptor comes last; object 4 refers to it forwards, which a PDF allows.
  const scale = (value: number) => Math.round((value * 1000) / font.unitsPerEm);
  object(
    DESCRIPTOR,
    `<< /Type /FontDescriptor /FontName /${escapeName("SuzuPayslip")} /Flags 4 /FontBBox [-1000 ${scale(font.descender)} 2000 ${scale(font.ascender)}] /ItalicAngle 0 /Ascent ${scale(font.ascender)} /Descent ${scale(font.descender)} /CapHeight ${scale(font.ascender)} /StemV 80 /FontFile2 5 0 R >>`,
  );

  // The cross-reference table lists every object number from 0 upwards.
  const highest = pageIds.length > 0 ? pageIds[pageIds.length - 1] + 1 : DESCRIPTOR;
  const xrefAt = length;
  const rows = [`0000000000 65535 f `];
  for (let id = 1; id <= highest; id++) rows.push(offsets[id] === undefined ? `0000000000 65535 f ` : `${String(offsets[id]).padStart(10, "0")} 00000 n `);
  push(`xref\n0 ${highest + 1}\n${rows.join("\n")}\n`);
  push(`trailer\n<< /Size ${highest + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`);

  return Buffer.concat(chunks);
}
