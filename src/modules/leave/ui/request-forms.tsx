"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { amendLeaveAction, beginLeaveAttachmentAction, cancelLeaveAction, completeLeaveAttachmentAction, leaveAttachmentLinkAction, submitLeaveAction } from "../actions";

const ERRORS = "leave.errors";

export type LeaveDraft = { personId: string | null; leaveTypeId: string; startDate: string; endDate: string; startPortion: string; endPortion: string; minutes: number | null };

/**
 * The second half of filing: the dates were checked on the server (the page shows what they cost);
 * this adds the reason and the attachment and sends the request — or replaces `amends`.
 */
export function SubmitLeaveForm({ draft, amends, needsAttachment, disabled }: { draft: LeaveDraft; amends: string | null; needsAttachment: boolean; disabled: boolean }) {
  const t = useTranslations("leave");
  const router = useRouter();
  const [attachment, setAttachment] = useState<{ fileId: string; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const action = (amends ? amendLeaveAction : submitLeaveAction) as (input: unknown) => Promise<ActionResult<{ approvalRequestId: string }>>;
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(action, {
    extra: { ...draft, ...(amends ? { leaveRequestId: amends } : {}), attachmentFileId: attachment?.fileId ?? null },
    onSuccess: (data) => router.push(`/approvals/leave/${data.approvalRequestId}`),
  });

  function upload(file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    startUpload(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginLeaveAttachmentAction({ ...meta, personId: draft.personId }),
        (fileId) => completeLeaveAttachmentAction({ fileId }) as Promise<ActionResult<{ fileId: string; fileName: string }>>,
      );
      if (result.ok) setAttachment(result.data);
      else setUploadError(result.errorKey);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <FieldErrors value={fieldErrors}>
        <Field name="reason" label={t("request.reason")}>
          <Input id="reason" name="reason" maxLength={1000} placeholder={t("request.reasonHint")} />
        </Field>
        <Field name="attachment" label={needsAttachment ? t("request.attachmentRequired") : t("request.attachment")}>
          {attachment ? <p className="text-sm">{attachment.fileName}</p> : <Input id="attachment" type="file" accept=".pdf,.jpg,.jpeg,.png" disabled={uploading} onChange={(event) => upload(event.target.files?.[0])} />}
        </Field>
      </FieldErrors>
      <FormError namespace="records.errors" errorKey={uploadError} />
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || uploading || disabled || (needsAttachment && !attachment)}>
          {amends ? t("request.replace") : t("request.submit")}
        </Button>
      </div>
    </form>
  );
}

/** Takes a pending request back, or cancels an approved one (the days return to the balance). */
export function CancelLeaveButton({ leaveRequestId, label, confirm, askReason }: { leaveRequestId: string; label: string; confirm: string; askReason?: boolean }) {
  const t = useTranslations("leave");
  const { onSubmit, pending, errorKey } = useActionForm(cancelLeaveAction, { extra: { leaveRequestId } });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(confirm)) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      {askReason ? <Input name="reason" maxLength={500} placeholder={t("request.cancelReason")} className="h-8 w-56" /> : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending}>
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/** Opens the request's attachment through a one-minute link made on click. */
export function AttachmentButton({ requestId, label }: { requestId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await leaveAttachmentLinkAction({ requestId });
            if (result.ok) window.open(result.data.url, "_blank", "noopener");
            else setErrorKey(result.error === "failed" ? (result.message ?? "generic") : result.error);
          })
        }
      >
        {label}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </span>
  );
}
