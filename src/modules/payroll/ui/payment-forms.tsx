"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { confirmCashReceiptAction, generateBankFileAction, openCashSheetAction, recordCashDisbursementAction } from "../payment-actions";
import type { SkippedRow } from "../exports/banks";

type Generated = { fileName: string; content: string; contentType: string; rowCount: number; skipped: SkippedRow[] };

/** Hands the generated text to the browser as a download. It is never stored on the server. */
function save(file: Generated) {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}

/** The chief accountant builds one bank's batch (FR-PAY-33). */
export function BankFileForm({ runId, banks, defaultValueDate }: { runId: string; banks: { key: string; name: string; people: number }[]; defaultValueDate: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const [generated, setGenerated] = useState<Generated | null>(null);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(generateBankFileAction, {
    extra: { runId },
    onSuccess: (data) => {
      const file = data as Generated;
      setGenerated(file);
      save(file);
      router.refresh();
    },
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <div>
        <h2 className="text-sm font-medium">{t("bank.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("bank.hint")}</p>
        {/* The formats are reconstructions until the accountant checks them against the bank. */}
        <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 text-xs">{t("bank.unverified")}</p>
      </div>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="bank" label={t("bank.bank")}>
            <Select id="bank" name="bank" required>
              {banks.map((bank) => (
                <option key={bank.key} value={bank.key}>
                  {bank.name} ({bank.people})
                </option>
              ))}
            </Select>
          </Field>
          <Field name="valueDate" label={t("bank.valueDate")}>
            <Input id="valueDate" name="valueDate" type="date" defaultValue={defaultValueDate} required />
          </Field>
          <Field name="accountNumber" label={t("bank.accountNumber")}>
            <Input id="accountNumber" name="accountNumber" inputMode="numeric" maxLength={32} required />
          </Field>
          <Field name="accountName" label={t("bank.accountName")}>
            <Input id="accountName" name="accountName" maxLength={160} required />
          </Field>
        </div>
      </FieldErrors>
      <FormError namespace="payroll.payments.errors" errorKey={errorKey} />
      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={pending || banks.length === 0}>
          {pending ? `${t("bank.generate")}…` : t("bank.generate")}
        </Button>
        {generated ? (
          <span className="text-sm text-muted-foreground">
            {t("bank.generated", { file: generated.fileName, rows: generated.rowCount })}
            <button type="button" className="ml-2 underline" onClick={() => save(generated)}>
              {t("bank.saveAgain")}
            </button>
          </span>
        ) : null}
      </div>
      {generated && generated.skipped.length > 0 ? (
        <ul className="rounded-md border border-destructive/40 p-3 text-sm">
          <li className="font-medium">{t("bank.skippedTitle")}</li>
          {generated.skipped.map((row) => (
            <li key={row.personId} className="text-muted-foreground">
              {row.fullName} — {t(`bank.skipReasons.${row.reason}` as "bank.skipReasons.no_account")}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

export function OpenCashSheetButton({ runId, opened }: { runId: string; opened: boolean }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(openCashSheetAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <Button type="submit" variant={opened ? "outline" : "default"} disabled={pending}>
        {pending ? `${t("cash.open")}…` : t(opened ? "cash.refresh" : "cash.open")}
      </Button>
      <FormError namespace="payroll.payments.errors" errorKey={errorKey} />
    </form>
  );
}

/** One person's cash handed over, dated and signed for by the accountant. */
export function DisbursementForm({ runId, personId, defaultDate }: { runId: string; personId: string; defaultDate: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(recordCashDisbursementAction, { extra: { runId, personId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <Input name="disbursedOn" type="date" defaultValue={defaultDate} required aria-label={t("cash.disbursedOn")} className="w-36" />
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "…" : t("cash.record")}
      </Button>
      <FormError namespace="payroll.payments.errors" errorKey={errorKey} />
    </form>
  );
}

/** The employee's own confirmation that they took the money (FR-PAY-39). */
export function ConfirmReceiptButton({ runId }: { runId: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(confirmCashReceiptAction, { extra: { runId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? `${t("cash.confirm")}…` : t("cash.confirm")}
      </Button>
      <FormError namespace="payroll.payments.errors" errorKey={errorKey} />
    </form>
  );
}
