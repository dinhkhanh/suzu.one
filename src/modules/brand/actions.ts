"use server";
// Brand kits (FR-BRD-01..06): keep a kit's details, palette and typefaces, its guideline sections
// and their do's and don'ts, and its files. Every action is `brand:manage` over the kit's entity.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { createDownloadLink, findFile } from "@/modules/platform/files/service";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { BRAND_ASSET_KINDS, BRAND_LIMITS, BRAND_RULE_VERDICTS, BRAND_SECTION_KINDS, BRAND_VISIBILITIES, STARTER_SECTIONS } from "./enums";
import { brandSlugFrom, cleanFonts, cleanPalette, isWebUrl } from "./engine/kit";
import { canManageBrandKit } from "./policy";
import {
  allBrandAssets,
  beginBrandAssetUpload,
  completeBrandAssetUpload,
  createBrandKit,
  createBrandRule,
  createBrandSection,
  deleteBrandAsset,
  deleteBrandKit,
  deleteBrandRule,
  deleteBrandSection,
  findBrandAsset,
  findBrandKit,
  findBrandRule,
  findBrandSection,
  moveBrandSection,
  updateBrandAsset,
  updateBrandKitDetails,
  updateBrandKitStyle,
  updateBrandRule,
  updateBrandSection,
} from "./service";

// A checkbox posts "on" when ticked and nothing when not; JSON callers may send a boolean.
const checkbox = z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((value) => value === true || value === "on");
/** Blank and absent are both "no value". */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value) => (value ? value : null));
const optionalId = z.union([z.uuid(), z.literal("")]).nullish().transform((value) => (value ? value : null));
const webUrl = optionalText(BRAND_LIMITS.url).refine((value) => value === null || isWebUrl(value), { message: "invalid_url" });

const keeps = async (user: CurrentUser, kitId: string) => {
  const kit = await findBrandKit(kitId);
  return !!kit && canManageBrandKit(user.principal, kit);
};
const kitOrFail = async (kitId: string) => {
  const kit = await findBrandKit(kitId);
  if (!kit) throw new ActionError("brand_not_found");
  return kit;
};
const refresh = (kitId?: string) => {
  revalidatePath("/admin/brands");
  if (kitId) revalidatePath(`/admin/brands/${kitId}`);
};
const kitResource = (kit: { id: string; entityId: string | null }) => ({ type: "brand_kit", id: kit.id, entityId: kit.entityId });

// ── Kits ────────────────────────────────────────────────────────────────────────────────────

const createKitPipeline = createAction({
  name: "brand.kit.create",
  input: z.object({ name: z.string().trim().min(1).max(BRAND_LIMITS.name), slug: optionalText(BRAND_LIMITS.slug), entityId: optionalId }),
  authorize: (user, input) => canManageBrandKit(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    // The usual chapters, titled in both languages, ready to be written. Read from the two
    // catalogues themselves: the request's translator speaks only the reader's language.
    const [vi, en] = await Promise.all([import("../../../messages/vi.json"), import("../../../messages/en.json")]);
    const titleIn = (catalogue: typeof vi, key: string) => (catalogue.default.brands.starter as Record<string, string>)[key] ?? key;
    const starter = STARTER_SECTIONS.map((section) => ({ kind: section.kind, title: titleIn(vi, section.key), titleEn: titleIn(en, section.key) }));
    const kit = await createBrandKit({ name: input.name, slug: brandSlugFrom(input.slug, input.name), entityId: input.entityId }, starter, { personId: user.person.id, email: user.email });
    refresh();
    return { data: { id: kit.id }, audit: { resource: kitResource(kit), summary: `${kit.name} (/${kit.slug})` } };
  },
});

export async function createBrandKitAction(input: unknown) {
  return createKitPipeline(input);
}

