"use client";
// A knowledge-base file opened in the preview dialog. The address stays the stable redirect (it
// works with a middle-click, a new tab, or no script at all); a plain click asks the same route
// for the link as JSON instead, so the file shows in place.
import type { MouseEvent, ReactNode } from "react";
import type { ActionResult } from "@/lib/action";
import { useFilePreview } from "@/modules/platform/files/ui/file-preview";

const fileHref = (fileId: string) => `/api/kb/files/${fileId}`;

async function linkOf(fileId: string): Promise<ActionResult<{ url: string; fileName: string }>> {
  const response = await fetch(`${fileHref(fileId)}?link=1`, { cache: "no-store" }).catch(() => null);
  if (!response?.ok) return { ok: false, error: "failed", message: "file_not_found" };
  return { ok: true, data: (await response.json()) as { url: string; fileName: string } };
}

export function KbFileLink({ fileId, fileName, className, children }: { fileId: string; fileName?: string; className?: string; children: ReactNode }) {
  const preview = useFilePreview();
  async function open(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const openLink = () => linkOf(fileId);
    const result = await openLink();
    // Could not ask: let the browser follow the address as it always has.
    if (!result.ok) return window.location.assign(fileHref(fileId));
    preview.show({ url: result.data.url, fileName: fileName ?? result.data.fileName, openLink });
  }
  return (
    <>
      <a href={fileHref(fileId)} onClick={open} className={className}>
        {children}
      </a>
      {preview.dialog}
    </>
  );
}
