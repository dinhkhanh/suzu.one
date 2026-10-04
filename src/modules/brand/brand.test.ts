// Brand kits against a real Postgres (PGlite): a kit starts with the usual chapters, an address
// that changes keeps the old one working, a file of a kit is checked like any other upload (an SVG
// welcome, a renamed program not), and — the part that matters most — the public domain gets only
// what was published: no hidden kit, no private file, no example picture as a download.
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => import("../../../tests/helpers/db"));
vi.mock("@/lib/action", () => ({
  ActionError: class ActionError extends Error {
    constructor(
      message: string,
      readonly details?: unknown,
    ) {
      super(message);
    }
  },
  createAction: () => async () => ({ ok: false, error: "failed" }),
}));
// Only the network layer is replaced: the upload checks — the owner's allow-list and the magic
// bytes — run for real against the bytes "stored" here.
const objects = new Map<string, Uint8Array>();
vi.mock("@/modules/platform/files/storage", () => ({
  currentBucket: () => "test-bucket",
  createSignedUploadUrl: async (objectPath: string) => `https://storage.invalid/upload/${objectPath}`,
  createSignedDownloadUrl: async (objectPath: string) => `https://storage.invalid/download/${objectPath}`,
  inspectObject: async (objectPath: string) => {
    const bytes = objects.get(objectPath);
    return bytes ? { sizeBytes: bytes.byteLength, head: bytes.slice(0, 512) } : null;
  },
  finalizeObject: async () => {},
  removeObject: async (objectPath: string) => void objects.delete(objectPath),
  StorageError: class StorageError extends Error {},
}));

import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { migrateTestDb } from "../../../tests/helpers/db";
import { STARTER_SECTIONS } from "./enums";
import { BRAND_FILE_LIMITS, brandVisitorKey } from "./engine/rate-limit";
import { countBrandFileHit, listPublicBrandKits, openPublicBrandKit, publicBrandFileLink, servePublicBrandFile } from "./public";
import {
  beginBrandAssetUpload,
  completeBrandAssetUpload,
  createBrandKit,
  createBrandRule,
  deleteBrandKit,
  deleteBrandSection,
  downloadTotalsByAsset,
  findBrandKit,
  loadBrandKitContent,
  moveBrandSection,
  purgeBrandFileHits,
  totalsByKit,
  updateBrandKitDetails,
  type BrandKitDetails,
  type BrandKitRow,
} from "./service";

