"use client";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createBrandKitAction, deleteBrandKitAction, updateBrandKitDetailsAction, updateBrandKitStyleAction } from "../actions";
import { BRAND_LIMITS, BRAND_VISIBILITIES, MAX_BRAND_COLORS, MAX_BRAND_FONTS } from "../enums";
import { brandSlugFrom, normalizeHex } from "../engine/kit";
import type { BrandColor, BrandFont } from "../schema";
import type { BrandKitRow } from "../service";

type EntityOption = { id: string; name: string };

/** The company a brand belongs to; "the whole group" only for someone whose grant reaches it. */
function useEntityOptions(entities: readonly EntityOption[], allowGroup: boolean) {
  const t = useTranslations("brands");
  return [...(allowGroup ? [<option key="" value="">{t("wholeGroup")}</option>] : []), ...entities.map((entity) => <option key={entity.id} value={entity.id}>{entity.name}</option>)];
}

/** The address the kit will have, as it is typed. */
function AddressPreview({ origin, slug }: { origin: string; slug: string }) {
  const t = useTranslations("brands");
  return (
    <p className="text-xs text-muted-foreground">
      {t("addressPreview")} <span className="font-mono text-foreground">{`${origin.replace(/^https?:\/\//, "")}/brands/${slug || "…"}`}</span>
    </p>
  );
}

export function CreateBrandKitForm({ origin, entities, allowGroup }: { origin: string; entities: EntityOption[]; allowGroup: boolean }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const entityOptions = useEntityOptions(entities, allowGroup);
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(createBrandKitAction, { onSuccess: (data) => router.push(`/admin/brands/${data.id}`) });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="name" label={t("name")}>
            <Input id="name" name="name" required maxLength={BRAND_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} placeholder={t("namePlaceholder")} />
          </Field>
          <Field name="slug" label={t("slug")}>
            <Input id="slug" name="slug" maxLength={BRAND_LIMITS.slug} value={slug} onChange={(event) => setSlug(event.target.value)} placeholder={brandSlugFrom(null, name) || "suzu-coffee"} className="font-mono" />
          </Field>
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" defaultValue={allowGroup ? "" : (entities[0]?.id ?? "")}>
              {entityOptions}
            </Select>
          </Field>
        </div>
      </FieldErrors>
      <AddressPreview origin={origin} slug={brandSlugFrom(slug, name)} />
      <FormError namespace="brands.errors" errorKey={errorKey} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending || saved} size="lg" className="w-full md:w-auto">
          {pending ? t("creating") : t("create")}
        </Button>
      </div>
    </form>
  );
}