const detailsPipeline = createAction({
  name: "brand.kit.update",
  input: z.object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(BRAND_LIMITS.name),
    slug: z.string().trim().max(BRAND_LIMITS.slug),
    tagline: optionalText(BRAND_LIMITS.tagline),
    description: optionalText(BRAND_LIMITS.description),
    descriptionEn: optionalText(BRAND_LIMITS.description),
    websiteUrl: webUrl,
    contactEmail: optionalText(BRAND_LIMITS.email).refine((value) => value === null || z.email().safeParse(value).success, { message: "invalid_email" }),
    visibility: z.enum(BRAND_VISIBILITIES),
    entityId: optionalId,
  }),
  // Moving a kit to another company needs the grant over both.
  authorize: async (user, input) => (await keeps(user, input.id)) && canManageBrandKit(user.principal, { entityId: input.entityId }),
  run: async ({ input: { id, ...input } }) => {
    const { before, after } = await updateBrandKitDetails(id, { ...input, slug: brandSlugFrom(input.slug, input.name) });
    refresh(id);
    const summary = [before.visibility !== after.visibility && `${before.visibility} → ${after.visibility}`, before.slug !== after.slug && `/${before.slug} → /${after.slug}`].filter(Boolean).join(" · ");
    return { data: { slug: after.slug }, audit: { resource: kitResource(after), summary: summary || after.name } };
  },
});

export async function updateBrandKitDetailsAction(input: unknown) {
  return detailsPipeline(input);
}

/** The palette and the typefaces arrive as JSON from the list editors. */
const jsonList = z.string().transform((value, context) => {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) return parsed as Record<string, string | null>[];
  } catch {
    // reported below
  }
  context.addIssue({ code: "custom", message: "invalid_json" });
  return z.NEVER;
});

const stylePipeline = createAction({
  name: "brand.kit.style",
  input: z.object({ id: z.uuid(), colors: jsonList, fonts: jsonList }),
  authorize: (user, input) => keeps(user, input.id),
  run: async ({ input }) => {
    const palette = cleanPalette(input.colors);
    if (!palette.ok) throw new ActionError(palette.problem);
    const fonts = cleanFonts(input.fonts);
    if (!fonts.ok) throw new ActionError(fonts.problem);
    const kit = await updateBrandKitStyle(input.id, { colors: palette.colors, fonts: fonts.fonts });
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: palette.colors.map((color) => color.hex).join(" ") } };
  },
});

export async function updateBrandKitStyleAction(input: unknown) {
  return stylePipeline(input);
}

const deleteKitPipeline = createAction({
  name: "brand.kit.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => keeps(user, input.id),
  run: async ({ input }) => {
    const kit = await deleteBrandKit(input.id);
    refresh();
    return { data: null, audit: { resource: kitResource(kit), summary: kit.name } };
  },
});

export async function deleteBrandKitAction(input: unknown) {
  return deleteKitPipeline(input);
}

// ── Sections ────────────────────────────────────────────────────────────────────────────────

const sectionKeeps = async (user: CurrentUser, sectionId: string) => {
  const section = await findBrandSection(sectionId);
  return !!section && (await keeps(user, section.brandId));
};

const createSectionPipeline = createAction({
  name: "brand.section.create",
  input: z.object({ kitId: z.uuid(), kind: z.enum(BRAND_SECTION_KINDS), title: z.string().trim().min(1).max(BRAND_LIMITS.sectionTitle), titleEn: optionalText(BRAND_LIMITS.sectionTitle) }),
  authorize: (user, input) => keeps(user, input.kitId),
  run: async ({ input: { kitId, ...input } }) => {
    const kit = await kitOrFail(kitId);
    const section = await createBrandSection(kitId, input);
    refresh(kitId);
    return { data: { id: section.id }, audit: { resource: kitResource(kit), summary: section.title } };
  },
});

export async function createBrandSectionAction(input: unknown) {
  return createSectionPipeline(input);
}

