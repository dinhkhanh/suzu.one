// Pure rules of a brand kit (FR-BRD-01..06): its address, its palette and typefaces, how its files
// are ordered and labelled, which one stands for the brand, which section offers what. No I/O;
// client-safe.
import { slugify } from "@/lib/slug";
import { BRAND_ASSET_KINDS, BRAND_LIMITS, type BrandAssetKind, type BrandSectionKind, type BrandVisibility, MAX_BRAND_COLORS, MAX_BRAND_FONTS, THUMBNAIL_EXTENSIONS } from "../enums";
import type { BrandColor, BrandFont } from "../schema";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a slug may be a kit's address: lower-case letters, digits, single hyphens between. */
export const isValidBrandSlug = (slug: string): boolean => slug.length >= 2 && slug.length <= BRAND_LIMITS.slug && SLUG.test(slug);

/** The slug a kit gets from what was typed — or, when nothing was, from its name. "SuZu Café" → "suzu-cafe". */
export const brandSlugFrom = (typed: string | null | undefined, name: string): string => slugify(typed?.trim() ? typed : name, { maxLength: BRAND_LIMITS.slug });

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** "#ea3026", "EA3026" and "#e32" become "#EA3026" and "#EE3322"; anything else is null. */
export function normalizeHex(value: string): string | null {
  const match = HEX.exec(value.trim());
  if (!match) return null;
  const digits = match[1].length === 3 ? [...match[1]].map((digit) => digit + digit).join("") : match[1];
  return `#${digits.toUpperCase()}`;
}

export type PaletteProblem = "color_invalid" | "too_many_colors";

/** The palette as it is stored: named, upper-case six-digit hex, blank rows dropped. */
export function cleanPalette(colors: readonly { name?: string | null; hex?: string | null; note?: string | null }[]): { ok: true; colors: BrandColor[] } | { ok: false; problem: PaletteProblem } {
  const kept = colors.filter((color) => color.name?.trim() || color.hex?.trim());
  if (kept.length > MAX_BRAND_COLORS) return { ok: false, problem: "too_many_colors" };
  const cleaned: BrandColor[] = [];
  for (const color of kept) {
    const hex = normalizeHex(color.hex ?? "");
    if (!hex) return { ok: false, problem: "color_invalid" };
    cleaned.push({ name: (color.name ?? "").trim().slice(0, BRAND_LIMITS.colorName) || hex, hex, note: color.note?.trim().slice(0, BRAND_LIMITS.colorNote) || null });
  }
  return { ok: true, colors: cleaned };
}

/** Only http and https: a `javascript:` link written into a kit must never reach the public page. */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

export type FontsProblem = "too_many_fonts" | "font_url_invalid";

/** The typefaces as they are stored: named, blank rows dropped, a link only when it is http(s). */
export function cleanFonts(fonts: readonly { name?: string | null; usage?: string | null; url?: string | null }[]): { ok: true; fonts: BrandFont[] } | { ok: false; problem: FontsProblem } {
  const kept = fonts.filter((font) => font.name?.trim());
  if (kept.length > MAX_BRAND_FONTS) return { ok: false, problem: "too_many_fonts" };
  const cleaned: BrandFont[] = [];
  for (const font of kept) {
    const url = font.url?.trim() || null;
    if (url && !isWebUrl(url)) return { ok: false, problem: "font_url_invalid" };
    cleaned.push({ name: font.name!.trim().slice(0, BRAND_LIMITS.fontName), usage: font.usage?.trim().slice(0, BRAND_LIMITS.fontUsage) || null, url });
  }
  return { ok: true, fonts: cleaned };
}

/** "#EA3026" → "234 48 38": what a designer types into a tool that wants RGB. */
export function rgbOf(hex: string): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `${(value >> 16) & 255} ${(value >> 8) & 255} ${value & 255}`;
}

