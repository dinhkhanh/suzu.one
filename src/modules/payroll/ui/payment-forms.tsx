"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import type { SkippedRow } from "../exports/banks";
import {
  beginCashSheetScanAction,
  completeCashSheetScanAction,
  confirmCashReceiptAction,
  generateBankFileAction,
  openCashSheetAction,
  openCashSheetScanAction,
  recordCashDisbursementAction,
  recordOtherPaymentAction,
  removeCashSheetScanAction,
  removeOtherPaymentAction,
} from "../payment-actions";

const ERRORS = "payroll.payments.errors";

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

export type BankChoice = { key: string; name: string; people: number; interbank: number };
/** One of the entity's own paying accounts (FR-PLT-11), as the form offers it. */
export type PayingAccountChoice = { id: string; bank: string; accountNumber: string; accountName: string; branch: string | null; isDefault: boolean };

/**
 * The chief accountant builds one bank's batch (FR-PAY-33). The account the batch debits is picked
 * from the entity's paying accounts at that bank; only an entity with none there still types one,
 * and is told where to configure it.
 */
export function BankFileForm({ runId, entityId, banks, accounts, defaultValueDate }: { runId: string; entityId: string; banks: BankChoice[]; accounts: PayingAccountChoice[]; defaultValueDate: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const [bank, setBank] = useState(banks[0]?.key ?? "");
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
  const chosen = banks.find((choice) => choice.key === bank);
  const configured = accounts.filter((account) => account.bank === bank);

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div>
        <p className="text-sm text-muted-foreground">{t("bank.hint")}</p>
        {/* The formats are reconstructions until the accountant checks them against the bank. */}
        <Alert variant="warning" className="mt-2 text-xs">
          {t("bank.unverified")}
        </Alert>
      </div>
      <FieldErrors value={fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="bank" label={t("bank.bank")}>
            <Select id="bank" name="bank" required value={bank} onChange={(event) => setBank(event.target.value)}>
              {banks.map((choice) => (
                <option key={choice.key} value={choice.key}>
                  {choice.name} ({choice.people})
                </option>
              ))}
            </Select>
          </Field>
          <Field name="valueDate" label={t("bank.valueDate")}>
            <DatePicker id="valueDate" name="valueDate" defaultValue={defaultValueDate} required />
          </Field>
          {configured.length > 0 ? (
            <div className="sm:col-span-2">
              <Field name="payingAccountId" label={t("bank.payingAccount")}>
                {/* Keyed by bank: another bank is another list, starting at that bank's default. */}
                <Select key={bank} id="payingAccountId" name="payingAccountId" required defaultValue={(configured.find((account) => account.isDefault) ?? configured[0]).id}>
                  {configured.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.accountNumber} — {account.accountName}
                      {account.branch ? ` (${account.branch})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          ) : (
            <>
              <Field name="accountNumber" label={t("bank.accountNumber")}>
                <Input id="accountNumber" name="accountNumber" inputMode="numeric" maxLength={32} required />
              </Field>
              <Field name="accountName" label={t("bank.accountName")}>
                <Input id="accountName" name="accountName" maxLength={160} required />
              </Field>
            </>
          )}
        </div>
      </FieldErrors>
      {configured.length === 0 && chosen ? (
        <p className="text-xs text-muted-foreground">
          {t("bank.noPayingAccount", { bank: chosen.name })}{" "}
          <Link href={`/admin/entities/${entityId}`} className="text-link hover:underline">
            {t("bank.configurePayingAccount")}
          </Link>
        </p>
      ) : null}
      {chosen && chosen.interbank > 0 ? <p className="text-xs text-muted-foreground">{t("bank.interbankNote", { count: chosen.interbank, bank: chosen.name })}</p> : null}
      <FormError namespace={ERRORS} errorKey={errorKey} />
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
              <RecordLink kind="person" id={row.personId}>
                {row.fullName}
              </RecordLink>{" "}
              — {t(`bank.skipReasons.${row.reason}` as "bank.skipReasons.no_account")}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}

/**
 * "Paid another way" (PAY-05): the accountant records that one person on the bank channel was paid
 * outside every batch — the day, the bank's reference and why. It settles that person.
 */
export function OtherPaymentForm({ runId, personId, personName, defaultDate }: { runId: string; personId: string; personName: string; defaultDate: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(recordOtherPaymentAction, {
    extra: { runId, personId },
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>{t("other.mark")}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("other.title", { name: personName })}</DialogTitle>
          <DialogDescription>{t("other.hint")}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FieldErrors value={fieldErrors}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field name="paidOn" label={t("other.paidOn")}>
                <DatePicker id="paidOn" name="paidOn" defaultValue={defaultDate} required />
              </Field>
              <Field name="reference" label={t("other.reference")}>
                <Input id="reference" name="reference" maxLength={120} required />
              </Field>
            </div>
            <Field name="reason" label={t("other.reason")}>
              <Input id="reason" name="reason" maxLength={300} required />
            </Field>
          </FieldErrors>
          <FormError namespace={ERRORS} errorKey={errorKey} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? `${t("other.save")}…` : t("other.save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Takes the "paid another way" mark back — a mistake, or the account was fixed after all. */
export function RemoveOtherPaymentButton({ runId, personId }: { runId: string; personId: string }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(removeOtherPaymentAction, { extra: { runId, personId }, onSuccess: () => router.refresh() });
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-1">
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? `${t("other.remove")}…` : t("other.remove")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
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
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/**
 * One person's cash handed over (FR-PAY-39): the day, and how much — the net unless the accountant
 * says otherwise, and then with a note. With `recorded` it is the correction of a row already
 * recorded, opened from a small button.
 */
export function DisbursementForm({ runId, personId, net, defaultDate, recorded }: { runId: string; personId: string; net: number; defaultDate: string; recorded?: { disbursedOn: string; amount: number; note: string | null } }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const [editing, setEditing] = useState(!recorded);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(recordCashDisbursementAction, {
    extra: { runId, personId },
    onSuccess: () => {
      setEditing(false);
      router.refresh();
    },
  });
  if (!editing) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(true)}>
        {t("cash.correct")}
      </Button>
    );
  }
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <FieldErrors value={fieldErrors}>
        <div className="flex flex-wrap items-center gap-2">
          <DatePicker name="disbursedOn" defaultValue={recorded?.disbursedOn ?? defaultDate} required aria-label={t("cash.disbursedOn")} className="w-36" />
          <MoneyInput name="amount" defaultValue={recorded?.amount ?? net} aria-label={t("cash.disbursedAmount")} className="w-36 text-right" />
          <Input name="note" maxLength={300} defaultValue={recorded?.note ?? ""} placeholder={t("cash.notePlaceholder")} aria-label={t("cash.note")} className="w-56" />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "…" : t("cash.record")}
          </Button>
        </div>
      </FieldErrors>
      <FormError namespace={ERRORS} errorKey={errorKey} />
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
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

// ── The signed sheet, scanned (FR-PAY-39) ───────────────────────────────────────────────────

type Upload = { fileId: string; uploadUrl: string; contentType: string };
type Stored = { fileId: string; fileName: string };
/** A scan is a PDF or a picture; the server checks the type and the first bytes all the same. */
const SCAN_ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp";

/** Attaches a scan of the signed paper sheet to the run: straight to storage, then checked. */
export function CashSheetScanUpload({ runId }: { runId: string }) {
  const t = useTranslations("payroll.payments");
  const tErrors = useTranslations(ERRORS);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="cash-sheet-scan">{t("cash.scanAttach")}</Label>
      <input
        id="cash-sheet-scan"
        type="file"
        accept={SCAN_ACCEPT}
        disabled={pending}
        className="text-sm"
        onChange={(event) => {
          const input = event.currentTarget;
          const file = input.files?.[0];
          if (!file) return;
          startTransition(async () => {
            const result = await uploadThroughSignedUrl(
              file,
              (meta) => beginCashSheetScanAction({ runId, ...meta }) as Promise<ActionResult<Upload>>,
              (fileId) => completeCashSheetScanAction({ fileId }) as Promise<ActionResult<Stored>>,
            );
            setError(result.ok ? null : result.errorKey);
            input.value = "";
            if (result.ok) router.refresh();
          });
        }}
      />
      {pending ? <span className="text-xs text-muted-foreground">{t("cash.scanUploading")}</span> : null}
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {tErrors.has(error as "failed") ? tErrors(error as "failed") : tErrors("failed")}
        </span>
      ) : null}
    </div>
  );
}

/** One attached scan: opens through a link made on click (and written to the audit log), never from the page. */
export function CashSheetScanLink({ runId, fileId, fileName, removable }: { runId: string; fileId: string; fileName: string; removable: boolean }) {
  const t = useTranslations("payroll.payments");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(removeCashSheetScanAction, { extra: { runId, fileId }, onSuccess: () => router.refresh() });
  return (
    <span className="flex flex-wrap items-center gap-2">
      <FileLink fileId={fileId} fileName={fileName} download={() => openCashSheetScanAction({ runId, fileId }) as Promise<ActionResult<{ url: string }>>} />
      {removable ? (
        <form onSubmit={onSubmit} className="flex items-center gap-2">
          <Button type="submit" variant="ghost" size="xs" disabled={pending}>
            {t("cash.scanRemove")}
          </Button>
          <FormError namespace={ERRORS} errorKey={errorKey} />
        </form>
      ) : null}
    </span>
  );
}
