"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES, PHOTO_EDGE_PX } from "@/modules/platform/files/rules";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { beginPhotoUploadAction, completePhotoUploadAction, removePhotoAction } from "../photo-actions";

const ERRORS = "people.errors";

/**
 * The picture as it is stored: square, at most `PHOTO_EDGE_PX` a side, JPEG. Whatever the phone
 * took — 12 MP, HEIC where the browser can open it, turned by its EXIF orientation — arrives as a
 * few hundred kilobytes. The square is cut from the middle across and a little above the middle
 * down, where a portrait's face usually is.
 */
async function squarePicture(file: File): Promise<File | null> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return null;
  const side = Math.min(bitmap.width, bitmap.height);
  const edge = Math.min(side, PHOTO_EDGE_PX);
  const canvas = document.createElement("canvas");
  canvas.width = edge;
  canvas.height = edge;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 3, side, side, 0, 0, edge, edge);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  return blob ? new File([blob], "photo.jpg", { type: "image/jpeg" }) : null;
}

/**
 * Change and remove buttons for the profile picture beside them, for the person and for HR
 * (FR-CHR-01). `compact` keeps the hint as the button's title, for a page header.
 */
export function PhotoEditor({ person, compact = false }: { person: { id: string; photoFileId: string | null }; compact?: boolean }) {
  const t = useTranslations("people.photo");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const upload = (file: File) =>
    startTransition(async () => {
      if (file.size > MAX_FILE_BYTES) return setErrorKey("file_too_large");
      const picture = await squarePicture(file);
      if (!picture) return setErrorKey("photo_unreadable");
      const result = await uploadThroughSignedUrl(picture, (meta) => beginPhotoUploadAction({ personId: person.id, ...meta }), (fileId) => completePhotoUploadAction({ personId: person.id, fileId }));
      setErrorKey(result.ok ? null : result.errorKey);
      if (result.ok) router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await removePhotoAction({ personId: person.id });
      setErrorKey(result.ok ? null : result.error === "failed" ? (result.message ?? "generic") : result.error);
      if (result.ok) router.refresh();
    });

  return (
    <div className="flex flex-col items-start gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} title={compact ? t("hint") : undefined} onClick={() => input.current?.click()}>
          {pending ? t("saving") : person.photoFileId ? t("change") : t("add")}
        </Button>
        {person.photoFileId ? (
          <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
            {t("remove")}
          </Button>
        ) : null}
        {compact ? null : <span className="text-xs text-muted-foreground">{t("hint")}</span>}
      </div>
      <input
        ref={input}
        type="file"
        // Any picture the browser can open; it is re-encoded as JPEG before upload.
        accept="image/*"
        className="sr-only"
        aria-label={t("label")}
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) upload(file);
        }}
      />
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </div>
  );
}
