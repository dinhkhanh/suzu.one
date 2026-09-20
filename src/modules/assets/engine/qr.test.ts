// The QR encoder, checked the way a scanner would check it: the symbol is read back out of the
// matrix — format bits, mask, zigzag, de-interleaving, Reed–Solomon — and must say what went in.
// A golden matrix of ones and zeros typed in by hand would prove far less and rot far faster.
import { describe, expect, it } from "vitest";
import golden from "./qr-golden.json";
import {
  type Block,
  blocksOf,
  byteCapacity,
  dataCodewords,
  dataPositions,
  encodeQr,
  errorCorrectionCodewords,
  formatInformation,
  interleave,
  MASKS,
  penalty,
  type QrMatrix,
  QrError,
  reservedModules,
  smallestVersion,
  syndromes,
  versionInformation,
  versionSpec,
  withQuietZone,
} from "./qr";

// ── A reader, so the tests can check the encoder against something other than itself ─────────

const bitsToNumber = (bits: readonly number[]) => bits.reduce((value, bit) => (value << 1) | bit, 0);

/** The 15 format bits out of the copy beside the top-left finder. */
function readFormat(matrix: QrMatrix): number {
  const bit = (row: number, col: number) => (matrix.modules[row][col] ? 1 : 0);
  let format = 0;
  // MSB first, from the module nearest the top-left finder.
  const read = (index: number, value: number) => (format |= value << (14 - index));
  for (let index = 0; index <= 5; index++) read(index, bit(8, index));
  read(6, bit(8, 7));
  read(7, bit(8, 8));
  read(8, bit(7, 8));
  for (let index = 9; index <= 14; index++) read(index, bit(14 - index, 8));
  return format;
}

/** Reverses `interleave`: the woven stream back into blocks of data and check codewords. */
function deinterleave(stream: readonly number[], version: number): Block[] {
  const spec = versionSpec(version);
  const blocks: Block[] = spec.groups.flatMap((group) => Array.from({ length: group.blocks }, () => ({ data: [] as number[], ec: [] as number[] })));
  const sizes = spec.groups.flatMap((group) => Array.from({ length: group.blocks }, () => group.dataCodewords));
  let cursor = 0;
  for (let position = 0; position < Math.max(...sizes); position++) for (const [index, block] of blocks.entries()) if (position < sizes[index]) block.data.push(stream[cursor++]);
  for (let position = 0; position < spec.ecPerBlock; position++) for (const block of blocks) block.ec.push(stream[cursor++]);
  return blocks;
}

type Reading = { mask: number; eccLevel: number; blocks: Block[]; text: string };

/** What a scanner gets out of the matrix. Throws if the symbol is not self-consistent. */
function readQr(matrix: QrMatrix): Reading {
  const format = readFormat(matrix) ^ 0x5412;
  const mask = format >> 10 === undefined ? 0 : (format >> 10) & 0b111;
  const eccLevel = (format >> 13) & 0b11;

  const reserved = reservedModules(matrix.version);
  const positions = dataPositions({ size: matrix.size, reserved });
  const bits = positions.map(({ row, col }) => {
    const dark = matrix.modules[row][col];
    return (MASKS[mask](row, col) ? !dark : dark) ? 1 : 0;
  });
  const stream: number[] = [];
  for (let position = 0; position + 8 <= bits.length; position += 8) stream.push(bitsToNumber(bits.slice(position, position + 8)));

  const spec = versionSpec(matrix.version);
  const blocks = deinterleave(stream.slice(0, spec.total), matrix.version);
  for (const block of blocks) {
    const zero = syndromes([...block.data, ...block.ec], spec.ecPerBlock);
    if (zero.some((value) => value !== 0)) throw new Error("a block is not a valid Reed–Solomon codeword");
  }

  const dataBits = blocks.flatMap((block) => block.data).flatMap((codeword) => [...Array(8).keys()].map((offset) => (codeword >> (7 - offset)) & 1));
  if (bitsToNumber(dataBits.slice(0, 4)) !== 0b0100) throw new Error("not byte mode");
  const lengthWidth = matrix.version <= 9 ? 8 : 16;
  const length = bitsToNumber(dataBits.slice(4, 4 + lengthWidth));
  const bytes: number[] = [];
  for (let index = 0; index < length; index++) bytes.push(bitsToNumber(dataBits.slice(4 + lengthWidth + index * 8, 4 + lengthWidth + index * 8 + 8)));
  return { mask, eccLevel, blocks, text: new TextDecoder().decode(new Uint8Array(bytes)) };
}

