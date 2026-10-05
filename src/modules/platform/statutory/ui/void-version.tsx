"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";

type VoidAction = (input: unknown) => Promise<ActionResult<unknown>>;

/**
 * Takes back an approved version that was wrong (PAY-13) — a statutory value, a pay component, a
 * pay policy, a pay profile or a salary structure. The same dialog for each: what voiding does,
 * and a reason, which is required and stays on the version for good. The action decides who may
 * and refuses a version a paid run was worked out from; this only asks.
 */
export function VoidVersionButton({ action, id, title, errorNamespace }: { action: VoidAction; id: string; /** Which version, for the dialog's title: "Lương cơ bản từ 01/09/2026". */ title: string; errorNamespace: string }) {
  const t = useTranslations("rules.void");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(action, {
    extra: { id },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" className="text-destructive" />}>{t("label")}</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title", { version: title })}</DialogTitle>
          <DialogDescription>{t("hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FieldErrors value={fieldErrors}>
            <Field name={`void-reason-${id}`} label={t("reason")}>
              <Textarea id={`void-reason-${id}`} name="reason" required minLength={3} maxLength={500} rows={3} />
            </Field>
          </FieldErrors>
          <FormError namespace={errorNamespace} errorKey={errorKey} />
          <div>
            <Button type="submit" variant="destructive" disabled={pending} className="w-full md:w-auto">
              {pending ? `${t("confirm")}…` : t("confirm")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
