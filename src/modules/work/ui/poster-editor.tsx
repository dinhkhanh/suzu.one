"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { MAX_FILE_BYTES, POSTER_EDGE_PX } from "@/modules/platform/files/rules";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { squarePicture } from "@/modules/platform/files/ui/square-picture";
import { beginPosterUploadAction, completePosterUploadAction, removePosterAction } from "../poster-actions";
import { ProjectPoster } from "./project-poster";

/** The project's poster with change and remove buttons, for whoever runs the project. */
export function PosterEditor({ project }: { project: { id: string; name: string; posterFileId: string | null } }) {
  const t = useTranslations("work.projects.poster");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const upload = (file: File) =>
    startTransition(async () => {
      if (file.size > MAX_FILE_BYTES) return setErrorKey("file_too_large");
      // Square, cut from the centre: every list and header shows the poster as a square.
      const picture = await squarePicture(file, { edge: POSTER_EDGE_PX, name: "poster.jpg" });
      if (!picture) return setErrorKey("poster_unreadable");
      const result = await uploadThroughSignedUrl(
        picture,
        (meta) => beginPosterUploadAction({ projectId: project.id, ...meta }),
        (fileId) => completePosterUploadAction({ projectId: project.id, fileId }),
      );
      setErrorKey(result.ok ? null : result.errorKey);
      if (result.ok) router.refresh();
    });

  const remove = () =>
    startTransition(async () => {
      const result = await removePosterAction({ projectId: project.id });
      setErrorKey(result.ok ? null : result.error === "failed" ? (result.message ?? "generic") : result.error);
      if (result.ok) router.refresh();
    });

  return (
    <div className="flex items-center gap-3">
      <ProjectPoster project={project} size="lg" />
      <div className="flex flex-col items-start gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => input.current?.click()}>
            {pending ? t("saving") : project.posterFileId ? t("change") : t("add")}
          </Button>
          {project.posterFileId ? (
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={remove}>
              {t("remove")}
            </Button>
          ) : null}
        </div>
        <span className="text-xs text-muted-foreground">{t("hint")}</span>
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
        <FormError namespace="work.errors" errorKey={errorKey} />
      </div>
    </div>
  );
}
