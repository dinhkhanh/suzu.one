// Value lists of the brand kits (FR-BRD-01..06). Client-safe: forms and the public page read them.

/**
 * Who can open a kit on the public domain. `hidden`: nobody — a kit being put together, or one
 * withdrawn. `unlisted`: whoever holds its link, for a partner it was sent to; kept out of the
 * list and out of search engines. `listed`: on the public list of brands, and indexable.
 */
export const BRAND_VISIBILITIES = ["hidden", "unlisted", "listed"] as const;
export type BrandVisibility = (typeof BRAND_VISIBILITIES)[number];

/**
 * What a section of a kit's guideline shows besides its own words and its do's and don'ts:
 * `content` nothing more; `palette` the kit's colours; `typography` its typefaces; `downloads`
 * every public file no other section shows.
 */
export const BRAND_SECTION_KINDS = ["content", "palette", "typography", "downloads"] as const;
export type BrandSectionKind = (typeof BRAND_SECTION_KINDS)[number];

/** The sections a new kit starts with, in order — the usual chapters of a brand guideline. */
export const STARTER_SECTIONS: readonly { key: string; kind: BrandSectionKind }[] = [
  { key: "overview", kind: "content" },
  { key: "logo", kind: "content" },
  { key: "colour", kind: "palette" },
  { key: "typography", kind: "typography" },
  { key: "downloads", kind: "downloads" },
];

export const BRAND_RULE_VERDICTS = ["do", "dont"] as const;
export type BrandRuleVerdict = (typeof BRAND_RULE_VERDICTS)[number];

/**
 * What a file of a kit is, in the order a downloads list shows them. An `example` is a picture
 * that illustrates a do or a don't (a stretched logo) — shown beside the rule, never offered for
 * download.
 */
export const BRAND_ASSET_KINDS = ["logo", "guideline", "brochure", "image", "video", "pack", "other", "example"] as const;
export type BrandAssetKind = (typeof BRAND_ASSET_KINDS)[number];

export const MAX_BRAND_COLORS = 16;
export const MAX_BRAND_FONTS = 8;
export const MAX_BRAND_SECTIONS = 30;
export const MAX_BRAND_RULES = 30;
/** The most files one kit holds. */
export const MAX_BRAND_ASSETS = 200;

export const BRAND_LIMITS = { name: 80, slug: 60, tagline: 160, description: 4000, url: 300, email: 200, sectionTitle: 120, sectionBody: 20000, ruleText: 600, assetTitle: 150, colorName: 40, colorNote: 80, fontName: 60, fontUsage: 120 } as const;

/** Extensions a picture of the file can be shown from on a page (through `<img>`). */
export const THUMBNAIL_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"] as const;