export function KitDetailsForm({ kit, origin, entities, allowGroup }: { kit: BrandKitRow; origin: string; entities: EntityOption[]; allowGroup: boolean }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const [name, setName] = useState(kit.name);
  const [slug, setSlug] = useState(kit.slug);
  const entityOptions = useEntityOptions(entities, allowGroup || kit.entityId === null);
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(updateBrandKitDetailsAction, {
    extra: { id: kit.id },
    onSuccess: (data) => {
      setSlug(data.slug);
      router.refresh();
    },
  });
  const nextSlug = brandSlugFrom(slug, name);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="name" label={t("name")}>
            <Input id="name" name="name" required maxLength={BRAND_LIMITS.name} value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field name="slug" label={t("slug")}>
            <Input id="slug" name="slug" required maxLength={BRAND_LIMITS.slug} value={slug} onChange={(event) => setSlug(event.target.value)} className="font-mono" />
          </Field>
          <div className="sm:col-span-2">
            <AddressPreview origin={origin} slug={nextSlug} />
            {nextSlug !== kit.slug ? <p className="mt-1 text-xs text-warning">{t("slugChangeHint", { old: kit.slug })}</p> : null}
          </div>
          <div className="sm:col-span-2">
            <Field name="tagline" label={t("tagline")}>
              <Input id="tagline" name="tagline" maxLength={BRAND_LIMITS.tagline} defaultValue={kit.tagline ?? ""} placeholder={t("taglinePlaceholder")} />
            </Field>
          </div>
          <Field name="description" label={t("description")}>
            <Textarea id="description" name="description" rows={4} maxLength={BRAND_LIMITS.description} defaultValue={kit.description ?? ""} />
          </Field>
          <Field name="descriptionEn" label={t("descriptionEn")}>
            <Textarea id="descriptionEn" name="descriptionEn" rows={4} maxLength={BRAND_LIMITS.description} defaultValue={kit.descriptionEn ?? ""} />
          </Field>
          <Field name="websiteUrl" label={t("website")}>
            <Input id="websiteUrl" name="websiteUrl" type="url" maxLength={BRAND_LIMITS.url} defaultValue={kit.websiteUrl ?? ""} placeholder="https://" />
          </Field>
          <Field name="contactEmail" label={t("contactEmail")}>
            <Input id="contactEmail" name="contactEmail" type="email" maxLength={BRAND_LIMITS.email} defaultValue={kit.contactEmail ?? ""} placeholder="brand@suzu.vn" />
          </Field>
          <Field name="entityId" label={t("entity")}>
            <Select id="entityId" name="entityId" defaultValue={kit.entityId ?? ""}>
              {entityOptions}
            </Select>
          </Field>
          <Field name="visibility" label={t("visibility")}>
            <Select id="visibility" name="visibility" defaultValue={kit.visibility}>
              {BRAND_VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {t(`visibilities.${visibility}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </FieldErrors>
      <p className="text-xs text-muted-foreground">{t("visibilityHint")}</p>
      <FormError namespace="brands.errors" errorKey={errorKey} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved ? <span className="mr-auto text-xs text-success">{t("saved")}</span> : null}
        <Button type="submit" disabled={pending} size="lg" className="w-full md:w-auto">
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </form>
  );
}

type ColorRow = { key: number; name: string; hex: string; note: string };
type FontRow = { key: number; name: string; usage: string; url: string };
let rowKey = 0;
const nextKey = () => ++rowKey;

/** The palette and the typefaces, edited as rows and sent as JSON. */
export function KitStyleForm({ kit }: { kit: BrandKitRow }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const id = useId();
  const [colors, setColors] = useState<ColorRow[]>(() => kit.colors.map((color: BrandColor) => ({ key: nextKey(), name: color.name, hex: color.hex, note: color.note ?? "" })));
  const [fonts, setFonts] = useState<FontRow[]>(() => kit.fonts.map((font: BrandFont) => ({ key: nextKey(), name: font.name, usage: font.usage ?? "", url: font.url ?? "" })));
  const { onSubmit, pending, errorKey, saved } = useActionForm(updateBrandKitStyleAction, { extra: { id: kit.id }, onSuccess: () => router.refresh() });
  const setColor = (key: number, patch: Partial<ColorRow>) => setColors((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  const setFont = (key: number, patch: Partial<FontRow>) => setFonts((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <input type="hidden" name="colors" value={JSON.stringify(colors.map(({ name, hex, note }) => ({ name, hex, note })))} />
      <input type="hidden" name="fonts" value={JSON.stringify(fonts.map(({ name, usage, url }) => ({ name, usage, url })))} />

      <fieldset className="flex flex-col gap-3">
        <legend className="section-label mb-2">{t("palette")}</legend>
        {colors.length === 0 ? <p className="text-sm text-muted-foreground">{t("noColors")}</p> : null}
        {colors.map((row, index) => {
          const hex = normalizeHex(row.hex);
          return (
            <div key={row.key} className="grid grid-cols-[2.5rem_1fr_auto] items-end gap-2 sm:grid-cols-[2.5rem_1fr_8rem_1fr_auto]">
              {/* The browser's colour picker, behind a swatch of the colour as typed. */}
              <label className="relative size-10 cursor-pointer overflow-hidden rounded-[0.625rem] border border-border md:size-9" style={{ background: hex ?? "transparent" }}>
                <span className="sr-only">{t("pickColor", { index: index + 1 })}</span>
                <input type="color" value={hex ?? "#000000"} onChange={(event) => setColor(row.key, { hex: event.target.value.toUpperCase() })} className="absolute inset-0 size-full cursor-pointer opacity-0" />
              </label>
              <Input aria-label={t("colorName")} placeholder={t("colorName")} maxLength={BRAND_LIMITS.colorName} value={row.name} onChange={(event) => setColor(row.key, { name: event.target.value })} />
              <Input aria-label={t("colorHex")} placeholder="#EA3026" value={row.hex} onChange={(event) => setColor(row.key, { hex: event.target.value })} aria-invalid={row.hex !== "" && !hex} className="col-span-2 font-mono sm:col-span-1" />
              <Input aria-label={t("colorNote")} placeholder={t("colorNotePlaceholder")} maxLength={BRAND_LIMITS.colorNote} value={row.note} onChange={(event) => setColor(row.key, { note: event.target.value })} className="col-span-2 sm:col-span-1" />
              <Button type="button" variant="ghost" size="icon" aria-label={t("removeColor")} onClick={() => setColors((rows) => rows.filter((candidate) => candidate.key !== row.key))} className="col-start-3 row-start-1 sm:col-start-auto sm:row-start-auto">
                <Trash2Icon />
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={colors.length >= MAX_BRAND_COLORS} onClick={() => setColors((rows) => [...rows, { key: nextKey(), name: "", hex: "", note: "" }])}>
          <PlusIcon />
          {t("addColor")}
        </Button>
      </fieldset>

      <fieldset className="flex flex-col gap-3">
        <legend className="section-label mb-2">{t("typography")}</legend>
        {fonts.length === 0 ? <p className="text-sm text-muted-foreground">{t("noFonts")}</p> : null}
        {fonts.map((row) => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Input id={`${id}-font-${row.key}`} aria-label={t("fontName")} placeholder={t("fontName")} maxLength={BRAND_LIMITS.fontName} value={row.name} onChange={(event) => setFont(row.key, { name: event.target.value })} />
            <Input aria-label={t("fontUsage")} placeholder={t("fontUsagePlaceholder")} maxLength={BRAND_LIMITS.fontUsage} value={row.usage} onChange={(event) => setFont(row.key, { usage: event.target.value })} className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto" />
            <Input aria-label={t("fontUrl")} type="url" placeholder="https://fonts.google.com/…" value={row.url} onChange={(event) => setFont(row.key, { url: event.target.value })} className="col-span-2 row-start-3 sm:col-span-1 sm:row-start-auto" />
            <Button type="button" variant="ghost" size="icon" aria-label={t("removeFont")} onClick={() => setFonts((rows) => rows.filter((candidate) => candidate.key !== row.key))} className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" className="self-start" disabled={fonts.length >= MAX_BRAND_FONTS} onClick={() => setFonts((rows) => [...rows, { key: nextKey(), name: "", usage: "", url: "" }])}>
          <PlusIcon />
          {t("addFont")}
        </Button>
      </fieldset>

      <FormError namespace="brands.errors" errorKey={errorKey} />
      <div className="flex flex-wrap items-center justify-end gap-3">
        {saved ? <span className="mr-auto text-xs text-success">{t("saved")}</span> : null}
        <Button type="submit" disabled={pending} size="lg" className="w-full md:w-auto">
          {pending ? t("saving") : t("saveStyle")}
        </Button>
      </div>
    </form>
  );
}

/** Deleting a kit: offered only while it holds no files (the service refuses otherwise). */
export function DeleteKitButton({ kitId }: { kitId: string }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  if (!confirming)
    return (
      <Button type="button" variant="destructive" size="sm" onClick={() => setConfirming(true)}>
        <Trash2Icon />
        {t("deleteKit")}
      </Button>
    );
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm">{t("deleteKitConfirm")}</p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteBrandKitAction({ id: kitId });
              if (result.ok) router.push("/admin/brands");
              else setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
            })
          }
        >
          {t("deleteKitYes")}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
          {t("cancel")}
        </Button>
      </div>
      <FormError namespace="brands.errors" errorKey={errorKey} />
    </div>
  );
}