// ── The published tables, which are the one thing that cannot be derived ─────────────────────

describe("the information the standard fixes", () => {
  // ISO/IEC 18004 table C.1, level M (the two level bits are 00).
  const FORMAT_M = ["101010000010010", "101000100100101", "101111001111100", "101101101001011", "100010111111001", "100000011001110", "100111110010111", "100101010100000"];

  it("writes the format bits the standard's table lists for level M", () => {
    expect(FORMAT_M.map((_unused, mask) => formatInformation(mask).toString(2).padStart(15, "0"))).toEqual(FORMAT_M);
  });

  // ISO/IEC 18004 table D.1.
  it("writes the version bits the standard's table lists", () => {
    expect([7, 8, 9, 10].map((version) => versionInformation(version).toString(2).padStart(18, "0"))).toEqual(["000111110010010100", "001000010110111100", "001001101010011001", "001010010011010011"]);
  });

  it("holds as many bytes per version as the standard says at level M", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(byteCapacity)).toEqual([14, 26, 42, 62, 84, 106, 122, 152, 180, 213]);
  });

  it("gives every version a symbol of 17 + 4 × version modules a side, with its codewords accounted for", () => {
    for (let version = 1; version <= 10; version++) {
      const spec = versionSpec(version);
      const data = spec.groups.reduce((sum, group) => sum + group.blocks * group.dataCodewords, 0);
      const blocks = spec.groups.reduce((sum, group) => sum + group.blocks, 0);
      expect(data + blocks * spec.ecPerBlock).toBe(spec.total);
      // Every module that is not a function pattern carries data, to within the remainder bits.
      const positions = dataPositions({ size: 17 + 4 * version, reserved: reservedModules(version) });
      expect(Math.floor(positions.length / 8)).toBe(spec.total);
    }
  });
});

