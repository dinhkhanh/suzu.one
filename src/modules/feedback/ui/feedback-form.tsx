"use client";
// The one feedback form: in the header's dialog on every page, and on /feedback. The page it was
// opened on travels with it, so "this button does nothing" arrives with the page it is on.
import { ImagePlus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ClipboardEvent, useRef, useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { beginFeedbackScreenshotAction, completeFeedbackScreenshotAction, submitFeedbackAction } from "../actions";
import { FEEDBACK_CATEGORIES, FEEDBACK_MESSAGE_MAX, type FeedbackCategory } from "../enums";
import { CATEGORY_ICONS } from "./icons";

export function FeedbackForm({ pagePath, onSent, autoFocus }: { pagePath: string | null; onSent?: (id: string) => void; autoFocus?: boolean }) {
  const t = useTranslations("feedback");
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [screenshot, setScreenshot] = useState<{ fileId: string; fileName: string } | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, startUpload] = useTransition();
  const form = useActionForm(submitFeedbackAction, {
    extra: { category, pagePath, screenshotFileId: screenshot?.fileId ?? "" },
    onSuccess: (data) => {
      formRef.current?.reset();
      setScreenshot(null);
      setCategory("bug");
      // On its own page the list below it gains the new item; in the dialog, the dialog says thanks.
      if (onSent) onSent(data.id);
      else router.refresh();
    },
  });

  function upload(file: File | undefined | null) {
    if (!file) return;
    setUploadError(null);
    startUpload(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginFeedbackScreenshotAction(meta),
        (fileId) => completeFeedbackScreenshotAction({ fileId }) as Promise<ActionResult<{ fileId: string; fileName: string }>>,
      );
      if (result.ok) setScreenshot(result.data);
      else setUploadError(result.errorKey);
    });
  }

  // A screenshot pasted into the text box is the fastest way there is: Print Screen, Ctrl+V.
  function onPaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const image = [...event.clipboardData.files].find((file) => file.type.startsWith("image/"));
    if (!image) return;
    event.preventDefault();
    const extension = image.type === "image/jpeg" ? "jpg" : image.type === "image/webp" ? "webp" : "png";
    upload(new File([image], image.name && /\.(png|jpe?g|webp)$/i.test(image.name) ? image.name : `screenshot.${extension}`, { type: image.type }));
  }

  return (
    <form ref={formRef} onSubmit={form.onSubmit} className="flex flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-medium">{t("form.category")}</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {FEEDBACK_CATEGORIES.map((key) => {
              const Icon = CATEGORY_ICONS[key];
              const active = key === category;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setCategory(key)}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[0.8125rem] font-medium transition-colors sm:flex-col sm:items-center sm:gap-1 sm:text-center",
                    active ? "border-primary bg-primary/8 text-primary" : "border-border text-foreground/80 hover:bg-muted",
                  )}
                >
                  <Icon className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} aria-hidden />
                  {t(`categories.${key}`)}
                </button>
              );
            })}
          </div>
        </fieldset>

        <Field name="message" label={t("form.message")}>
          <textarea
            id="message"
            name="message"
            required
            minLength={5}
            rows={5}
            maxLength={FEEDBACK_MESSAGE_MAX}
            autoFocus={autoFocus}
            onPaste={onPaste}
            placeholder={t(`form.placeholders.${category}`)}
            className="rounded-lg border bg-background px-2.5 py-2 text-sm"
          />
        </Field>
        <p className="-mt-2 text-xs text-muted-foreground">{t("form.privacy")}</p>

        {category === "bug" || category === "question" ? (
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="blocking" className="mt-0.5 size-4" />
            <span>{t("form.blocking")}</span>
          </label>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t("form.screenshot")}</span>
          {screenshot ? (
            <span className="flex items-center gap-2 text-sm">
              <ImagePlus className="size-4 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">{screenshot.fileName}</span>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={t("form.removeScreenshot")} onClick={() => setScreenshot(null)}>
                <X />
              </Button>
            </span>
          ) : (
            <label className={cn("flex cursor-pointer items-center gap-2 self-start rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground hover:bg-muted", uploading && "pointer-events-none opacity-60")}>
              <ImagePlus className="size-4" aria-hidden />
              {uploading ? t("form.uploading") : t("form.addScreenshot")}
              <input type="file" accept=".png,.jpg,.jpeg,.webp" className="sr-only" onChange={(event) => upload(event.currentTarget.files?.[0])} />
            </label>
          )}
          <span className="text-xs text-muted-foreground">{t("form.pasteHint")}</span>
          {uploadError ? <FormError namespace="feedback.errors" errorKey={uploadError} /> : null}
        </div>
      </FieldErrors>

      <FormError namespace="feedback.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={form.pending || uploading}>
          {form.pending ? t("form.sending") : t("form.send")}
        </Button>
        {form.saved && !onSent ? <span className="text-sm text-muted-foreground">{t("form.sent")}</span> : null}
        {pagePath ? <span className="min-w-0 truncate text-xs text-muted-foreground">{t("form.aboutPage", { path: pagePath })}</span> : null}
      </div>
    </form>
  );
}
