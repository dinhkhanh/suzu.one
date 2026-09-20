"use client";
import { useTranslations } from "next-intl";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { withdrawPageReviewAction } from "../actions";

/** The editor takes a revision back from review: the page is theirs to change again. */
export function WithdrawReviewForm({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(withdrawPageReviewAction, { extra: { requestId } });
  return (
    <form
      onSubmit={(event) => {
        if (window.confirm(t("withdrawConfirm"))) onSubmit(event);
        else event.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <Button type="submit" variant="outline" disabled={pending}>
        {t("withdraw")}
      </Button>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
    </form>
  );
}
