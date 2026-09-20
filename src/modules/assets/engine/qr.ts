// A QR code, written out by hand (FR-AST-01: every asset carries a QR label).
//
// Nothing in the tree draws QR codes and the project adds no dependency for one, so this is the
// encoder itself: ISO/IEC 18004, byte mode, error-correction level **M** (recovers about 15% of a
// scuffed label — the level the standard itself recommends for general use), versions 1 to 10.
// Ten versions carry 213 bytes, and an asset label holds a URL of about fifty, so the ceiling is
// nowhere near. Pure: it takes a string and gives back a matrix of dark and light modules. What
// draws them — a PDF label sheet, an SVG on a screen — is somebody else's business.
//
// The shape of the thing, for whoever reads this next:
//   text → codewords (mode, length, bytes, padding)
//         → blocks, each with its Reed–Solomon check codewords appended
//         → the blocks interleaved into one stream
//         → the stream laid into the matrix in a zigzag around the function patterns
//         → each of the eight masks tried, and the least ugly one kept.

/** A finished symbol. `modules[row][col] === true` is a dark module. `size` is 17 + 4 × version. */
export type QrMatrix = { version: number; size: number; modules: boolean[][] };

export class QrError extends Error {}

export const QR_ECC_LEVEL = "M" as const;
const MIN_VERSION = 1;
const MAX_VERSION = 10;

// ── Galois field GF(256), the arithmetic Reed–Solomon is built on ────────────────────────────
// x⁸ + x⁴ + x³ + x² + 1 = 0x11d, the primitive polynomial QR uses.

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let power = 0; power < 255; power++) {
    EXP[power] = value;
    LOG[value] = power;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let power = 255; power < 512; power++) EXP[power] = EXP[power - 255];
}

const multiply = (a: number, b: number): number => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** The generator polynomial (x − α⁰)(x − α¹)…(x − α^(degree−1)), coefficients high power first. */
function generatorPolynomial(degree: number): Uint8Array {
  let polynomial = new Uint8Array([1]);
  for (let index = 0; index < degree; index++) {
    const next = new Uint8Array(polynomial.length + 1);
    for (let position = 0; position < polynomial.length; position++) {
      next[position] ^= polynomial[position];
      next[position + 1] ^= multiply(polynomial[position], EXP[index]);
    }
    polynomial = next;
  }
  return polynomial;
}

/** The `degree` check codewords of one block: the remainder of the message divided by the generator. */
export function errorCorrectionCodewords(data: readonly number[], degree: number): number[] {
  const generator = generatorPolynomial(degree);
  const remainder = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.copyWithin(0, 1);
    remainder[degree - 1] = 0;
    if (factor !== 0) for (let position = 0; position < degree; position++) remainder[position] ^= multiply(generator[position + 1], factor);
  }
  return [...remainder];
}

/**
 * Every syndrome of a valid Reed–Solomon codeword is zero — the codeword is divisible by the
 * generator. Exported so tests can check a block the way a scanner would, instead of against a
 * table of numbers somebody typed in.
 */
export function syndromes(codeword: readonly number[], degree: number): number[] {
  const result: number[] = [];
  for (let index = 0; index < degree; index++) {
    let value = 0;
    for (const byte of codeword) value = multiply(value, EXP[index]) ^ byte;
    result.push(value);
  }
  return result;
}

// ── What each version holds at level M ───────────────────────────────────────────────────────
// total: codewords in the symbol. ecPerBlock: check codewords each block carries.
// The blocks come in one or two groups; a second group's blocks each hold one codeword more.

type VersionSpec = { total: number; ecPerBlock: number; groups: readonly { blocks: number; dataCodewords: number }[] };

