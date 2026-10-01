"use client";
// What is the same for every request type besides deciding: a remark, and handing one's turn on.
import { useTranslations } from "next-intl";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { commentApprovalAction, delegateApprovalAction } from "../actions";

export function CommentForm({ requestId }: { requestId: string }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey, saved } = useActionForm(commentApprovalAction, { extra: { requestId } });
  return (
    <form onSubmit={onSubmit} key={saved ? "saved" : "open"} className="flex w-full flex-col gap-2 md:flex-row md:items-end">
      <div className="min-w-0 flex-1">
        <Field name="comment" label={t("tools.comment")}>
          <Input id="comment-only" name="comment" maxLength={1000} required placeholder={t("tools.commentHint")} />
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={pending} className="w-full md:w-auto">
        {t("tools.send")}
      </Button>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
    </form>
  );
}

export function DelegateForm({ requestId, people }: { requestId: string; people: { id: string; fullName: string }[] }) {
  const t = useTranslations("approvals");
  const { onSubmit, pending, errorKey } = useActionForm(delegateApprovalAction, { extra: { requestId } });
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="press flex h-9 w-full cursor-pointer items-center text-sm font-medium text-link hover:underline">{t("tools.delegate")}</CollapsibleTrigger>
      <CollapsibleContent>
        <form onSubmit={onSubmit} className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("tools.delegateHint")}</p>
          <div className="grid gap-3 md:grid-cols-2">
            <Field name="toPersonId" label={t("tools.delegateTo")}>
              <Select id="toPersonId" name="toPersonId" required defaultValue="">
                <option value="" disabled>
                  —
                </option>
                {people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}
                  </option>
                ))}
              </Select>
            </Field>
            <Field name="comment" label={t("tools.delegateNote")}>
              <Input id="delegate-note" name="comment" maxLength={1000} />
            </Field>
          </div>
          <FormError namespace="approvals.errors" errorKey={errorKey} />
          <div>
            <Button type="submit" variant="outline" disabled={pending} className="w-full md:w-auto">
              {t("tools.delegateSubmit")}
            </Button>
          </div>
        </form>
      </CollapsibleContent>
    </Collapsible>
  );
}
