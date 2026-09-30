"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { useFilePreview } from "@/modules/platform/files/ui/file-preview";
import { openEvidenceFileAction } from "../actions";

/** Opens an evidence file in the preview dialog through the audited action (a one-minute link), as the instance page does. */
export function EvidenceLinks({ files }: { files: { id: string; fileName: string }[] }) {
  const t = useTranslations("ops.history");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const preview = useFilePreview();
  if (files.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="flex flex-col items-start gap-0.5">
      {files.map((file) => (
        <button
          key={file.id}
          type="button"
          disabled={pending}
          className="max-w-48 truncate text-left underline"
          onClick={() =>
            startTransition(async () => {
              const openLink = () => openEvidenceFileAction({ fileId: file.id });
              const result = await openLink();
              setFailed(!result.ok);
              if (result.ok) preview.show({ url: result.data.url, fileName: file.fileName, openLink });
            })
          }
        >
          {file.fileName}
        </button>
      ))}
      {failed ? <span className="text-destructive">{t("openFailed")}</span> : null}
      {preview.dialog}
    </span>
  );
}
