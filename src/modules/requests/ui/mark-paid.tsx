"use client";
// "Record as paid" (REQ-01): finance types the day and the transfer reference; the figure is the
// server's — the amount less any advance netted against it — and is only shown here.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { markRequestPaidAction } from "../actions";

export function MarkPaidButton({ requestId, summary, figure, defaultDate }: { requestId: string; summary: string; /** Already formatted: what will be recorded. */ figure: string; defaultDate: string }) {
  const t = useTranslations("requests.pay");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(markRequestPaidAction, {
    extra: { requestId },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>{t("mark")}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("markTitle", { summary })}</DialogTitle>
          <DialogDescription>{t("markHint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <p className="flex items-baseline justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t("figure")}</span>
            <span className="font-mono font-medium tabular-nums">{figure}</span>
          </p>
          <FieldErrors value={fieldErrors}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="paidOn" label={t("paidOn")}>
                <DatePicker id="paidOn" name="paidOn" defaultValue={defaultDate} max={defaultDate} required />
              </Field>
              <Field name="reference" label={t("reference")}>
                <Input id="reference" name="reference" maxLength={120} required />
              </Field>
            </div>
          </FieldErrors>
          <FormError namespace="requests.errors" errorKey={errorKey} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? `${t("save")}…` : t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
