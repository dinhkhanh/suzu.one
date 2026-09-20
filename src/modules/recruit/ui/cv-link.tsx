"use client";
// A candidate's CV opens through a one-minute link made on click, and only for somebody the
// application's own rule admits. The warning beside it is not decoration: the file arrived from
// the internet and nothing has scanned it.
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openCandidateCvAction } from "../file-actions";

export function CvLink({ applicationId, fileId, fileName }: { applicationId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openCandidateCvAction({ ...(input as object), applicationId })} />;
}
