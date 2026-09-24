// Renders every file that carries the logo from the one path in src/components/brand/logo-path.ts:
//
//   public/logo.svg                 the mark alone, filled with currentColor, for designers and docs
//   public/icons/icon-192.png       home-screen icons: white mark on a rounded red tile
//   public/icons/icon-512.png
//   public/icons/icon-maskable-512  full-bleed red, the mark inside the maskable safe zone
//   public/icons/apple-touch-icon   180 px, full-bleed (iOS rounds it itself)
//   public/icons/badge-96.png       white mark on transparent, the Android notification badge
//   src/app/favicon.ico             16, 32 and 48 px tiles packed as PNG entries
//
// Run with `pnpm brand:icons` after the path changes.
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { LOGO_PATH, LOGO_VIEW_BOX } from "../src/components/brand/logo-path";

// The brand red as sRGB (#EA3026); oklch is for the stylesheet, image files want hex.
const BRAND = "#EA3026";
const ROOT = join(import.meta.dirname, "..");

const [, , boxWidth, boxHeight] = LOGO_VIEW_BOX.split(" ").map(Number);

/** The mark scaled to sit inside `side` with `pad` (a fraction of the side) around it. */
function markOn(side: number, pad: number, fill: string): string {
  const inner = side * (1 - 2 * pad);
  const scale = Math.min(inner / boxWidth, inner / boxHeight);
  const x = (side - boxWidth * scale) / 2;
  const y = (side - boxHeight * scale) / 2;
  return `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(5)})"><path fill="${fill}" d="${LOGO_PATH}"/></g>`;
}

function tile(side: number, { pad, radius, background }: { pad: number; radius: number; background: string | null }): string {
  const rect = background
    ? `<rect width="${side}" height="${side}" rx="${(side * radius).toFixed(2)}" fill="${background}"/>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${side} ${side}">${rect}${markOn(side, pad, "#fff")}</svg>`;
}

async function png(svg: string, side: number): Promise<Buffer> {
  return sharp(Buffer.from(svg), { density: 384 }).resize(side, side).png().toBuffer();
}

/** An .ico is a 6-byte header, one 16-byte directory entry per image, then the images; PNG
 *  entries have been accepted by every browser since Windows Vista. */
function ico(entries: Array<{ side: number; data: Buffer }>): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ side, data }, index) => {
    const at = index * 16;
    directory.writeUInt8(side >= 256 ? 0 : side, at);
    directory.writeUInt8(side >= 256 ? 0 : side, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(data.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += data.length;
  });
  return Buffer.concat([header, directory, ...entries.map((entry) => entry.data)]);
}

async function main() {
  const icons = join(ROOT, "public", "icons");
  await mkdir(icons, { recursive: true });

  await writeFile(
    join(ROOT, "public", "logo.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEW_BOX}" fill="currentColor"><path d="${LOGO_PATH}"/></svg>\n`,
  );

  const rounded = { pad: 0.18, radius: 0.2, background: BRAND };
  const bleed = { pad: 0.2, radius: 0, background: BRAND };
  const maskable = { pad: 0.25, radius: 0, background: BRAND };
  const badge = { pad: 0.08, radius: 0, background: null };

  await Promise.all([
    png(tile(192, rounded), 192).then((data) => writeFile(join(icons, "icon-192.png"), data)),
    png(tile(512, rounded), 512).then((data) => writeFile(join(icons, "icon-512.png"), data)),
    png(tile(512, maskable), 512).then((data) => writeFile(join(icons, "icon-maskable-512.png"), data)),
    png(tile(180, bleed), 180).then((data) => writeFile(join(icons, "apple-touch-icon.png"), data)),
    png(tile(96, badge), 96).then((data) => writeFile(join(icons, "badge-96.png"), data)),
  ]);

  const favicons = await Promise.all([16, 32, 48].map(async (side) => ({ side, data: await png(tile(side, rounded), side) })));
  await writeFile(join(ROOT, "src", "app", "favicon.ico"), ico(favicons));

  console.log("brand icons written");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
