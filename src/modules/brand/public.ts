import "server-only";
// The brand guidelines on the public domain (FR-BRD-04, suzu.vn/brands) — read by anyone, signed
// in or not. Everything here is written on the assumption that the visitor is a stranger:
//
//   · **Only what the keeper published leaves.** A hidden kit and a slug nobody ever used are the
//     same "not found". Of an open kit, a file is handed out when it is public and not a mere
//     example picture; a picture is drawn beside a rule only while a rule of that kit cites it —
//     and only a picture: a private brochure a rule happens to cite is as absent as a hidden kit.
//     `?preview=1` draws pictures and nothing else, so it is not a second, uncounted download.
//   · **A stranger cannot make the product work for free.** Every request for a file is counted
//     per visitor before anything is read or signed (`BRAND_FILE_LIMITS`), like the careers page.
//   · **No internal identifier but the file's own.** A kit is addressed by its slug; a file by its
//     id under that slug, so a file id from another kit opens nothing.
//   · **The bytes never pass through the app.** A request for a file is answered with a redirect to
//     a short-lived signed link on the storage's domain; the object is stored as an attachment, so
//     even an SVG opened there is a download, never a page of ours.
import { sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { RateLimitOutcome, Visitor } from "@/lib/public-action";
import { createPublicDownloadLink, findFile } from "../platform/files/service";
import { coverAssetOf, hasThumbnail, isDownloadable, isIllustration, isOpenToPublic, resolveBrandSlug } from "./engine/kit";
import { BRAND_FILE_LIMITS, type BrandFileBucket, brandVisitorKey, retryAfterSeconds, windowStartFor, withinLimit } from "./engine/rate-limit";
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

/**
 * What of a kit's content the public sees: every section and rule, and only the files it may have —
 * the downloads, and the pictures its own rules show (`content.rules` holds the rules of this kit's
 * sections and no other's).
 */
function publicPart(content: BrandKitContent): BrandKitContent {
  const cited = new Set(content.rules.flatMap((rule) => (rule.exampleAssetId ? [rule.exampleAssetId] : [])));
  return { ...content, assets: content.assets.filter((asset) => isDownloadable(asset) || isIllustration(asset, cited)) };
}

/**
 * Counts one request for a file and says whether it is allowed — one row per (bucket, visitor,
 * window), one atomic upsert that cannot race, and the returned count already includes this call.
 * `keyHash` is the visitor's daily key (`brandVisitorKey`); nothing readable is ever passed in.
 */
export async function countBrandFileHit(bucket: BrandFileBucket, keyHash: string, at: Date = new Date()): Promise<RateLimitOutcome> {
  const limit = BRAND_FILE_LIMITS[bucket];
  const windowStart = windowStartFor(at, limit.windowSeconds);
  const [row] = await db()
    .insert(schema.brandFileHit)
    .values({ bucket, keyHash, windowStart, hits: 1, lastAt: at })
    .onConflictDoUpdate({ target: [schema.brandFileHit.bucket, schema.brandFileHit.keyHash, schema.brandFileHit.windowStart], set: { hits: sql`${schema.brandFileHit.hits} + 1`, lastAt: at } })
    .returning({ hits: schema.brandFileHit.hits });
  return withinLimit(row?.hits ?? 1, limit) ? { ok: true } : { ok: false, retryAfterSeconds: retryAfterSeconds(at, limit.windowSeconds) };
}

/**
 * What the file route answers a visitor with: the link, nothing (`url: null` — every way a file
 * cannot be had is this one answer), or "slow down". The request is counted first, whatever it
 * asks for, so guessing ids costs the guesser their allowance and the product nothing but one
 * upsert.
 */
export async function servePublicBrandFile(slug: string, assetId: string, purpose: BrandFileBucket, visitor: Pick<Visitor, "ipHash">, at: Date = new Date()): Promise<{ ok: true; url: string | null } | { ok: false; retryAfterSeconds: number }> {
  const allowed = await countBrandFileHit(purpose, brandVisitorKey(visitor.ipHash, at), at);
  if (!allowed.ok) return allowed;
  return { ok: true, url: await publicBrandFileLink(slug, assetId, purpose) };
}

/**
 * A signed link to one file of an open kit, or null. `download` counts it as a download (the
 * button on the page); a picture drawn on the page (`preview`) is not counted. The route reaches
 * this through `servePublicBrandFile`, which counts the request against the visitor first.
 */
export async function publicBrandFileLink(slug: string, assetId: string, purpose: BrandFileBucket): Promise<string | null> {
  const opened = await openPublicBrandKit(slug);
  if (opened?.kind !== "kit") return null;
  const asset = opened.content.assets.find((candidate) => candidate.id === assetId);
  // A download is a file the kit offers — an example picture is drawn beside its rule, never handed
  // out. A preview is a picture the page draws, a download's thumbnail or a rule's example: asking
  // to "preview" a brochure is asking to download it uncounted, and gets what a private file gets.
  if (!asset || (purpose === "download" ? !isDownloadable(asset) : !hasThumbnail(asset.fileName))) return null;
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
