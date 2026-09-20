// Just enough TrueType to draw text in a PDF: which glyph a character is, and how wide it is.
// Pure — it reads a font file that is already in memory and never touches the disk or the network.
//
// A PDF written with `Identity-H` encoding does not contain characters at all: it contains **glyph
// ids**, two bytes each. So before anything can be drawn, the font's `cmap` has to be read to turn
// "ệ" into the number of the glyph that draws it, and `hmtx` to learn how far to move afterwards.
// That is all this file does.
//
// Only what the payslip font actually has is supported: a format-4 `cmap` subtable on platform 3
// (Windows, Unicode BMP) or platform 0 (Unicode). The README beside the font says what to check
// when the font is swapped.

export type ParsedFont = {
  /** Design units per em, from `head` — glyph widths are in these, text is scaled by them. */
  unitsPerEm: number;
  ascender: number;
  descender: number;
  /** The whole font file, to be embedded in the PDF exactly as it is. */
  bytes: Uint8Array;
  numGlyphs: number;
  /** Unicode code point → glyph id. Anything missing draws as glyph 0, the empty box. */
  glyphOf(codePoint: number): number;
  /** Advance width of a glyph, in design units. */
  widthOf(glyphId: number): number;
};

export class FontError extends Error {}

const u16 = (bytes: Uint8Array, offset: number) => (bytes[offset] << 8) | bytes[offset + 1];
const i16 = (bytes: Uint8Array, offset: number) => (u16(bytes, offset) << 16) >> 16;
const u32 = (bytes: Uint8Array, offset: number) => ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;

function tableDirectory(bytes: Uint8Array): Map<string, { offset: number; length: number }> {
  if (bytes.length < 12) throw new FontError("font_too_short");
  const tables = new Map<string, { offset: number; length: number }>();
  const count = u16(bytes, 4);
  for (let index = 0; index < count; index++) {
    const record = 12 + 16 * index;
    if (record + 16 > bytes.length) throw new FontError("font_table_directory_truncated");
    const tag = String.fromCharCode(bytes[record], bytes[record + 1], bytes[record + 2], bytes[record + 3]);
    tables.set(tag, { offset: u32(bytes, record + 8), length: u32(bytes, record + 12) });
  }
  return tables;
}

/** The character → glyph map of a format-4 subtable (the segmented mapping every BMP font has). */
function readFormat4(bytes: Uint8Array, base: number): (codePoint: number) => number {
  const segCountX2 = u16(bytes, base + 6);
  const segCount = segCountX2 / 2;
  const endsAt = base + 14;
  const startsAt = endsAt + segCountX2 + 2; // + 2 for the reservedPad between the two arrays
  const deltasAt = startsAt + segCountX2;
  const rangesAt = deltasAt + segCountX2;

  return (codePoint: number): number => {
    if (codePoint > 0xffff) return 0;
    for (let segment = 0; segment < segCount; segment++) {
      if (u16(bytes, endsAt + 2 * segment) < codePoint) continue;
      const start = u16(bytes, startsAt + 2 * segment);
      if (start > codePoint) return 0;
      const delta = i16(bytes, deltasAt + 2 * segment);
      const rangeOffset = u16(bytes, rangesAt + 2 * segment);
      // rangeOffset 0 means "the glyph id is the code point plus the delta"; otherwise it points
      // into the glyph-id array that follows, relative to its own position (a 1980s linked list).
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyphAt = rangesAt + 2 * segment + rangeOffset + 2 * (codePoint - start);
      if (glyphAt + 1 >= bytes.length) return 0;
      const glyph = u16(bytes, glyphAt);
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  };
}

function readCmap(bytes: Uint8Array, table: { offset: number }): (codePoint: number) => number {
  const count = u16(bytes, table.offset + 2);
  let chosen: number | null = null;
  for (let index = 0; index < count; index++) {
    const record = table.offset + 4 + 8 * index;
    const platform = u16(bytes, record);
    const subtable = table.offset + u32(bytes, record + 4);
    // Windows BMP first, a Unicode subtable as the fallback; both are format 4 here.
    if (u16(bytes, subtable) !== 4) continue;
    if (platform === 3) return readFormat4(bytes, subtable);
    if (platform === 0 && chosen === null) chosen = subtable;
  }
  if (chosen === null) throw new FontError("font_has_no_format4_cmap");
  return readFormat4(bytes, chosen);
}

/** Advance widths: `numberOfHMetrics` pairs, then a tail of glyphs that all share the last width. */
function readWidths(bytes: Uint8Array, hmtx: { offset: number }, numberOfHMetrics: number, numGlyphs: number): (glyphId: number) => number {
  const last = numberOfHMetrics > 0 ? u16(bytes, hmtx.offset + 4 * (numberOfHMetrics - 1)) : 0;
  return (glyphId: number): number => {
    if (glyphId < 0 || glyphId >= numGlyphs) return 0;
    return glyphId < numberOfHMetrics ? u16(bytes, hmtx.offset + 4 * glyphId) : last;
  };
}

export function parseFont(bytes: Uint8Array): ParsedFont {
  const tables = tableDirectory(bytes);
  const need = (tag: string) => tables.get(tag) ?? (() => {
    throw new FontError(`font_missing_${tag.trim()}_table`);
  })();

  const head = need("head");
  const hhea = need("hhea");
  const maxp = need("maxp");
  const unitsPerEm = u16(bytes, head.offset + 18);
  if (unitsPerEm === 0) throw new FontError("font_units_per_em_is_zero");
  const numGlyphs = u16(bytes, maxp.offset + 4);
  const glyphOf = readCmap(bytes, need("cmap"));
  const widthOf = readWidths(bytes, need("hmtx"), u16(bytes, hhea.offset + 34), numGlyphs);

  return {
    unitsPerEm,
    ascender: i16(bytes, hhea.offset + 4),
    descender: i16(bytes, hhea.offset + 6),
    bytes,
    numGlyphs,
    glyphOf,
    widthOf,
  };
}

/** The glyphs a string is drawn with, in order. Used both to measure it and to write it. */
export function glyphsOf(font: ParsedFont, text: string): number[] {
  const glyphs: number[] = [];
  for (const character of text) glyphs.push(font.glyphOf(character.codePointAt(0)!));
  return glyphs;
}

/** How wide a string is, in points, at `size`. */
export function widthOfText(font: ParsedFont, text: string, size: number): number {
  let units = 0;
  for (const glyph of glyphsOf(font, text)) units += font.widthOf(glyph);
  return (units * size) / font.unitsPerEm;
}

/** Cuts `text` down until it fits `maxWidth`, ending it with "…" when something was dropped. */
export function truncateToWidth(font: ParsedFont, text: string, size: number, maxWidth: number): string {
  if (widthOfText(font, text, size) <= maxWidth) return text;
  const characters = [...text];
  let kept = characters.length;
  while (kept > 0 && widthOfText(font, `${characters.slice(0, kept).join("")}…`, size) > maxWidth) kept--;
  return `${characters.slice(0, kept).join("")}…`;
}
