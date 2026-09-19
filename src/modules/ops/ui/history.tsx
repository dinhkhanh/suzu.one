"use client";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { openEvidenceFileAction } from "../actions";

/** Opens an evidence file through the audited action (a one-minute link), as the instance page does. */
export function EvidenceLinks({ files }: { files: { id: string; fileName: string }[] }) {
  const t = useTranslations("ops.history");
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
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
              const result = await openEvidenceFileAction({ fileId: file.id });
              setFailed(!result.ok);
              if (result.ok) window.open(result.data.url, "_blank", "noopener");
            })
          }
        >
          {file.fileName}
        </button>
      ))}
      {failed ? <span className="text-destructive">{t("openFailed")}</span> : null}
    </span>
  );
}