const fails = (promise: Promise<unknown>) => promise.then(() => "no error", (error: Error) => error.message);
const starter = STARTER_SECTIONS.map((section) => ({ kind: section.kind, title: section.key, titleEn: section.key }));
const svg = new TextEncoder().encode('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>');
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 3, 0, 0, 0]);
const pdf = new TextEncoder().encode("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

let actor: { personId: string };
let kit: BrandKitRow;

const details = (over: Partial<BrandKitDetails> = {}): BrandKitDetails => ({ name: kit.name, slug: kit.slug, tagline: null, description: null, descriptionEn: null, websiteUrl: null, contactEmail: null, visibility: kit.visibility, entityId: kit.entityId, ...over });

/** The whole upload, as the browser would do it: announce, "PUT" the bytes, complete. */
async function upload(fileName: string, bytes: Uint8Array, extra: Partial<{ kind: "logo" | "example" | "brochure"; isPublic: boolean; sectionId: string | null }> = {}) {
  const begun = await beginBrandAssetUpload(kit, { fileName, sizeBytes: bytes.byteLength }, actor);
  const [row] = await db().select().from(schema.storedFile).where(eq(schema.storedFile.id, begun.fileId));
  objects.set(row.objectPath, bytes);
  return completeBrandAssetUpload(kit, begun.fileId, { title: fileName, kind: extra.kind ?? "logo", isPublic: extra.isPublic ?? true, sectionId: extra.sectionId ?? null }, actor);
}

beforeAll(async () => {
  await migrateTestDb();
  const [person] = await db().insert(schema.person).values({ fullName: "Mai", searchName: "mai", workEmail: "mai@suzu.group" }).returning();
  actor = { personId: person.id };
  kit = await createBrandKit({ name: "SuZu Coffee", slug: "suzu-coffee", entityId: null }, starter, actor);
});

describe("a new kit", () => {
  it("is hidden and starts with the usual chapters, in order", async () => {
    const content = await loadBrandKitContent(kit);
    expect(kit.visibility).toBe("hidden");
    expect(content.sections.map((section) => [section.title, section.kind])).toEqual(STARTER_SECTIONS.map((section) => [section.key, section.kind]));
  });

  it("refuses an address another kit has", async () => {
    expect(await fails(createBrandKit({ name: "Copy", slug: "suzu-coffee", entityId: null }, [], actor))).toBe("slug_taken");
    expect(await fails(createBrandKit({ name: "Bad", slug: "Not A Slug", entityId: null }, [], actor))).toBe("slug_invalid");
  });
});

describe("the address", () => {
  it("keeps working after a rename, and sends the visitor on", async () => {
    ({ after: kit } = await updateBrandKitDetails(kit.id, details({ slug: "suzu-cafe", visibility: "unlisted" })));
    expect(kit.formerSlugs).toEqual(["suzu-coffee"]);
    expect(await openPublicBrandKit("suzu-coffee")).toEqual({ kind: "moved", slug: "suzu-cafe" });
    expect((await openPublicBrandKit("suzu-cafe"))?.kind).toBe("kit");
  });

  it("stops being a former address once the kit takes it back", async () => {
    ({ after: kit } = await updateBrandKitDetails(kit.id, details({ slug: "suzu-coffee" })));
    expect(kit.slug).toBe("suzu-coffee");
    expect(kit.formerSlugs).toEqual(["suzu-cafe"]);
  });
});

describe("files", () => {
  it("takes a vector logo, and refuses a program renamed to look like one", async () => {
    const logo = await upload("Logo ngang.svg", svg);
    expect(logo.kind).toBe("logo");
    expect(await fails(upload("logo.svg", exe))).toBe("file_content_mismatch");
    // A brand kit takes what the rest of the product keeps out; an HR record still does not.
    expect(await fails(beginBrandAssetUpload(kit, { fileName: "setup.exe", sizeBytes: 10 }, actor))).toBe("file_type_not_allowed");
  });
});

describe("what the public gets", () => {
  it("never opens a hidden kit, and lists only listed ones", async () => {
    ({ after: kit } = await updateBrandKitDetails(kit.id, details({ visibility: "hidden" })));
    expect(await openPublicBrandKit("suzu-coffee")).toBeNull();
    ({ after: kit } = await updateBrandKitDetails(kit.id, details({ visibility: "unlisted" })));
    expect((await openPublicBrandKit("suzu-coffee"))?.kind).toBe("kit");
    expect(await listPublicBrandKits()).toEqual([]);
    ({ after: kit } = await updateBrandKitDetails(kit.id, details({ visibility: "listed" })));
    const [card] = await listPublicBrandKits();
    expect(card).toMatchObject({ slug: "suzu-coffee", name: "SuZu Coffee" });
    expect(card.cover).not.toBeNull();
  });

  it("hands out public files, keeps private ones, and shows an example only beside its rule", async () => {
    const privateFile = await upload("working file.png", png, { kind: "brochure", isPublic: false });
    const example = await upload("logo stretched.png", png, { kind: "example", isPublic: false });
    const opened = async () => {
      const result = await openPublicBrandKit("suzu-coffee");
      if (result?.kind !== "kit") throw new Error("kit not open");
      return result.content.assets.map((asset) => asset.title);
    };
    expect(await opened()).not.toContain(privateFile.title);
    expect(await opened()).not.toContain(example.title);
    expect(await publicBrandFileLink("suzu-coffee", privateFile.id, "download")).toBeNull();

    const content = await loadBrandKitContent((await findBrandKit(kit.id))!);
    const logoSection = content.sections.find((section) => section.title === "logo")!;
    await createBrandRule(logoSection, { verdict: "dont", text: "Đừng kéo giãn logo", textEn: null, exampleAssetId: example.id });
    expect(await opened()).toContain(example.title);
    // Drawn beside the rule, never offered as a download.
    expect(await publicBrandFileLink("suzu-coffee", example.id, "preview")).toMatch(/^https:\/\/storage\.invalid\/download\//);
    expect(await publicBrandFileLink("suzu-coffee", example.id, "download")).toBeNull();
  });

  it("opens no file of a kit under another kit's address", async () => {
    const other = await createBrandKit({ name: "Other", slug: "other-brand", entityId: null }, [], actor);
    await updateBrandKitDetails(other.id, { ...details(), name: "Other", slug: "other-brand", visibility: "listed" });
    const [logo] = (await loadBrandKitContent(kit)).assets.filter((asset) => asset.kind === "logo");
    expect(await publicBrandFileLink("other-brand", logo.id, "download")).toBeNull();
  });

  it("counts a download, not a picture drawn on the page", async () => {
    const [logo] = (await loadBrandKitContent(kit)).assets.filter((asset) => asset.kind === "logo");
    await publicBrandFileLink("suzu-coffee", logo.id, "download");
    await publicBrandFileLink("suzu-coffee", logo.id, "download");
    await publicBrandFileLink("suzu-coffee", logo.id, "preview");
    const totals = await downloadTotalsByAsset(kit.id, "2999-01-01");
    expect(totals.get(logo.id)?.total).toBe(2);
    const content = await loadBrandKitContent(kit);
    expect((await totalsByKit([kit.id])).get(kit.id)).toEqual({ sections: content.sections.length, files: content.assets.length, downloads: 2 });
  });

  it("keeps a private file private even when a rule cites it, and draws nothing but pictures (BRD-01)", async () => {
    const working = await upload("price list.pdf", pdf, { kind: "brochure", isPublic: false });
    const brochure = await upload("brochure.pdf", pdf, { kind: "brochure" });
    const content = await loadBrandKitContent((await findBrandKit(kit.id))!);
    const logoSection = content.sections.find((section) => section.title === "logo")!;
    // Citing a file as a rule's "example" is not a way to hand it out: only a picture illustrates.
    await createBrandRule(logoSection, { verdict: "do", text: "Xem bảng giá", textEn: null, exampleAssetId: working.id });
    const opened = await openPublicBrandKit("suzu-coffee");
    expect(opened?.kind === "kit" && opened.content.assets.map((asset) => asset.title)).not.toContain(working.title);
    // The same nothing as a hidden kit's file or an id nobody has.
    for (const purpose of ["preview", "download"] as const) expect(await publicBrandFileLink("suzu-coffee", working.id, purpose)).toBeNull();
    // A private picture no rule shows is not drawn either.
    const unshown = content.assets.find((asset) => asset.title === "working file.png")!;
    expect(await publicBrandFileLink("suzu-coffee", unshown.id, "preview")).toBeNull();
    // "Preview" draws pictures: a public brochure is downloaded, and counted, or not had at all.
    expect(await publicBrandFileLink("suzu-coffee", brochure.id, "preview")).toBeNull();
    expect(await publicBrandFileLink("suzu-coffee", brochure.id, "download")).toMatch(/^https:\/\/storage\.invalid\/download\//);
  });

  it("counts every request against its visitor, and stops answering past the hour's allowance (BRD-01)", async () => {
    const [logo] = (await loadBrandKitContent(kit)).assets.filter((asset) => asset.kind === "logo");
    const visitor = { ipHash: "0123456789abcdef" };
    const at = new Date("2026-10-05T03:10:00Z");
    const downloads = async () => (await downloadTotalsByAsset(kit.id, "2999-01-01")).get(logo.id)?.total ?? 0;
    const before = await downloads();
    for (let hit = 1; hit < BRAND_FILE_LIMITS.download.max; hit += 1) await countBrandFileHit("download", brandVisitorKey(visitor.ipHash, at), at);
    expect(await servePublicBrandFile("suzu-coffee", logo.id, "download", visitor, at)).toEqual({ ok: true, url: expect.stringMatching(/^https:\/\/storage\.invalid\/download\//) });
    // One past the allowance: no link is signed and no download is counted, until the window ends.
    expect(await servePublicBrandFile("suzu-coffee", logo.id, "download", visitor, at)).toEqual({ ok: false, retryAfterSeconds: 50 * 60 });
    expect(await downloads()).toBe(before + 1);
    // Pictures have their own allowance, another visitor has theirs, and the next hour starts afresh.
    expect((await servePublicBrandFile("suzu-coffee", logo.id, "preview", visitor, at)).ok).toBe(true);
    expect((await servePublicBrandFile("suzu-coffee", logo.id, "download", { ipHash: "fedcba9876543210" }, at)).ok).toBe(true);
    expect((await servePublicBrandFile("suzu-coffee", logo.id, "download", visitor, new Date("2026-10-05T04:00:00Z"))).ok).toBe(true);
    // A guessed id is counted like any request, and answered with nothing.
    expect(await servePublicBrandFile("suzu-coffee", crypto.randomUUID(), "preview", visitor, at)).toEqual({ ok: true, url: null });

    // What was kept is a daily key, never the visitor's own hash — and it goes after a week.
    const hits = await db().select().from(schema.brandFileHit);
    expect(hits.some((row) => row.keyHash === visitor.ipHash)).toBe(false);
    expect(await purgeBrandFileHits(new Date("2026-10-06T00:00:00Z"))).toBe(0);
    expect(await purgeBrandFileHits(new Date("2026-10-20T00:00:00Z"))).toBe(hits.length);
  });
});

describe("sections", () => {
  it("move up and down, the first not up, the last not down", async () => {
    const before = (await loadBrandKitContent(kit)).sections.map((section) => section.title);
    const second = (await loadBrandKitContent(kit)).sections[1];
    await moveBrandSection(second.id, "up");
    const after = (await loadBrandKitContent(kit)).sections.map((section) => section.title);
    expect(after).toEqual([before[1], before[0], ...before.slice(2)]);
    await moveBrandSection(second.id, "up");
    expect((await loadBrandKitContent(kit)).sections.map((section) => section.title)).toEqual(after);
  });

  it("take their rules with them but leave their files in the kit", async () => {
    const content = await loadBrandKitContent(kit);
    const logoSection = content.sections.find((section) => section.title === "logo")!;
    await db().update(schema.brandAsset).set({ sectionId: logoSection.id }).where(eq(schema.brandAsset.brandId, kit.id));
    await deleteBrandSection(logoSection.id);
    const left = await loadBrandKitContent(kit);
    expect(left.rules.filter((rule) => rule.sectionId === logoSection.id)).toEqual([]);
    expect(left.assets.length).toBe(content.assets.length);
    expect(left.assets.every((asset) => asset.sectionId === null)).toBe(true);
  });
});

describe("deleting a kit", () => {
  it("is refused while it holds files", async () => {
    expect(await fails(deleteBrandKit(kit.id))).toBe("brand_has_files");
  });
});