const updateSectionPipeline = createAction({
  name: "brand.section.update",
  input: z.object({
    id: z.uuid(),
    kind: z.enum(BRAND_SECTION_KINDS),
    title: z.string().trim().min(1).max(BRAND_LIMITS.sectionTitle),
    titleEn: optionalText(BRAND_LIMITS.sectionTitle),
    body: optionalText(BRAND_LIMITS.sectionBody),
    bodyEn: optionalText(BRAND_LIMITS.sectionBody),
  }),
  authorize: (user, input) => sectionKeeps(user, input.id),
  run: async ({ input: { id, ...input } }) => {
    const { after } = await updateBrandSection(id, input);
    const kit = await kitOrFail(after.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: after.title } };
  },
});

export async function updateBrandSectionAction(input: unknown) {
  return updateSectionPipeline(input);
}

const moveSectionPipeline = createAction({
  name: "brand.section.move",
  input: z.object({ id: z.uuid(), direction: z.enum(["up", "down"]) }),
  authorize: (user, input) => sectionKeeps(user, input.id),
  run: async ({ input }) => {
    const section = await moveBrandSection(input.id, input.direction);
    const kit = await kitOrFail(section.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: `${section.title} ${input.direction}` } };
  },
});

export async function moveBrandSectionAction(input: unknown) {
  return moveSectionPipeline(input);
}

const deleteSectionPipeline = createAction({
  name: "brand.section.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => sectionKeeps(user, input.id),
  run: async ({ input }) => {
    const section = await deleteBrandSection(input.id);
    const kit = await kitOrFail(section.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: section.title } };
  },
});

export async function deleteBrandSectionAction(input: unknown) {
  return deleteSectionPipeline(input);
}

// ── Do's and don'ts ─────────────────────────────────────────────────────────────────────────

const ruleFields = {
  verdict: z.enum(BRAND_RULE_VERDICTS),
  text: z.string().trim().min(1).max(BRAND_LIMITS.ruleText),
  textEn: optionalText(BRAND_LIMITS.ruleText),
  exampleAssetId: optionalId,
};

const createRulePipeline = createAction({
  name: "brand.rule.create",
  input: z.object({ sectionId: z.uuid(), ...ruleFields }),
  authorize: (user, input) => sectionKeeps(user, input.sectionId),
  run: async ({ input: { sectionId, ...input } }) => {
    const section = await findBrandSection(sectionId);
    if (!section) throw new ActionError("section_not_found");
    const rule = await createBrandRule(section, input);
    const kit = await kitOrFail(section.brandId);
    refresh(kit.id);
    return { data: { id: rule.id }, audit: { resource: kitResource(kit), summary: `${section.title} · ${rule.verdict}` } };
  },
});

export async function createBrandRuleAction(input: unknown) {
  return createRulePipeline(input);
}

const ruleKeeps = async (user: CurrentUser, ruleId: string) => {
  const rule = await findBrandRule(ruleId);
  return !!rule && (await sectionKeeps(user, rule.sectionId));
};

const updateRulePipeline = createAction({
  name: "brand.rule.update",
  input: z.object({ id: z.uuid(), ...ruleFields }),
  authorize: (user, input) => ruleKeeps(user, input.id),
  run: async ({ input: { id, ...input } }) => {
    const rule = await findBrandRule(id);
    const section = rule && (await findBrandSection(rule.sectionId));
    if (!section) throw new ActionError("rule_not_found");
    const updated = await updateBrandRule(section, id, input);
    const kit = await kitOrFail(section.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: `${section.title} · ${updated.verdict}` } };
  },
});

export async function updateBrandRuleAction(input: unknown) {
  return updateRulePipeline(input);
}

const deleteRulePipeline = createAction({
  name: "brand.rule.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => ruleKeeps(user, input.id),
  run: async ({ input }) => {
    const rule = await deleteBrandRule(input.id);
    const section = await findBrandSection(rule.sectionId);
    const kit = section ? await findBrandKit(section.brandId) : undefined;
    if (kit) refresh(kit.id);
    return { data: null, audit: { resource: kit ? kitResource(kit) : { type: "brand_kit", id: rule.sectionId, entityId: null }, summary: rule.verdict } };
  },
});