const VERSIONS: Record<number, VersionSpec> = {
  1: { total: 26, ecPerBlock: 10, groups: [{ blocks: 1, dataCodewords: 16 }] },
  2: { total: 44, ecPerBlock: 16, groups: [{ blocks: 1, dataCodewords: 28 }] },
  3: { total: 70, ecPerBlock: 26, groups: [{ blocks: 1, dataCodewords: 44 }] },
  4: { total: 100, ecPerBlock: 18, groups: [{ blocks: 2, dataCodewords: 32 }] },
  5: { total: 134, ecPerBlock: 24, groups: [{ blocks: 2, dataCodewords: 43 }] },
  6: { total: 172, ecPerBlock: 16, groups: [{ blocks: 4, dataCodewords: 27 }] },
  7: { total: 196, ecPerBlock: 18, groups: [{ blocks: 4, dataCodewords: 31 }] },
  8: { total: 242, ecPerBlock: 22, groups: [{ blocks: 2, dataCodewords: 38 }, { blocks: 2, dataCodewords: 39 }] },
  9: { total: 292, ecPerBlock: 22, groups: [{ blocks: 3, dataCodewords: 36 }, { blocks: 2, dataCodewords: 37 }] },
  10: { total: 346, ecPerBlock: 26, groups: [{ blocks: 4, dataCodewords: 43 }, { blocks: 1, dataCodewords: 44 }] },
};

export const versionSpec = (version: number): VersionSpec => {
  const spec = VERSIONS[version];
  if (!spec) throw new QrError("qr_unknown_version");
  return spec;
};

const dataCodewordCount = (version: number): number => versionSpec(version).groups.reduce((sum, group) => sum + group.blocks * group.dataCodewords, 0);

/** Byte mode writes the length in 8 bits up to version 9 and in 16 from version 10 (ISO table 3). */
const lengthBits = (version: number): number => (version <= 9 ? 8 : 16);

/** How many bytes of content a version holds, after the mode indicator and the length. */
export const byteCapacity = (version: number): number => dataCodewordCount(version) - 1 - lengthBits(version) / 8;

/** The smallest version that holds `byteLength` bytes, or null when none of them does. */
export function smallestVersion(byteLength: number): number | null {
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) if (byteLength <= byteCapacity(version)) return version;
  return null;
}

// ── Text → the codeword stream ───────────────────────────────────────────────────────────────

class BitWriter {
  readonly bits: number[] = [];
  push(value: number, count: number): void {
    for (let position = count - 1; position >= 0; position--) this.bits.push((value >> position) & 1);
  }
  get length(): number {
    return this.bits.length;
  }
}

/** UTF-8, so Vietnamese in a label's payload survives; a scanner reading ECI-less byte mode reads it back as UTF-8 in practice. */
const utf8 = (text: string): number[] => [...new TextEncoder().encode(text)];

/** The data codewords of one symbol: mode, length, the bytes, a terminator and the pad pattern. */
export function dataCodewords(bytes: readonly number[], version: number): number[] {
  const capacity = dataCodewordCount(version) * 8;
  const writer = new BitWriter();
  writer.push(0b0100, 4); // byte mode
  writer.push(bytes.length, lengthBits(version));
  for (const byte of bytes) writer.push(byte, 8);
  if (writer.length > capacity) throw new QrError("qr_too_long");
  // Terminator: up to four zero bits, then out to a whole codeword.
  writer.push(0, Math.min(4, capacity - writer.length));
  if (writer.length % 8 !== 0) writer.push(0, 8 - (writer.length % 8));
  const codewords = [];
  for (let position = 0; position < writer.length; position += 8) codewords.push(writer.bits.slice(position, position + 8).reduce((value, bit) => (value << 1) | bit, 0));
  // The standard's own filler, alternating, until the symbol is full.
  const padding = [0xec, 0x11];
  while (codewords.length < dataCodewordCount(version)) codewords.push(padding[(codewords.length - writer.length / 8) % 2]);
  return codewords;
}

export type Block = { data: number[]; ec: number[] };