describe("Reed–Solomon", () => {
  it("produces codewords with no syndrome — which is what makes them correctable", () => {
    const message = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const check = errorCorrectionCodewords(message, 10);
    expect(check).toHaveLength(10);
    expect(syndromes([...message, ...check], 10)).toEqual(new Array(10).fill(0));
  });

  it("notices a single corrupted codeword", () => {
    const message = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    const codeword = [...message, ...errorCorrectionCodewords(message, 10)];
    codeword[3] ^= 0x5a;
    expect(syndromes(codeword, 10).some((value) => value !== 0)).toBe(true);
  });

  it("pads a short message the way the standard does, and refuses one that does not fit", () => {
    const codewords = dataCodewords([0x41], 1);
    expect(codewords).toHaveLength(16);
    expect(codewords.slice(0, 3)).toEqual([0b01000000, 0b00010100, 0b00010000]);
    expect(codewords.slice(3)).toEqual([0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
    expect(() => dataCodewords(new Array(20).fill(0x41), 1)).toThrow(QrError);
  });

  it("weaves the blocks together one codeword at a time and takes them apart again", () => {
    const codewords = dataCodewords([...new TextEncoder().encode("an asset label of some length")], 8);
    const blocks = blocksOf(codewords, 8);
    expect(blocks.map((block) => block.data.length)).toEqual([38, 38, 39, 39]);
    expect(deinterleave(interleave(blocks), 8)).toEqual(blocks);
  });
});

describe("a finished symbol", () => {
  const cases = ["https://one.suzu.vn/assets/qr/7f3a9c1e", "SZM-LAP-0007", "Máy quay Sony FX6 — Sản xuất Video", "x", "https://one.suzu.vn/assets/qr/" + "a1b2c3d4".repeat(4)];

  for (const text of cases) {
    it(`reads back as itself: ${text.slice(0, 28)}`, () => {
      const matrix = encodeQr(text);
      const reading = readQr(matrix);
      expect(reading.text).toBe(text);
      expect(reading.eccLevel).toBe(0b00); // level M
      expect(reading.mask).toBeGreaterThanOrEqual(0);
      expect(reading.mask).toBeLessThan(8);
    });
  }

  it("reads back at a version larger than it needs, which a sheet of equal-sized labels asks for", () => {
    const matrix = encodeQr("SZM-CAM-0002", { version: 6 });
    expect(matrix.version).toBe(6);
    expect(matrix.size).toBe(41);
    expect(readQr(matrix).text).toBe("SZM-CAM-0002");
  });

  it("puts the finder patterns, the timing lines and the always-dark module where a scanner looks", () => {
    const matrix = encodeQr("SZM-LAP-0007");
    const dark = (row: number, col: number) => matrix.modules[row][col];
    for (const [top, left] of [[0, 0], [0, matrix.size - 7], [matrix.size - 7, 0]] as const) {
      expect(dark(top + 0, left + 0)).toBe(true);
      expect(dark(top + 1, left + 1)).toBe(false);
      expect(dark(top + 3, left + 3)).toBe(true);
    }
    // The separator: a light ring around each finder.
    expect(dark(7, 0)).toBe(false);
    expect(dark(0, 7)).toBe(false);
    // Timing lines alternate, starting dark at module 8.
    for (let position = 8; position < matrix.size - 8; position++) {
      expect(dark(6, position)).toBe(position % 2 === 0);
      expect(dark(position, 6)).toBe(position % 2 === 0);
    }
    expect(dark(matrix.size - 8, 8)).toBe(true);
  });

  it("chooses the mask with the lowest penalty, not simply the first", () => {
    const matrix = encodeQr("https://one.suzu.vn/assets/qr/7f3a9c1e");
    const chosen = readQr(matrix).mask;
    const score = penalty(matrix.modules);
    for (let mask = 0; mask < 8; mask++) {
      if (mask === chosen) continue;
      // Re-masking the chosen symbol with another mask must not come out better.
      const reserved = reservedModules(matrix.version);
      const other = matrix.modules.map((row) => [...row]);
      for (const { row, col } of dataPositions({ size: matrix.size, reserved })) if (MASKS[chosen](row, col) !== MASKS[mask](row, col)) other[row][col] = !other[row][col];
      expect(penalty(other)).toBeGreaterThanOrEqual(score);
    }
  });

  it("grows to the smallest version that holds the text", () => {
    expect(smallestVersion(14)).toBe(1);
    expect(smallestVersion(15)).toBe(2);
    expect(smallestVersion(213)).toBe(10);
    expect(smallestVersion(214)).toBeNull();
    expect(encodeQr("x".repeat(14)).version).toBe(1);
    expect(encodeQr("x".repeat(15)).version).toBe(2);
    expect(() => encodeQr("x".repeat(214))).toThrow(QrError);
    expect(() => encodeQr("")).toThrow(QrError);
  });

  it("counts Vietnamese as the bytes it takes, not the letters", () => {
    // "Máy quay" is 8 letters but 11 bytes in UTF-8.
    expect(encodeQr("Máy quay").version).toBe(1);
    expect(readQr(encodeQr("Đèn studio Aputure 600d")).text).toBe("Đèn studio Aputure 600d");
  });

  // These seven matrices were each rendered to a PNG and read back by **Apple's Vision barcode
  // scanner**, which returned the original text — an authority outside this file and outside this
  // repository. Reading a symbol back with the code that wrote it cannot catch a convention that
  // is consistently wrong in both directions, and one was: the fifteen format bits were laid out
  // least-significant first, which produces a symbol that looks entirely convincing and that no
  // scanner will read. Regenerate these only after scanning the new ones for real.
  it.each(golden)("matches the scanner-verified matrix for $text", ({ text, forcedVersion, version, rows }) => {
    const matrix = encodeQr(text, forcedVersion ? { version: forcedVersion } : {});
    expect(matrix.version).toBe(version);
    expect(matrix.modules.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""))).toEqual(rows);
  });

  it("puts a quiet zone of light modules round the symbol", () => {
    const matrix = encodeQr("SZM-LAP-0007");
    const padded = withQuietZone(matrix);
    expect(padded).toHaveLength(matrix.size + 8);
    expect(padded[0].every((dark) => !dark)).toBe(true);
    expect(padded.every((row) => !row[0] && !row[row.length - 1])).toBe(true);
    expect(padded[4][4]).toBe(matrix.modules[0][0]);
  });
});