export async function deleteBrandRuleAction(input: unknown) {
  return deleteRulePipeline(input);
}

// ── Files ───────────────────────────────────────────────────────────────────────────────────

const beginUploadPipeline = createAction({
  name: "brand.asset.begin",
  input: z.object({ kitId: z.uuid(), fileName: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive() }),
  authorize: (user, input) => keeps(user, input.kitId),
  run: async ({ user, input }) => {
    const kit = await kitOrFail(input.kitId);
    const upload = await beginBrandAssetUpload(kit, input, { personId: user.person.id, email: user.email });
    return { data: upload, audit: { resource: { type: "stored_file", id: upload.fileId, entityId: kit.entityId }, summary: input.fileName } };
  },
});

export async function beginBrandAssetUploadAction(input: unknown) {
  return beginUploadPipeline(input);
}

const assetFields = {
  title: z.string().trim().min(1).max(BRAND_LIMITS.assetTitle),
  kind: z.enum(BRAND_ASSET_KINDS),
  isPublic: checkbox,
  sectionId: optionalId,
};

const completeUploadPipeline = createAction({
  name: "brand.asset.complete",
  input: z.object({ kitId: z.uuid(), fileId: z.uuid(), ...assetFields }),
  authorize: (user, input) => keeps(user, input.kitId),
  run: async ({ user, input: { kitId, fileId, ...details } }) => {
    const kit = await kitOrFail(kitId);
    const asset = await completeBrandAssetUpload(kit, fileId, details, { personId: user.person.id, email: user.email });
    refresh(kitId);
    return { data: { id: asset.id }, audit: { resource: kitResource(kit), summary: `${asset.kind} · ${asset.title}` } };
  },
});

export async function completeBrandAssetUploadAction(input: unknown) {
  return completeUploadPipeline(input);
}

const assetKeeps = async (user: CurrentUser, assetId: string) => {
  const asset = await findBrandAsset(assetId);
  return !!asset && (await keeps(user, asset.brandId));
};

const updateAssetPipeline = createAction({
  name: "brand.asset.update",
  input: z.object({ id: z.uuid(), ...assetFields, sortOrder: z.coerce.number().int().min(0).max(100_000).default(0) }),
  authorize: (user, input) => assetKeeps(user, input.id),
  run: async ({ input: { id, ...input } }) => {
    const { after } = await updateBrandAsset(id, input);
    const kit = await kitOrFail(after.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: `${after.kind} · ${after.title}${after.isPublic ? "" : " (private)"}` } };
  },
});

export async function updateBrandAssetAction(input: unknown) {
  return updateAssetPipeline(input);
}

const deleteAssetPipeline = createAction({
  name: "brand.asset.delete",
  input: z.object({ id: z.uuid() }),
  authorize: (user, input) => assetKeeps(user, input.id),
  run: async ({ input }) => {
    const asset = await deleteBrandAsset(input.id);
    const kit = await kitOrFail(asset.brandId);
    refresh(kit.id);
    return { data: null, audit: { resource: kitResource(kit), summary: asset.title } };
  },
});

export async function deleteBrandAssetAction(input: unknown) {
  return deleteAssetPipeline(input);
}

/** A one-minute link for the keeper's own look at a file, hidden kit or private file included. */
const openAssetPipeline = createAction({
  name: "brand.asset.open",
  input: z.object({ fileId: z.uuid() }),
  authorize: async (user, input) => {
    const asset = (await allBrandAssets()).find((candidate) => candidate.fileId === input.fileId);
    return !!asset && (await keeps(user, asset.brandId));
  },
  run: async ({ user, input }) => {
    const file = await findFile(input.fileId);
    if (!file) throw new ActionError("file_not_found");
    const url = await createDownloadLink(file, { personId: user.person.id, email: user.email }, user.request);
    return { data: { url }, audit: { resource: { type: "stored_file", id: file.id, entityId: file.entityId }, summary: file.fileName } };
  },
});

export async function openBrandAssetAction(input: unknown) {
  return openAssetPipeline(input);
}
