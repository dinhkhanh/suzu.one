"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { closePayslipQueryAction, publishPayslipsAction, raisePayslipQueryAction, replyToPayslipQueryAction } from "../payslip-actions";

const TEXTAREA = "min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm";

/** C&B releases an approved run to the people in it (FR-PAY-32). */
export function PublishPayslipsButton({ runId, published }: { runId: string; published: boolean }) {
  const t = useTranslations("payroll.payslips");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(publishPayslipsAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" disabled={pending} variant={published ? "outline" : "default"}>
        {pending ? `${t("publish")}…` : t(published ? "publishAgain" : "publish")}
      </Button>
      <FormError namespace="payroll.payslips.errors" errorKey={errorKey} />
    </form>
  );
}

/** The employee asks C&B about their own payslip. */
export function PayslipQueryForm({ payslipId }: { payslipId: string }) {
  const t = useTranslations("payroll.payslips.queries");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(raisePayslipQueryAction, { extra: { payslipId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h3 className="text-sm font-medium">{t("ask")}</h3>
      <p className="text-sm text-muted-foreground">{t("askHint")}</p>
      <FieldErrors value={fieldErrors}>
        <Field name="body" label={t("question")}>
          <textarea id="body" name="body" rows={3} maxLength={4000} required className={TEXTAREA} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.payslips.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? `${t("send")}…` : t("send")}
        </Button>
      </div>
    </form>
  );
}

/** Either side adds to an open thread. */
export function PayslipReplyForm({ queryId }: { queryId: string }) {
  const t = useTranslations("payroll.payslips.queries");
  const router = useRouter();
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(replyToPayslipQueryAction, { extra: { queryId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={fieldErrors}>
        <Field name="body" label={t("reply")}>
          <textarea id={`reply-${queryId}`} name="body" rows={2} maxLength={4000} required className={TEXTAREA} />
        </Field>
      </FieldErrors>
      <FormError namespace="payroll.payslips.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? `${t("send")}…` : t("send")}
        </Button>
      </div>
    </form>
  );
}

export function ClosePayslipQueryButton({ queryId }: { queryId: string }) {
  const t = useTranslations("payroll.payslips.queries");
  const router = useRouter();
  const { onSubmit, pending } = useActionForm(closePayslipQueryAction, { extra: { queryId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit}>
      <Button type="submit" size="sm" variant="outline" disabled={pending}>
        {t("close")}
      </Button>
    </form>
  );
}
