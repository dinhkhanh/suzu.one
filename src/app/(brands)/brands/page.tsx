import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { listPublicBrandKits } from "@/modules/brand/public";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("brands.public");
  return { title: { absolute: t("metaTitle") }, robots: { index: true, follow: true } };
}

// Every listed brand (FR-BRD-04), each with the logo that stands for it. The only identifiers on
// this page are slugs and the cover file's id under its slug.
export default async function BrandsPage() {
  const [t, kits] = await Promise.all([getTranslations("brands.public"), listPublicBrandKits()]);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex max-w-2xl flex-col gap-2">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      {kits.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noBrands")}</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {kits.map((kit, index) => (
            <li key={kit.slug} className="rise" style={{ "--i": index } as React.CSSProperties}>
              <Link href={`/brands/${kit.slug}`} className="press group flex h-full flex-col overflow-hidden rounded-[14px] border border-border bg-background transition-colors hover:border-foreground/25">
                <span className="flex aspect-[16/10] items-center justify-center border-b border-border bg-canvas p-8">
                  {kit.cover ? (
                    // A signed link on the storage's domain; an SVG drawn by <img> runs nothing.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/brands/${kit.slug}/files/${kit.cover.id}?preview=1`} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                  ) : (
                    <span className="text-2xl font-semibold tracking-tight text-muted-foreground">{kit.name}</span>
                  )}
                </span>
                <span className="flex flex-1 flex-col gap-1 p-4">
                  <span className="font-semibold">{kit.name}</span>
                  {kit.tagline ? <span className="text-sm text-muted-foreground">{kit.tagline}</span> : null}
                  <span className="mt-auto pt-2 text-[0.8125rem] font-medium text-link group-hover:underline">{t("viewGuideline")}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
