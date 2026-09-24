"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { FileLink } from "@/modules/platform/files/ui/signed-upload";
import { openFeedbackScreenshotAction, triageFeedbackAction } from "../actions";
import { FEEDBACK_PRIORITIES, FEEDBACK_REPLY_MAX, FEEDBACK_STATUSES, type FeedbackPriority, type FeedbackStatus } from "../enums";

export function TriageForm({ id, status, priority, reply, internalNote }: { id: string; status: FeedbackStatus; priority: FeedbackPriority; reply: string | null; internalNote: string | null }) {
  const t = useTranslations("feedback");
  const router = useRouter();
  const form = useActionForm(triageFeedbackAction, { extra: { id }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="status" label={t("triage.status")}>
            <Select id="status" name="status" defaultValue={status}>
              {FEEDBACK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`statuses.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="priority" label={t("triage.priority")}>
            <Select id="priority" name="priority" defaultValue={priority}>
              {FEEDBACK_PRIORITIES.map((value) => (
                <option key={value} value={value}>
                  {t(`priorities.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field name="reply" label={t("triage.reply")}>
          <textarea id="reply" name="reply" rows={4} maxLength={FEEDBACK_REPLY_MAX} defaultValue={reply ?? ""} placeholder={t("triage.replyPlaceholder")} className="rounded-lg border bg-background px-2.5 py-2 text-sm" />
        </Field>
        <Field name="internalNote" label={t("triage.internalNote")}>
          <textarea id="internalNote" name="internalNote" rows={3} maxLength={FEEDBACK_REPLY_MAX} defaultValue={internalNote ?? ""} placeholder={t("triage.internalNotePlaceholder")} className="rounded-lg border bg-background px-2.5 py-2 text-sm" />
        </Field>
      </FieldErrors>
      <FormError namespace="feedback.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending}>
          {t("triage.save")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("triage.saved")}</span> : null}
      </div>
    </form>
  );
}

export function ScreenshotLink({ feedbackId, fileId, fileName }: { feedbackId: string; fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={(input) => openFeedbackScreenshotAction({ ...(input as object), feedbackId })} />;
}
