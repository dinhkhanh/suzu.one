"use client";
// A take-home submission opens through a one-minute link made on click, and only for somebody the
// assignment's own rule admits. Like a CV, it arrived from the internet and nothing has scanned it.
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openAssignmentFileAction } from "../file-actions";

export function AssignmentLink({ assignmentId, fileId, fileName }: { assignmentId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openAssignmentFileAction({ ...(input as object), assignmentId })} />;
}
