import { ArrowLeftIcon, CheckIcon, DownloadIcon, ExternalLinkIcon, XIcon } from "lucide-react";
import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import type { BrandAssetKind } from "@/modules/brand/enums";
import { fileFormatOf, hasThumbnail, localized, placeAssets, prefersLightText, rgbOf, sectionAnchors } from "@/modules/brand/engine/kit";
import { openPublicBrandKit } from "@/modules/brand/public";
import type { BrandAssetView, BrandKitRow, BrandRuleRow, BrandSectionRow } from "@/modules/brand/service";
import { CopyButton } from "@/modules/brand/ui/copy-button";
import { formatBytes } from "@/modules/platform/files/preview";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";

/**
 * One brand's guideline on the public domain (FR-BRD-04): what the brand is, how to show it and
 * how not to, its colours and typefaces, and the files to download — in the order its keeper put
 * the sections. Built from the server alone, but for the button that copies a colour code.
 *
 * A kit that is hidden and a slug nobody used are the same 404. A former slug is sent on to the
 * current one (308), so a link printed before a rename still lands. A listed kit may be indexed;
 * one shared by link only may not.
 */
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9-]{1,80}$/;

async function open(slug: string) {
  if (!SLUG.test(slug)) notFound();
  const opened = await openPublicBrandKit(slug);
  if (!opened) notFound();
  if (opened.kind === "moved") permanentRedirect(`/brands/${opened.slug}`);
  return opened.content;
}

export async function generateMetadata({ params }: PageProps<"/brands/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const { kit } = await open(slug);
  const locale = await getLocale();
  const listed = kit.visibility === "listed";
  return {
    title: kit.name,
    description: kit.tagline ?? (kit.description ? localized(kit.description, kit.descriptionEn, locale).slice(0, 160) : undefined),
    robots: listed ? { index: true, follow: true } : { index: false, follow: false },
  };
}

type T = Awaited<ReturnType<typeof getTranslations<"brands.public">>>;

