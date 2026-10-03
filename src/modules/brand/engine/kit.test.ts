import { describe, expect, it } from "vitest";
import { brandSlugFrom, cleanFonts, cleanPalette, coverAssetOf, guessAssetKind, isDownloadable, isValidBrandSlug, localized, normalizeHex, placeAssets, prefersLightText, resolveBrandSlug, rgbOf, sectionAnchors, titleFromFileName } from "./kit";

const asset = (over: Partial<{ id: string; kind: "logo" | "image" | "example" | "brochure" | "pack"; sortOrder: number; title: string; isPublic: boolean; fileName: string; sectionId: string | null }>) => ({
  id: "a",
  kind: "logo" as const,
  sortOrder: 0,
  title: "Logo",
  isPublic: true,
  fileName: "logo.svg",
  sectionId: null,
  ...over,
});

describe("the address", () => {
  it("is made from the name when nothing is typed, Vietnamese included", () => {
    expect(brandSlugFrom("", "SuZu Cà Phê Đà Lạt")).toBe("suzu-ca-phe-da-lat");
    expect(brandSlugFrom("  My Brand! ", "ignored")).toBe("my-brand");
  });
  it("takes lower-case words joined by single hyphens", () => {
    expect(isValidBrandSlug("suzu-coffee")).toBe(true);
    for (const slug of ["a", "Suzu", "suzu--coffee", "-suzu", "suzu_coffee", "x".repeat(61)]) expect(isValidBrandSlug(slug), slug).toBe(false);
  });
  it("resolves to the kit that has it, or the kit that had it", () => {
    const kits = [
      { id: "new", slug: "suzu", formerSlugs: [] },
      { id: "old", slug: "suzu-coffee", formerSlugs: ["suzu"] },
    ];
    expect(resolveBrandSlug(kits, "suzu")).toEqual({ kit: kits[0], redirect: false });
    expect(resolveBrandSlug([kits[1]], "suzu")).toEqual({ kit: kits[1], redirect: true });
    expect(resolveBrandSlug(kits, "nope")).toBeNull();
  });
});

describe("the palette", () => {
  it("normalises HEX codes", () => {
    expect(normalizeHex("ea3026")).toBe("#EA3026");
    expect(normalizeHex(" #e32 ")).toBe("#EE3322");
    expect(normalizeHex("red")).toBeNull();
    expect(normalizeHex("#12345")).toBeNull();
  });
  it("drops blank rows, names unnamed colours, and refuses a bad code", () => {
    expect(cleanPalette([{ name: "Suzu Red", hex: "ea3026", note: " Pantone 485 C " }, { name: "", hex: "" }, { hex: "#000" }])).toEqual({
      ok: true,
      colors: [
        { name: "Suzu Red", hex: "#EA3026", note: "Pantone 485 C" },
        { name: "#000000", hex: "#000000", note: null },
      ],
    });
    expect(cleanPalette([{ name: "Red", hex: "not a colour" }])).toEqual({ ok: false, problem: "color_invalid" });
    expect(cleanPalette(Array.from({ length: 17 }, () => ({ name: "x", hex: "#fff" })))).toEqual({ ok: false, problem: "too_many_colors" });
  });
  it("reads RGB off the code, and picks the label colour that reads", () => {
    expect(rgbOf("#EA3026")).toBe("234 48 38");
    expect(prefersLightText("#1A1A1A")).toBe(true);
    expect(prefersLightText("#3457D5")).toBe(true);
    expect(prefersLightText("#FFFFFF")).toBe(false);
    expect(prefersLightText("#F5D90A")).toBe(false);
  });
});

describe("the typefaces", () => {
  it("keep a link only when it is a web address", () => {
    expect(cleanFonts([{ name: " Be Vietnam Pro ", usage: "Body", url: "https://fonts.google.com/specimen/Be+Vietnam+Pro" }, { name: "" }])).toEqual({
      ok: true,
      fonts: [{ name: "Be Vietnam Pro", usage: "Body", url: "https://fonts.google.com/specimen/Be+Vietnam+Pro" }],
    });
    expect(cleanFonts([{ name: "Evil", url: "javascript:alert(1)" }])).toEqual({ ok: false, problem: "font_url_invalid" });
  });
});

describe("files", () => {
  it("are titled and guessed from their names", () => {
    expect(titleFromFileName("Logo_ngang - nền tối.svg")).toBe("Logo ngang - nền tối");
    expect(guessAssetKind("SuZu_Logo_Color.ai")).toBe("logo");
    expect(guessAssetKind("brand guideline 2026.pdf")).toBe("guideline");
    expect(guessAssetKind("Company profile.pdf")).toBe("brochure");
    expect(guessAssetKind("logo-dont-stretch.png")).toBe("example");
    expect(guessAssetKind("all-logos.zip")).toBe("pack");
    expect(guessAssetKind("TVC.mov")).toBe("video");
    expect(guessAssetKind("hero photo.jpg")).toBe("image");
  });
  it("are downloadable when public and not an example", () => {
    expect(isDownloadable({ isPublic: true, kind: "logo" })).toBe(true);
    expect(isDownloadable({ isPublic: false, kind: "logo" })).toBe(false);
    expect(isDownloadable({ isPublic: true, kind: "example" })).toBe(false);
  });
  it("give the brand its cover: the first picturable public logo", () => {
    expect(coverAssetOf([asset({ id: "eps", fileName: "logo.eps" }), asset({ id: "png", fileName: "logo.png", sortOrder: 5 }), asset({ id: "first", fileName: "logo.svg", isPublic: false })])?.id).toBe("png");
    expect(coverAssetOf([asset({ id: "photo", kind: "image", fileName: "a.jpg" })])?.id).toBe("photo");
    expect(coverAssetOf([asset({ kind: "example", fileName: "wrong.png" })])).toBeNull();
  });
  it("sit in their own section, else in the downloads section, else after the last", () => {
    const sections = [
      { id: "logo", kind: "content" as const },
      { id: "dl", kind: "downloads" as const },
    ];
    const placed = placeAssets(sections, [asset({ id: "1", sectionId: "logo" }), asset({ id: "2", sectionId: null }), asset({ id: "3", sectionId: "gone" }), asset({ id: "4", isPublic: false }), asset({ id: "5", kind: "example" })]);
    expect(placed.bySection.get("logo")!.map((row) => row.id)).toEqual(["1"]);
    expect(placed.bySection.get("dl")!.map((row) => row.id)).toEqual(["2", "3"]);
    expect(placed.rest).toEqual([]);
    expect(placeAssets([{ id: "logo", kind: "content" }], [asset({ id: "2" })]).rest.map((row) => row.id)).toEqual(["2"]);
  });
});

describe("the page", () => {
  it("reads in the visitor's language when the keeper wrote it", () => {
    expect(localized("Logo", "Logo (EN)", "en")).toBe("Logo (EN)");
    expect(localized("Màu sắc", "", "en")).toBe("Màu sắc");
    expect(localized("Màu sắc", "Colour", "vi")).toBe("Màu sắc");
  });
  it("gives every section an anchor of its own", () => {
    expect(sectionAnchors(["Logo", "Màu sắc", "Logo", "!!!"])).toEqual(["logo", "mau-sac", "logo-3", "section-4"]);
  });
});
