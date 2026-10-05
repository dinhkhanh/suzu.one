"use client";
import { Trash2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { acceptAttributeFor, BRAND_OWNER_TYPE } from "@/modules/platform/files/rules";
import { formatBytes } from "@/modules/platform/files/preview";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { beginBrandAssetUploadAction, completeBrandAssetUploadAction, deleteBrandAssetAction, openBrandAssetAction, updateBrandAssetAction } from "../actions";
import { BRAND_ASSET_KINDS, BRAND_LIMITS, type BrandAssetKind } from "../enums";
import { fileFormatOf, guessAssetKind, hasThumbnail, titleFromFileName } from "../engine/kit";
import type { BrandAssetView } from "../service";

export type SectionOption = { id: string; title: string };

const ACCEPT = acceptAttributeFor(BRAND_OWNER_TYPE);

function useKindOptions(withAuto: boolean) {
  const t = useTranslations("brands");
  return [
    ...(withAuto ? [<option key="auto" value="auto">{t("kindAuto")}</option>] : []),
    ...BRAND_ASSET_KINDS.map((kind) => (
      <option key={kind} value={kind}>
        {t(`assetKinds.${kind}`)}
      </option>
    )),
  ];
}

function useSectionOptions(sections: readonly SectionOption[]) {
  const t = useTranslations("brands");
  return [<option key="" value="">{t("inDownloads")}</option>, ...sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)];
}

/** The public checkbox; posts `isPublic=on` when ticked, like a native checkbox. */
function PublicCheckbox({ defaultChecked, id }: { defaultChecked: boolean; id: string }) {
  const t = useTranslations("brands");
  return (
    <Label htmlFor={id} className="h-10 cursor-pointer gap-2.5 font-normal md:h-9">
      <Checkbox id={id} name="isPublic" defaultChecked={defaultChecked} />
      {t("isPublic")}
    </Label>
  );
}

/**
 * Several files at once — a logo comes as SVG, PNG and EPS, in colour and in white. Each goes
 * straight to storage through its own signed link, one after another, and joins the kit titled
 * after its file name; the titles are corrected in the list afterwards.
 */