/** Splits the data codewords into the version's blocks and gives each one its check codewords. */
export function blocksOf(codewords: readonly number[], version: number): Block[] {
  const spec = versionSpec(version);
  const blocks: Block[] = [];
  let offset = 0;
  for (const group of spec.groups) {
    for (let index = 0; index < group.blocks; index++) {
      const data = [...codewords.slice(offset, offset + group.dataCodewords)];
      offset += group.dataCodewords;
      blocks.push({ data, ec: errorCorrectionCodewords(data, spec.ecPerBlock) });
    }
  }
  return blocks;
}

/** The blocks woven together, one codeword from each in turn — data first, then the check bytes. */
export function interleave(blocks: readonly Block[]): number[] {
  const stream: number[] = [];
  const longestData = Math.max(...blocks.map((block) => block.data.length));
  for (let position = 0; position < longestData; position++) for (const block of blocks) if (position < block.data.length) stream.push(block.data[position]);
  const longestEc = Math.max(...blocks.map((block) => block.ec.length));
  for (let position = 0; position < longestEc; position++) for (const block of blocks) if (position < block.ec.length) stream.push(block.ec[position]);
  return stream;
}

// ── Format and version information, each protected by its own BCH code ───────────────────────

function bch(value: number, generator: number, totalBits: number, dataBits: number): number {
  let remainder = value << (totalBits - dataBits);
  const generatorBits = 32 - Math.clz32(generator);
  for (let position = totalBits; position >= generatorBits; position--) if (remainder & (1 << (position - 1))) remainder ^= generator << (position - generatorBits);
  return (value << (totalBits - dataBits)) | remainder;
}

/** The 15 bits that say "level M, mask n", BCH(15,5)-protected and XORed with the standard's pattern. */
export const formatInformation = (mask: number): number => bch((0b00 << 3) | mask, 0x537, 15, 5) ^ 0x5412;

/** The 18 bits naming the version, BCH(18,6)-protected. Only versions 7 and up carry them. */
export const versionInformation = (version: number): number => bch(version, 0x1f25, 18, 6);

// ── The matrix ───────────────────────────────────────────────────────────────────────────────

const ALIGNMENT_CENTRES: Record<number, readonly number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

type Canvas = { size: number; modules: boolean[][]; reserved: boolean[][] };

const blank = (size: number): Canvas => ({ size, modules: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)), reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)) });

function place(canvas: Canvas, row: number, col: number, dark: boolean): void {
  canvas.modules[row][col] = dark;
  canvas.reserved[row][col] = true;
}

/** A finder pattern with its separator: the three big squares a scanner looks for first. */
function drawFinder(canvas: Canvas, topRow: number, leftCol: number): void {
  for (let row = -1; row <= 7; row++) {
    for (let col = -1; col <= 7; col++) {
      const r = topRow + row;
      const c = leftCol + col;
      if (r < 0 || r >= canvas.size || c < 0 || c >= canvas.size) continue;
      const ring = Math.max(Math.abs(row - 3), Math.abs(col - 3));
      place(canvas, r, c, ring !== 2 && ring <= 3);
    }
  }
}