/** Whether a label on this colour reads better in white than in ink (WCAG relative luminance). */
export function prefersLightText(hex: string): boolean {
  const [r, g, b] = rgbOf(hex)
    .split(" ")
    .map((channel) => {
      const value = Number(channel) / 255;
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // White against the ink of the page (#1A1A1A, luminance ≈ 0.0103).
  return 1.05 / (luminance + 0.05) > (luminance + 0.05) / 0.0603;
}

/** The reader's language when the keeper wrote it, the Vietnamese otherwise. */
export const localized = (vi: string, en: string | null | undefined, locale: string): string => (locale === "en" && en?.trim() ? en : vi);

/** "Logo ngang.SVG" → "SVG": the format a visitor chooses by. */
export function fileFormatOf(fileName: string): string {
  const extension = fileName.includes(".") ? fileName.split(".").pop()!.toLowerCase() : "";
  return extension === "jpeg" ? "JPG" : extension.toUpperCase();
}

/** Whether a picture of the file itself can stand on the page (through `<img>`). */
export const hasThumbnail = (fileName: string): boolean => (THUMBNAIL_EXTENSIONS as readonly string[]).includes(fileName.split(".").pop()?.toLowerCase() ?? "");

/** "Logo_ngang - nền tối.svg" → "Logo ngang - nền tối": the title a newly uploaded file starts with. */
export const titleFromFileName = (fileName: string): string => (fileName.includes(".") ? fileName.slice(0, fileName.lastIndexOf(".")) : fileName).replace(/_+/g, " ").trim().slice(0, BRAND_LIMITS.assetTitle) || fileName;

/** A guess at what a file is, from its name, for the upload form's default. */
export function guessAssetKind(fileName: string): BrandAssetKind {
  const name = fileName.toLowerCase();
  const extension = name.split(".").pop() ?? "";
  if (["mp4", "m4v", "mov"].includes(extension)) return "video";
  if (extension === "zip") return "pack";
  if (/\b(do|dont|don't|wrong|incorrect|misuse)\b|sai|không nên|khong nen/.test(name)) return "example";
  if (/guide|brand ?book|nhận diện|nhan dien|cẩm nang|cam nang/.test(name)) return "guideline";
  if (/brochure|catalog|profile|flyer|leaflet/.test(name)) return "brochure";
  if (/logo|icon|mark|symbol|biểu tượng|bieu tuong/.test(name) || ["svg", "ai", "eps"].includes(extension)) return "logo";
  if (["png", "jpg", "jpeg", "webp", "psd"].includes(extension)) return "image";
  if (extension === "pdf") return "brochure";
  return "other";
}

type Ordered = { kind: BrandAssetKind; sortOrder: number; title: string; id: string };

/** A downloads list's order: by kind (logos first), then the keeper's own order, then the title. Total, so a cached list is the same every time. */
export function compareAssets(a: Ordered, b: Ordered): number {
  return BRAND_ASSET_KINDS.indexOf(a.kind) - BRAND_ASSET_KINDS.indexOf(b.kind) || a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, "vi") || a.id.localeCompare(b.id);
}

/** Whether a file is offered for download: public, and not a picture that only illustrates a rule. */
export const isDownloadable = (asset: { isPublic: boolean; kind: BrandAssetKind }): boolean => asset.isPublic && asset.kind !== "example";

/**
 * Whether a file is drawn beside a rule on the public page (FR-BRD-03): a rule of the kit cites it
 * as its example, and it is a picture. Shown, never offered: a rule that cites a brochure or a
 * working file illustrates nothing, and citing one must not be a way to hand it out.
 */
export const isIllustration = (asset: { id: string; fileName: string }, citedByRules: ReadonlySet<string>): boolean => citedByRules.has(asset.id) && hasThumbnail(asset.fileName);

/** The file that stands for the brand on the list of brands: its first downloadable logo that can be pictured, else its first such picture. */
export function coverAssetOf<Asset extends Ordered & { isPublic: boolean; fileName: string }>(assets: readonly Asset[]): Asset | null {
  const pictured = assets.filter((asset) => isDownloadable(asset) && hasThumbnail(asset.fileName)).sort(compareAssets);
  return pictured.find((asset) => asset.kind === "logo") ?? pictured[0] ?? null;
}

/**
 * The files each section of the page offers: a file named to a section that still exists sits
 * there; every other downloadable file sits in the first downloads section — or, when the kit has
 * none, in the `rest` the page lists after the last section.
 */
export function placeAssets<Asset extends Ordered & { isPublic: boolean; sectionId: string | null }>(
  sections: readonly { id: string; kind: BrandSectionKind }[],
  assets: readonly Asset[],
): { bySection: Map<string, Asset[]>; rest: Asset[] } {
  const bySection = new Map<string, Asset[]>(sections.map((section) => [section.id, []]));
  const downloads = sections.find((section) => section.kind === "downloads");
  const rest: Asset[] = [];
  for (const asset of [...assets].filter(isDownloadable).sort(compareAssets)) {
    const home = asset.sectionId && bySection.has(asset.sectionId) ? asset.sectionId : downloads?.id;
    if (home) bySection.get(home)!.push(asset);
    else rest.push(asset);
  }
  return { bySection, rest };
}

/** Whether a visitor holding the address may open the kit at all. */
export const isOpenToPublic = (visibility: BrandVisibility): boolean => visibility !== "hidden";

/**
 * Which kit an address names: the kit whose slug it is, or one that used to have it (then the
 * visitor is sent on to the current address). A current slug always wins over a former one.
 */
export function resolveBrandSlug<Kit extends { slug: string; formerSlugs: readonly string[] }>(kits: readonly Kit[], slug: string): { kit: Kit; redirect: boolean } | null {
  const current = kits.find((kit) => kit.slug === slug);
  if (current) return { kit: current, redirect: false };
  const former = kits.find((kit) => kit.formerSlugs.includes(slug));
  return former ? { kit: former, redirect: true } : null;
}

/** The in-page anchors of the sections, from their titles ("Logo" → "logo"), unique on the page. */
export function sectionAnchors(titles: readonly string[]): string[] {
  const seen = new Set<string>();
  return titles.map((title, index) => {
    let anchor = slugify(title, { maxLength: 40 }) || `section-${index + 1}`;
    if (seen.has(anchor)) anchor = `${anchor}-${index + 1}`;
    seen.add(anchor);
    return anchor;
  });
}
