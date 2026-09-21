"use client";
// Sending a take-home, and rating what comes back (FR-REC-07).
//
// The link is shown **once**, right after it is minted, because only its hash is stored: nothing
// can produce it again. The form says so rather than letting a recruiter close the panel and then
// discover there is nothing to copy.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cancelAssignmentAction, rateAssignmentAction, sendAssignmentAction } from "../assignment-actions";
import { SCORE_MAX, SCORE_MIN } from "../enums";

const SCORES = Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, index) => SCORE_MIN + index);

export function SendAssignment({ applicationId, origin }: { applicationId: string; origin: string }) {
  const t = useTranslations("recruit.assignment");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [link, setLink] = useState<string | null>(null);

  const form = useActionForm(sendAssignmentAction, {
    extra: { applicationId },
    onSuccess: (data) => {
      // The one and only copy. It is held in component state and never sent anywhere again.
      setLink(`${origin}${(data as { link: string }).link}`);
      setOpen(false);
      router.refresh();
    },
  });

  if (link) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-4">
        <h3 className="text-sm font-medium">{t("linkTitle")}</h3>
        <p className="text-xs text-muted-foreground">{t("linkOnce")}</p>
        <code className="overflow-x-auto rounded-lg bg-muted px-3 py-2 text-xs">{link}</code>
        <Button type="button" size="sm" variant="ghost" onClick={() => setLink(null)}>
          {t("done")}
        </Button>
      </div>
    );
  }

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        {t("send")}
      </Button>
    );
  }

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("send")}</h3>
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("title")}>
          <Input id="assignment-title" name="title" required maxLength={200} />
        </Field>
        <Field name="brief" label={t("brief")}>
          <textarea id="assignment-brief" name="brief" rows={6} required maxLength={20_000} className="w-full rounded-lg border bg-transparent px-3 py-2 text-sm" />
        </Field>
        <Field name="dueAt" label={t("due")}>
          <Input id="assignment-due" name="dueAt" type="datetime-local" required />
        </Field>
      </FieldErrors>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("send")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancelForm")}
        </Button>
      </div>
    </form>
  );
}

export function RateAssignment({ assignmentId, rating }: { assignmentId: string; rating: number | null }) {
  const t = useTranslations("recruit.assignment");
  const tScore = useTranslations("recruit.scorecard");
  const router = useRouter();
  const form = useActionForm(rateAssignmentAction, { extra: { assignmentId }, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="toolbar">
      <Field name="rating" label={t("rating")}>
        <Select id={`rating-${assignmentId}`} name="rating" defaultValue={rating ? String(rating) : ""} required>
          <option value="" disabled>
            —
          </option>
          {SCORES.map((score) => (
            <option key={score} value={score}>
              {tScore(`scale.${score}` as "scale.1")}
            </option>
          ))}
        </Select>
      </Field>
      <Field name="note" label={t("ratingNote")}>
        <Input id={`rating-note-${assignmentId}`} name="note" maxLength={4000} />
      </Field>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <Button type="submit" size="sm" disabled={form.pending}>
        {t("rate")}
      </Button>
    </form>
  );
}

export function CancelAssignment({ assignmentId }: { assignmentId: string }) {
  const t = useTranslations("recruit.assignment");
  const router = useRouter();
  const form = useActionForm(cancelAssignmentAction, { extra: { assignmentId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={form.onSubmit} className="flex items-center gap-2">
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <Button type="submit" size="sm" variant="ghost" disabled={form.pending}>
        {t("cancel")}
      </Button>
    </form>
  );
}
