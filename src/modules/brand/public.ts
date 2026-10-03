import "server-only";
// The brand guidelines on the public domain (FR-BRD-04, suzu.vn/brands) — read by anyone, signed
// in or not. Everything here is written on the assumption that the visitor is a stranger:
//
//   · **Only what the keeper published leaves.** A hidden kit and a slug nobody ever used are the
//     same "not found". Of an open kit, a file is handed out when it is public and not a mere
//     example picture, and an example picture only while a rule of that kit shows it.
//   · **No internal identifier but the file's own.** A kit is addressed by its slug; a file by its
//     id under that slug, so a file id from another kit opens nothing.
//   · **The bytes never pass through the app.** A request for a file is answered with a redirect to
//     a short-lived signed link on the storage's domain; the object is stored as an attachment, so
//     even an SVG opened there is a download, never a page of ours.
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { createPublicDownloadLink, findFile } from "../platform/files/service";
import { coverAssetOf, isDownloadable, isOpenToPublic, resolveBrandSlug } from "./engine/kit";
import { allBrandAssets, allBrandKits, type BrandAssetView, type BrandKitContent, type BrandKitRow, loadBrandKitContent } from "./service";

/** How long a signed link to a kit's file works: long enough for a slow connection to start. */
const LINK_SECONDS = 5 * 60;

export type PublicBrandCard = { slug: string; name: string; tagline: string | null; cover: Pick<BrandAssetView, "id" | "fileName"> | null };

/** The list of brands: the listed kits, each with the logo that stands for it. */
export async function listPublicBrandKits(): Promise<PublicBrandCard[]> {
  const [kits, assets] = await Promise.all([allBrandKits(), allBrandAssets()]);
  return kits
    .filter((kit) => kit.visibility === "listed")
    .map((kit) => {
      const cover = coverAssetOf(assets.filter((asset) => asset.brandId === kit.id));
      return { slug: kit.slug, name: kit.name, tagline: kit.tagline, cover: cover ? { id: cover.id, fileName: cover.fileName } : null };
    });
}

/**
 * The kit an address names, when the public may open it: its content cut down to what the public
 * may have, or a redirect to its current address, or nothing.
 */
export async function openPublicBrandKit(slug: string): Promise<{ kind: "kit"; content: BrandKitContent } | { kind: "moved"; slug: string } | null> {
  const resolved = resolveBrandSlug((await allBrandKits()).filter((kit) => isOpenToPublic(kit.visibility)), slug);
  if (!resolved) return null;
  if (resolved.redirect) return { kind: "moved", slug: resolved.kit.slug };
  return { kind: "kit", content: publicPart(await loadBrandKitContent(resolved.kit)) };
}

/** What of a kit's content the public sees: every section and rule, and only the files it may have. */
function publicPart(content: BrandKitContent): BrandKitContent {
  const shown = new Set(content.rules.map((rule) => rule.exampleAssetId).filter(Boolean));
  return { ...content, assets: content.assets.filter((asset) => isDownloadable(asset) || shown.has(asset.id)) };
}

/**
 * A signed link to one file of an open kit, or null. `download` counts it as a download (the
 * button on the page); a picture drawn on the page (`preview`) is not counted.
 */
export async function publicBrandFileLink(slug: string, assetId: string, purpose: "download" | "preview"): Promise<string | null> {
  const opened = await openPublicBrandKit(slug);
  if (opened?.kind !== "kit") return null;
  const asset = opened.content.assets.find((candidate) => candidate.id === assetId);
  // An example picture is drawn beside its rule; it is not handed out as a download.
  if (!asset || (purpose === "download" && !isDownloadable(asset))) return null;
  const file = await findFile(asset.fileId);
  if (!file) return null;
  if (purpose === "download") await countDownload(asset.id);
  return createPublicDownloadLink(file, LINK_SECONDS);
}

/** One more download of the file today: a single upsert that cannot race. */
async function countDownload(assetId: string): Promise<void> {
  await db()
    .insert(schema.brandAssetDownload)
    .values({ assetId, day: sql`current_date`, downloads: 1 })
    .onConflictDoUpdate({ target: [schema.brandAssetDownload.assetId, schema.brandAssetDownload.day], set: { downloads: sql`${schema.brandAssetDownload.downloads} + 1` } });
}

export type { BrandKitRow };