export default async function BrandKitPublicPage({ params }: PageProps<"/brands/[slug]">) {
  const { slug } = await params;
  const content = await open(slug);
  const [t, locale] = await Promise.all([getTranslations("brands.public"), getLocale()]);
  const { kit, sections, rules, assets } = content;
  const { bySection, rest } = placeAssets(sections, assets);
  const titles = sections.map((section) => localized(section.title, section.titleEn, locale));
  const anchors = sectionAnchors(titles);
  const cover = assets.find((asset) => asset.isPublic && asset.kind === "logo" && hasThumbnail(asset.fileName)) ?? null;
  const fileHref = (asset: BrandAssetView, preview = false) => `/brands/${kit.slug}/files/${asset.id}${preview ? "?preview=1" : ""}`;
  const description = kit.description ? localized(kit.description, kit.descriptionEn, locale) : null;

  return (
    <div className="flex flex-col gap-10">
      <Link href="/brands" className="-mb-6 flex items-center gap-1.5 self-start text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-3.5" aria-hidden />
        {t("allBrands")}
      </Link>

      {/* The brand, as it introduces itself. */}
      <header className="grid gap-6 md:grid-cols-[1fr_minmax(0,22rem)] md:items-center">
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="break-words">{kit.name}</h1>
          {kit.tagline ? <p className="text-[1.0625rem] text-muted-foreground">{kit.tagline}</p> : null}
          {description ? <p className="max-w-prose text-sm whitespace-pre-line">{description}</p> : null}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {assets.some((asset) => asset.isPublic && asset.kind !== "example") ? (
              <a href={`#${anchors[sections.findIndex((section) => section.kind === "downloads")] ?? "downloads"}`} className={buttonVariants({ variant: "default" })}>
                <DownloadIcon />
                {t("downloadAll")}
              </a>
            ) : null}
            {kit.websiteUrl ? (
              <a href={kit.websiteUrl} target="_blank" rel="noopener noreferrer nofollow" className={buttonVariants({ variant: "outline" })}>
                <ExternalLinkIcon />
                {t("website")}
              </a>
            ) : null}
          </div>
        </div>
        {cover ? (
          <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-[14px] border border-border bg-canvas p-10">
            {/* A signed link on the storage's domain; an SVG drawn by <img> runs nothing. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileHref(cover, true)} alt={kit.name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : null}
      </header>

      {kit.colors.length > 0 ? (
        <div aria-hidden className="-mt-4 flex h-2 overflow-hidden rounded-full">
          {kit.colors.map((color) => (
            <span key={color.hex + color.name} className="flex-1" style={{ background: color.hex }} />
          ))}
        </div>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-12">
        {/* Contents: a row that scrolls sideways on a phone, a column that stays put on a desk. */}
        {sections.length > 1 ? (
          <nav aria-label={t("contents")} className="min-w-0 lg:sticky lg:top-6 lg:self-start">
            <p className="section-label mb-2 hidden lg:block">{t("contents")}</p>
            <div className="tab-row lg:hidden">
              {sections.map((section, index) => (
                <a key={section.id} href={`#${anchors[index]}`}>
                  {titles[index]}
                </a>
              ))}
            </div>
            <ol className="hidden flex-col gap-0.5 text-sm lg:flex">
              {sections.map((section, index) => (
                <li key={section.id}>
                  <a href={`#${anchors[index]}`} className="block rounded-md px-2 py-1.5 text-muted-foreground hover:bg-canvas hover:text-foreground">
                    {titles[index]}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          <span className="hidden lg:block" />
        )}

        <div className="flex min-w-0 flex-col gap-14">
          {sections.map((section, index) => (
            <GuidelineSection
              key={section.id}
              t={t}
              locale={locale}
              kit={kit}
              section={section}
              title={titles[index]}
              anchor={anchors[index]}
              rules={rules.filter((rule) => rule.sectionId === section.id)}
              files={bySection.get(section.id) ?? []}
              assets={assets}
              fileHref={fileHref}
            />
          ))}
          {rest.length > 0 ? (
            <section id="downloads" className="flex scroll-mt-6 flex-col gap-4">
              <h2>{t("downloadAll")}</h2>
              <FileGroups t={t} files={rest} fileHref={fileHref} />
            </section>
          ) : null}
          {kit.contactEmail ? (
            <p className="border-t border-border pt-6 text-sm text-muted-foreground">
              {t.rich("contact", {
                email: kit.contactEmail,
                link: (chunks) => (
                  <a href={`mailto:${kit.contactEmail}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                    {chunks}
                  </a>
                ),
              })}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function GuidelineSection({
  t,
  locale,
  kit,
  section,
  title,
  anchor,
  rules,
  files,
  assets,
  fileHref,
}: {
  t: T;
  locale: string;
  kit: BrandKitRow;
  section: BrandSectionRow;
  title: string;
  anchor: string;
  rules: BrandRuleRow[];
  files: BrandAssetView[];
  assets: BrandAssetView[];
  fileHref: (asset: BrandAssetView, preview?: boolean) => string;
}) {
  const body = section.body ? localized(section.body, section.bodyEn, locale) : null;
  return (
    <section id={anchor} className="flex scroll-mt-6 flex-col gap-5">
      <h2 className="text-[1.375rem] font-semibold tracking-[-0.015em]">{title}</h2>
      {body ? <RichText text={body} className="max-w-prose text-[0.9375rem]" /> : null}

      {section.kind === "palette" ? <Palette t={t} kit={kit} /> : null}
      {section.kind === "typography" ? <Typefaces t={t} kit={kit} /> : null}

      {rules.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rules.map((rule) => {
            const example = rule.exampleAssetId ? assets.find((asset) => asset.id === rule.exampleAssetId) : undefined;
            const good = rule.verdict === "do";
            return (
              <li key={rule.id} className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-background">
                {example && hasThumbnail(example.fileName) ? (
                  <div className="flex aspect-[4/3] items-center justify-center border-b border-border bg-canvas p-6">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={fileHref(example, true)} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                  </div>
                ) : null}
                <div className={cn("flex flex-1 flex-col gap-1.5 border-t-[3px] p-4", example ? "border-t-transparent" : "", good ? "border-success" : "border-destructive")}>
                  <span className={cn("flex items-center gap-1.5 text-[0.8125rem] font-semibold tracking-wide uppercase", good ? "text-success" : "text-destructive")}>
                    {good ? <CheckIcon className="size-4" aria-hidden /> : <XIcon className="size-4" aria-hidden />}
                    {good ? t("do") : t("dont")}
                  </span>
                  <p className="text-sm">{localized(rule.text, rule.textEn, locale)}</p>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      {section.kind === "downloads" ? (
        files.length > 0 ? (
          <FileGroups t={t} files={files} fileHref={fileHref} />
        ) : (
          <p className="text-sm text-muted-foreground">{t("noFiles")}</p>
        )
      ) : files.length > 0 ? (
        <FileGrid t={t} files={files} fileHref={fileHref} />
      ) : null}
    </section>
  );
}

function Palette({ t, kit }: { t: T; kit: BrandKitRow }) {
  if (kit.colors.length === 0) return <p className="text-sm text-muted-foreground">{t("noPalette")}</p>;
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {kit.colors.map((color) => (
        <li key={color.hex + color.name} className="flex flex-col overflow-hidden rounded-[14px] border border-border bg-background">
          <div className={cn("flex aspect-[3/2] items-end p-3 text-sm font-semibold", prefersLightText(color.hex) ? "text-white" : "text-[#1A1A1A]")} style={{ background: color.hex }}>
            {color.name}
          </div>
          <dl className="flex flex-col gap-0.5 p-3 text-xs">
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t("hex")}</dt>
              <dd className="flex items-center gap-1 font-mono">
                {color.hex}
                <CopyButton value={color.hex} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt className="text-muted-foreground">{t("rgb")}</dt>
              <dd className="font-mono">{rgbOf(color.hex)}</dd>
            </div>
            {color.note ? <dd className="pt-1 text-muted-foreground">{color.note}</dd> : null}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Typefaces({ t, kit }: { t: T; kit: BrandKitRow }) {
  if (kit.fonts.length === 0) return <p className="text-sm text-muted-foreground">{t("noFonts")}</p>;
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {kit.fonts.map((font) => (
        <li key={font.name} className="flex flex-col gap-2 rounded-[14px] border border-border bg-background p-4">
          <span className="text-3xl font-semibold tracking-tight" aria-hidden>
            Aa
          </span>
          <span className="font-semibold">{font.name}</span>
          {font.usage ? <span className="text-sm text-muted-foreground">{font.usage}</span> : null}
          {font.url ? (
            <a href={font.url} target="_blank" rel="noopener noreferrer nofollow" className="mt-auto flex items-center gap-1 pt-1 text-[0.8125rem] font-medium text-link hover:underline">
              {t("getFont")}
              <ExternalLinkIcon className="size-3.5" aria-hidden />
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Files as cards with their picture: the logos of a Logo section, the brochures of another. */
function FileGrid({ t, files, fileHref }: { t: T; files: BrandAssetView[]; fileHref: (asset: BrandAssetView, preview?: boolean) => string }) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {files.map((file) => (
        <li key={file.id} className="flex min-w-0 flex-col overflow-hidden rounded-[14px] border border-border bg-background">
          {/* A picture gets a square; a PDF or a ZIP has only its format to show. */}
          <div className={cn("flex items-center justify-center border-b border-border bg-canvas p-5", hasThumbnail(file.fileName) ? "aspect-square" : "aspect-[2/1]")}>
            {hasThumbnail(file.fileName) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fileHref(file, true)} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
            ) : (
              <span className="font-mono text-lg font-medium text-muted-foreground">{fileFormatOf(file.fileName)}</span>
            )}
          </div>
          <div className="flex flex-1 flex-col gap-2 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium" title={file.title}>
                {file.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {fileFormatOf(file.fileName)} · {formatBytes(file.sizeBytes)}
              </p>
            </div>
            <a href={fileHref(file)} rel="nofollow" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-auto w-full" })}>
              <DownloadIcon />
              {t("download")}
            </a>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** The downloads section: every file it holds, grouped by what it is. */
function FileGroups({ t, files, fileHref }: { t: T; files: BrandAssetView[]; fileHref: (asset: BrandAssetView, preview?: boolean) => string }) {
  const groups = new Map<BrandAssetKind, BrandAssetView[]>();
  for (const file of files) groups.set(file.kind, [...(groups.get(file.kind) ?? []), file]);
  return (
    <div className="flex flex-col gap-6">
      {[...groups].map(([kind, group]) => (
        <div key={kind} className="flex flex-col gap-3">
          <h3 className="section-label">{t(`kinds.${kind}`)}</h3>
          <FileGrid t={t} files={group} fileHref={fileHref} />
        </div>
      ))}
    </div>
  );
}
