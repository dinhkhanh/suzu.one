"use client";
// What is the same for every request type besides deciding: a remark, and handing one's turn on.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { commentApprovalAction, delegateApprovalAction, reassignApprovalAction } from "../actions";

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

type ReassignProps = {
  requestId: string;
  /** Whose turn is open: the approvers a turn can be taken from. */
  waiting: { personId: string; name: string }[];
  /** The directory to choose from, and who in it cannot take the turn: the parties and the people already on the step (the action checks again). */
  people: { id: string; fullName: string }[];
  exclude: string[];
};

// An administrator moves a turn (PLT-02): from whom, to whom, and why — the reason stays in the history.
function ReassignFields({ requestId, waiting, people, exclude, onDone }: ReassignProps & { onDone?: () => void }) {
  const t = useTranslations("approvals");
  const router = useRouter();
  const candidates = people.filter((person) => !exclude.includes(person.id));
  const { onSubmit, pending, errorKey } = useActionForm(reassignApprovalAction, {
    extra: { requestId },
    onSuccess: () => {
      onDone?.();
      router.refresh();
    },
  });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field name="fromPersonId" label={t("tools.reassignFrom")}>
          <Select id="reassign-from" name="fromPersonId" required defaultValue={waiting[0]?.personId ?? ""}>
            {waiting.map((person) => (
              <option key={person.personId} value={person.personId}>
                {person.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="toPersonId" label={t("tools.reassignTo")}>
          <Select id="reassign-to" name="toPersonId" required defaultValue="">
            <option value="" disabled>
              —
            </option>
            {candidates.map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field name="reason" label={t("tools.reassignReason")}>
        <Input id="reassign-reason" name="reason" maxLength={1000} required />
      </Field>
      <FormError namespace="approvals.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" variant="outline" disabled={pending} className="w-full md:w-auto">
          {t("tools.reassignSubmit")}
        </Button>
      </div>
    </form>
  );
}

/** On a request's own page: a fold under the tools, like handing one's own turn on. */
export function ReassignForm(props: ReassignProps) {
  const t = useTranslations("approvals");
  return (
    <Collapsible className="w-full">
      <CollapsibleTrigger className="press flex h-9 w-full cursor-pointer items-center text-sm font-medium text-link hover:underline">{t("tools.reassign")}</CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-xs text-muted-foreground">{t("tools.reassignHint")}</p>
          <ReassignFields {...props} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** In a row of a list of requests: a key that opens the same form over the page. */
export function ReassignDialog({ summary, ...props }: ReassignProps & { /** The request's one line, so the form says what is being moved. */ summary: string }) {
  const t = useTranslations("approvals");
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>{t("tools.reassignShort")}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("tools.reassign")}</DialogTitle>
          <DialogDescription>
            {summary} — {t("tools.reassignHint")}
          </DialogDescription>
        </DialogHeader>
        <ReassignFields {...props} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
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
