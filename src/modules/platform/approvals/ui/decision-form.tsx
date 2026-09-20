"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { withdrawApprovalAction } from "../actions";

/**
 * Approve / return for changes / reject. The action belongs to the module that owns the request
 * type (it applies the effect); it receives `{ requestId, decision, comment, …extra fields }`.
 * `children` are the type's own fields, e.g. a confirmation the approver has to tick.
 */
export function DecisionForm({ requestId, action, children }: { requestId: string; action: (input: unknown) => Promise<ActionResult<unknown>>; children?: ReactNode }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(action, { extra: { requestId } });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("decide.title")}</h2>
      {children}
      <Field name="comment" label={t("decide.comment")}>
        <Input id="comment" name="comment" maxLength={1000} placeholder={t("decide.commentHint")} />
      </Field>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
      <div className="flex flex-wrap gap-2">
        <Button type="submit" name="decision" value="approve" disabled={pending}>
          {t("decide.approve")}
        </Button>
        <Button type="submit" name="decision" value="return" variant="outline" disabled={pending}>
          {t("decide.return")}
        </Button>
        <Button type="submit" name="decision" value="reject" variant="outline" disabled={pending}>
          {t("decide.reject")}
        </Button>
      </div>
    </form>
  );
}

/** The requester takes the request back. The same for every request type. */
export function WithdrawForm({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(withdrawApprovalAction, { extra: { requestId } });
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
