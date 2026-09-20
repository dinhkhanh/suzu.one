"use client";
// An attachment opens through a one-minute link made on click, so no storage URL ever sits in the
// page — and the link is only made for someone who may open the request it belongs to.
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openRequestAttachmentAction } from "../file-actions";

export function AttachmentLink({ requestId, fileId, fileName }: { requestId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openRequestAttachmentAction({ ...(input as object), requestId })} />;
}
