"use client";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { withdrawApprovalAction } from "../actions";

/**
 * Approve / return for changes / reject. The action belongs to the module that owns the request
 * type (it applies the effect); it receives `{ requestId, decision, comment, …extra fields }`.
 * `children` are the type's own fields, e.g. a confirmation the approver has to tick.
 *
 * The note sits over the keys; the keys are the last thing on the page, in reach of a thumb: the
 * ink "Approve" and the outline "Reject" side by side, "Return" the quieter third.
 */
/** `allowReturn`: false for a request nobody can correct and send again (a proposed rule: it is approved or rejected). */
export function DecisionForm({ requestId, action, children, allowReturn = true }: { requestId: string; action: (input: unknown) => Promise<ActionResult<unknown>>; children?: ReactNode; allowReturn?: boolean }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(action, { extra: { requestId } });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <h2 className="section-label">{t("decide.title")}</h2>
      {children}
      <Field name="comment" label={t("decide.comment")}>
        <Textarea id="comment" name="comment" maxLength={1000} rows={3} placeholder={t("decide.commentHint")} />
      </Field>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
      <div className="grid grid-cols-2 gap-2 md:flex md:justify-end">
        {allowReturn ? (
          <Button type="submit" name="decision" value="return" variant="ghost" size="lg" disabled={pending} className="col-span-2 md:order-first">
            {t("decide.return")}
          </Button>
        ) : null}
        <Button type="submit" name="decision" value="reject" variant="outline" size="lg" disabled={pending}>
          {t("decide.reject")}
        </Button>
        <Button type="submit" name="decision" value="approve" size="lg" disabled={pending}>
          {t("decide.approve")}
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
      className="flex flex-col gap-3 md:flex-row md:items-center"
    >
      <Button type="submit" variant="outline" disabled={pending} className="w-full md:w-auto">
        {t("withdraw")}
      </Button>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
    </form>
  );
}
