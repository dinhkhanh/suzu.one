"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";

type Upload = { fileId: string; uploadUrl: string; contentType: string };
type Failure = { error: string; message?: string };
const keyOf = (result: Failure) => (result.error === "failed" ? result.message : result.error) ?? "generic";

/**
 * The browser half of an upload (FR-PLT-32): ask the owning module for a signed URL, PUT the bytes
 * straight to storage, then ask the module to check what arrived. The bytes never pass through
 * the app server. `begin` and `complete` are the owning module's server actions.
 */
export async function uploadThroughSignedUrl<Done>(
  file: File,
  begin: (meta: { fileName: string; sizeBytes: number }) => Promise<ActionResult<Upload>>,
  complete: (fileId: string) => Promise<ActionResult<Done>>,
): Promise<{ ok: true; data: Done } | { ok: false; errorKey: string }> {
  const started = await begin({ fileName: file.name, sizeBytes: file.size });
  if (!started.ok) return { ok: false, errorKey: keyOf(started) };
  const stored = await fetch(started.data.uploadUrl, { method: "PUT", body: file, headers: { "content-type": started.data.contentType } }).catch(() => null);
  // Our size rule let the file through; the storage project's own cap did not.
  if (stored?.status === 413) return { ok: false, errorKey: "file_storage_limit" };
  if (!stored?.ok) return { ok: false, errorKey: "file_upload_failed" };
  const finished = await complete(started.data.fileId);
  return finished.ok ? { ok: true, data: finished.data } : { ok: false, errorKey: keyOf(finished) };
}

/** Opens a file through a one-minute link made on click, so no link ever sits in the page. */
export function FileLink({ fileId, fileName, download, onError }: { fileId: string; fileName: string; download: (input: unknown) => Promise<ActionResult<{ url: string }>>; onError?: (errorKey: string) => void }) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  return (
    <Button
      type="button"
      variant="link"
      size="sm"
      className={failed ? "h-auto p-0 text-destructive" : "h-auto p-0"}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await download({ fileId });
          setFailed(!result.ok);
          if (result.ok) window.location.assign(result.data.url);
          else onError?.(keyOf(result));
        })
      }
    >
      {fileName}
    </Button>
  );
}
