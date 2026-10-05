"use client";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { useConfirmedSubmit } from "@/components/ui/confirm";
import { withdrawPageReviewAction } from "../actions";

/** The editor takes a revision back from review: the page is theirs to change again. */
export function WithdrawReviewForm({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals");
  const form = useActionForm(withdrawPageReviewAction, { extra: { requestId } });
  const { onSubmit, dialog } = useConfirmedSubmit(form.onSubmit, { question: t("withdrawConfirm"), confirmLabel: t("withdraw") });
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("withdraw")}
      </Button>
      {dialog}
      <FormError namespace="approvals.errors" errorKey={form.errorKey} />
    </form>
  );
}