function drawFunctionPatterns(canvas: Canvas, version: number): void {
  const last = canvas.size - 7;
  drawFinder(canvas, 0, 0);
  drawFinder(canvas, 0, last);
  drawFinder(canvas, last, 0);

  // Timing: the dotted line that tells a scanner how wide a module is.
  for (let position = 8; position < canvas.size - 8; position++) {
    place(canvas, 6, position, position % 2 === 0);
    place(canvas, position, 6, position % 2 === 0);
  }

  // Alignment patterns, except where they would sit on a finder.
  const centres = ALIGNMENT_CENTRES[version] ?? [];
  for (const row of centres) {
    for (const col of centres) {
      const onFinder = (row <= 8 && col <= 8) || (row <= 8 && col >= canvas.size - 9) || (row >= canvas.size - 9 && col <= 8);
      if (onFinder) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) place(canvas, row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }

  // The module that is always dark, and the space the format bits will take.
  place(canvas, canvas.size - 8, 8, true);
  for (let position = 0; position <= 8; position++) {
    if (position !== 6) canvas.reserved[8][position] = true;
    if (position !== 6) canvas.reserved[position][8] = true;
  }
  for (let position = 0; position < 8; position++) {
    canvas.reserved[8][canvas.size - 1 - position] = true;
    canvas.reserved[canvas.size - 1 - position][8] = true;
  }

  if (version >= 7) for (let index = 0; index < 18; index++) {
    const row = Math.floor(index / 3);
    const col = canvas.size - 11 + (index % 3);
    canvas.reserved[row][col] = true;
    canvas.reserved[col][row] = true;
  }
}

/**
 * Every module the data may use, in the order the standard fills them: upward and downward in
 * two-wide columns from the right, stepping over the vertical timing line. Exported so a test can
 * read a finished symbol back the way a scanner does.
 */
export function dataPositions(canvas: { size: number; reserved: boolean[][] }): { row: number; col: number }[] {
  const positions: { row: number; col: number }[] = [];
  let upward = true;
  for (let right = canvas.size - 1; right > 0; right -= 2) {
    if (right === 6) right = 5; // the timing column is not part of a pair
    for (let step = 0; step < canvas.size; step++) {
      const row = upward ? canvas.size - 1 - step : step;
      for (const col of [right, right - 1]) if (!canvas.reserved[row][col]) positions.push({ row, col });
    }
    upward = !upward;
  }
  return positions;
}

/**
 * Which modules of a version belong to the function patterns and the information areas — that is,
 * every module the data may not touch. Exported for the same reason as `dataPositions`: reading a
 * symbol back needs the same map the writer used.
 */
export function reservedModules(version: number): boolean[][] {
  const canvas = blank(17 + 4 * version);
  drawFunctionPatterns(canvas, version);
  return canvas.reserved;
}

export const MASKS: readonly ((row: number, col: number) => boolean)[] = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (_row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

function writeFormat(canvas: Canvas, mask: number): void {
  const format = formatInformation(mask);
  // The bit nearest the top-left finder is the *most* significant one: the fifteen bits are laid
  // out MSB first. Getting this backwards produces a symbol that looks perfectly convincing and
  // that no scanner on earth will read — which is how it was caught.
  const bit = (index: number) => ((format >> (14 - index)) & 1) === 1;
  for (let index = 0; index <= 5; index++) canvas.modules[8][index] = bit(index);
  canvas.modules[8][7] = bit(6);
  canvas.modules[8][8] = bit(7);
  canvas.modules[7][8] = bit(8);
  for (let index = 9; index <= 14; index++) canvas.modules[14 - index][8] = bit(index);
  // The second copy is split around the always-dark module: seven bits up the bottom-left column,
  // the other eight along the top-right row.
  for (let index = 0; index <= 6; index++) canvas.modules[canvas.size - 1 - index][8] = bit(index);
  for (let index = 7; index <= 14; index++) canvas.modules[8][canvas.size - 15 + index] = bit(index);
}

function writeVersion(canvas: Canvas, version: number): void {
  if (version < 7) return;
  const information = versionInformation(version);
  for (let index = 0; index < 18; index++) {
    const dark = ((information >> index) & 1) === 1;
    const row = Math.floor(index / 3);
    const col = canvas.size - 11 + (index % 3);
    canvas.modules[row][col] = dark;
    canvas.modules[col][row] = dark;
  }
}

// ── Choosing a mask: the standard's four penalties, lowest total wins ────────────────────────

function runPenalty(line: readonly boolean[]): number {
  let penalty = 0;
  let run = 1;
  for (let index = 1; index < line.length; index++) {
    if (line[index] === line[index - 1]) run++;
    else {
      if (run >= 5) penalty += 3 + (run - 5);
      run = 1;
    }
  }
  return penalty + (run >= 5 ? 3 + (run - 5) : 0);
}

// 1:0:1:1:1:0:1 with four light modules on one side — the finder's own signature, which must not
// appear anywhere else, or a scanner locks onto the wrong thing.
const FINDER_LIKE = [true, false, true, true, true, false, true, false, false, false, false];
const matchesAt = (line: readonly boolean[], at: number, pattern: readonly boolean[]) => pattern.every((value, offset) => line[at + offset] === value);

function patternPenalty(line: readonly boolean[]): number {
  let penalty = 0;
  const reversed = [...FINDER_LIKE].reverse();
  for (let at = 0; at + FINDER_LIKE.length <= line.length; at++) {
    if (matchesAt(line, at, FINDER_LIKE)) penalty += 40;
    if (matchesAt(line, at, reversed)) penalty += 40;
  }
  return penalty;
}

export function penalty(modules: readonly (readonly boolean[])[]): number {
  const size = modules.length;
  const columns = Array.from({ length: size }, (_unused, col) => modules.map((row) => row[col]));
  let total = 0;
  for (const line of [...modules, ...columns]) total += runPenalty(line) + patternPenalty(line);
  for (let row = 0; row + 1 < size; row++) {
    for (let col = 0; col + 1 < size; col++) {
      const corner = modules[row][col];
      if (modules[row][col + 1] === corner && modules[row + 1][col] === corner && modules[row + 1][col + 1] === corner) total += 3;
    }
  }
  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  total += 10 * Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5);
  return total;
}

// ── The use-case ─────────────────────────────────────────────────────────────────────────────

/**
 * The QR symbol for `text`, at the smallest version that holds it. `version` forces one (a sheet
 * of labels wants every square the same size, whatever each one says).
 */
export function encodeQr(text: string, options: { version?: number } = {}): QrMatrix {
  if (text.length === 0) throw new QrError("qr_empty");
  const bytes = utf8(text);
  const version = options.version ?? smallestVersion(bytes.length);
  if (version === null) throw new QrError("qr_too_long");
  if (version < MIN_VERSION || version > MAX_VERSION) throw new QrError("qr_unknown_version");
  if (bytes.length > byteCapacity(version)) throw new QrError("qr_too_long");

  const stream = interleave(blocksOf(dataCodewords(bytes, version), version));
  const size = 17 + 4 * version;
  const canvas = blank(size);
  drawFunctionPatterns(canvas, version);
  writeVersion(canvas, version);

  const positions = dataPositions(canvas);
  const bits: number[] = [];
  for (const codeword of stream) for (let position = 7; position >= 0; position--) bits.push((codeword >> position) & 1);
  // Whatever modules are left over after the codewords are the remainder bits: zero, and masked.
  while (bits.length < positions.length) bits.push(0);
  positions.forEach(({ row, col }, index) => {
    canvas.modules[row][col] = bits[index] === 1;
  });

  let best: { mask: number; modules: boolean[][]; score: number } | null = null;
  for (let mask = 0; mask < MASKS.length; mask++) {
    const candidate = canvas.modules.map((row) => [...row]);
    for (const { row, col } of positions) if (MASKS[mask](row, col)) candidate[row][col] = !candidate[row][col];
    const masked: Canvas = { size, modules: candidate, reserved: canvas.reserved };
    writeFormat(masked, mask);
    const score = penalty(candidate);
    if (!best || score < best.score) best = { mask, modules: candidate, score };
  }
  if (!best) throw new QrError("qr_no_mask");
  return { version, size, modules: best.modules };
}

/** The matrix with a quiet zone around it — the margin a scanner needs to find the edges. */
export function withQuietZone(matrix: QrMatrix, modules = 4): boolean[][] {
  const size = matrix.size + modules * 2;
  const padded = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  matrix.modules.forEach((row, rowIndex) => row.forEach((dark, colIndex) => (padded[rowIndex + modules][colIndex + modules] = dark)));
  return padded;
}