export function UploadAssetsForm({ kitId, sections }: { kitId: string; sections: SectionOption[] }) {
  const t = useTranslations("brands");
  const tErrors = useTranslations("brands.errors");
  const router = useRouter();
  const id = useId();
  const form = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [failures, setFailures] = useState<{ fileName: string; errorKey: string }[]>([]);
  const [added, setAdded] = useState<number | null>(null);
  const kindOptions = useKindOptions(true);
  const sectionOptions = useSectionOptions(sections);

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const files = data.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);
    if (files.length === 0) return;
    const chosenKind = String(data.get("kind") ?? "auto");
    const sectionId = String(data.get("sectionId") ?? "");
    const isPublic = data.get("isPublic") === "on";
    setFailures([]);
    setAdded(null);
    startTransition(async () => {
      const failed: { fileName: string; errorKey: string }[] = [];
      let done = 0;
      setProgress({ done, total: files.length });
      for (const file of files) {
        const kind: BrandAssetKind = chosenKind === "auto" ? guessAssetKind(file.name) : (chosenKind as BrandAssetKind);
        const result = await uploadThroughSignedUrl(
          file,
          (meta) => beginBrandAssetUploadAction({ kitId, ...meta }),
          (fileId) => completeBrandAssetUploadAction({ kitId, fileId, title: titleFromFileName(file.name), kind, sectionId, isPublic }),
        );
        if (!result.ok) failed.push({ fileName: file.name, errorKey: result.errorKey });
        setProgress({ done: ++done, total: files.length });
      }
      setFailures(failed);
      setAdded(files.length - failed.length);
      setProgress(null);
      form.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={form} onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field name={`${id}-files`} label={t("files")}>
            <Input id={`${id}-files`} name="files" type="file" multiple required accept={ACCEPT} />
          </Field>
          <p className="mt-1.5 text-xs text-muted-foreground">{t("filesHint")}</p>
        </div>
        <Field name={`${id}-kind`} label={t("assetKind")}>
          <Select id={`${id}-kind`} name="kind" defaultValue="auto">
            {kindOptions}
          </Select>
        </Field>
        <Field name={`${id}-section`} label={t("assetSection")}>
          <Select id={`${id}-section`} name="sectionId" defaultValue="">
            {sectionOptions}
          </Select>
        </Field>
      </div>
      <PublicCheckbox id={`${id}-public`} defaultChecked />
      {failures.length > 0 ? (
        <Alert variant="destructive">
          <ul className="flex flex-col gap-1">
            {failures.map((failure) => (
              <li key={failure.fileName}>
                <span className="font-medium">{failure.fileName}</span>: {tErrors.has(failure.errorKey) ? tErrors(failure.errorKey) : tErrors("generic")}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-end gap-3">
        {progress ? <span className="mr-auto text-xs text-muted-foreground">{t("uploading", progress)}</span> : null}
        {!progress && added ? <span className="mr-auto text-xs text-success">{t("filesAdded", { count: added })}</span> : null}
        <Button type="submit" disabled={pending} size="lg" className="w-full md:w-auto">
          {pending ? t("uploadingShort") : t("upload")}
        </Button>
      </div>
    </form>
  );
}

/** One file of the kit, as a row that holds its own small form. */
export function AssetRowForm({ asset, sections, downloads, pictureUrl }: { asset: BrandAssetView; sections: SectionOption[]; downloads: { total: number; recent: number } | null; pictureUrl: string }) {
  const t = useTranslations("brands");
  const router = useRouter();
  const id = `asset-${asset.id}`;
  const kindOptions = useKindOptions(false);
  const sectionOptions = useSectionOptions(sections);
  const [deleting, startDelete] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { onSubmit, pending, errorKey, saved, fieldErrors } = useActionForm(updateBrandAssetAction, { extra: { id: asset.id, sortOrder: asset.sortOrder }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={onSubmit} className="flex w-full flex-col gap-3">
      <div className="flex items-center gap-3">
        <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border bg-canvas">
          {hasThumbnail(asset.fileName) ? (
            // A signed link on the storage's domain, behind a route that checks the keeper.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pictureUrl} alt="" className="max-h-full max-w-full object-contain p-1.5" loading="lazy" />
          ) : (
            <span className="font-mono text-[0.6875rem] font-medium text-muted-foreground">{fileFormatOf(asset.fileName)}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <FileLink fileId={asset.fileId} fileName={asset.fileName} download={openBrandAssetAction} />
          <p className="text-xs text-muted-foreground">
            {fileFormatOf(asset.fileName)} · {formatBytes(asset.sizeBytes)}
            {downloads ? ` · ${t("downloadsCount", { total: downloads.total, recent: downloads.recent })}` : ""}
          </p>
        </div>
      </div>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field name={`${id}-title`} label={t("assetTitle")}>
            <Input id={`${id}-title`} name="title" required maxLength={BRAND_LIMITS.assetTitle} defaultValue={asset.title} />
          </Field>
          <Field name={`${id}-kind`} label={t("assetKind")}>
            <Select id={`${id}-kind`} name="kind" defaultValue={asset.kind}>
              {kindOptions}
            </Select>
          </Field>
          <Field name={`${id}-section`} label={t("assetSection")}>
            <Select id={`${id}-section`} name="sectionId" defaultValue={asset.sectionId ?? ""}>
              {sectionOptions}
            </Select>
          </Field>
        </div>
      </FieldErrors>
      <div className="flex flex-wrap items-center gap-2">
        <PublicCheckbox id={`${id}-public`} defaultChecked={asset.isPublic} />
        <div className="ml-auto flex items-center gap-2">
          {saved ? <span className="text-xs text-success">{t("saved")}</span> : null}
          {confirming ? (
            <>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={deleting}
                onClick={() =>
                  startDelete(async () => {
                    const result = await deleteBrandAssetAction({ id: asset.id });
                    if (result.ok) router.refresh();
                    else setDeleteError((result.error === "failed" ? result.message : result.error) ?? "generic");
                  })
                }
              >
                {t("deleteFileYes")}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(false)}>
                {t("cancel")}
              </Button>
            </>
          ) : (
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("deleteFile")} title={t("deleteFile")} onClick={() => setConfirming(true)}>
              <Trash2Icon />
            </Button>
          )}
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {t("save")}
          </Button>
        </div>
      </div>
      <FormError namespace="brands.errors" errorKey={errorKey ?? deleteError} />
    </form>
  );
}
