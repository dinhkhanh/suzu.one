"use client";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useRef, useState, useTransition } from "react";
import { Field, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { ACCEPT_ATTRIBUTE } from "@/modules/platform/files/rules";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { DOCUMENT_TIERS } from "../document-tiers";
import { CONTRACT_TYPES, DEPENDENT_RELATIONSHIPS, DOCUMENT_CATEGORIES, JOB_CATEGORIES, SENSITIVE_TEXT_FIELDS } from "../enums";
import {
  addEmergencyContactAction,
  beginAttachmentUploadAction,
  beginDocumentUploadAction,
  completeAttachmentUploadAction,
  completeDocumentUploadAction,
  createContractAction,
  createDependentAction,
  endDependentDeductionAction,
  fileDownloadAction,
  revealContractTermsAction,
  revealSensitiveAction,
  terminateContractAction,
  updateSensitiveAction,
} from "../records-actions";
import type { SensitiveFields, SensitiveSummary } from "../records";

const ERRORS = "records.errors";
const BANK_ROWS = [0, 1];

function Disclosure({ summary, children, formRef }: { summary: string; children: ReactNode; formRef?: React.RefObject<HTMLDetailsElement | null> }) {
  return (
    <details ref={formRef} className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
      <div className="mt-4">{children}</div>
    </details>
  );
}

function SubmitRow({ pending, errorKey }: { pending: boolean; errorKey: string | null }) {
  const t = useTranslations("records");
  return (
    <>
      <FormError namespace={ERRORS} errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </div>
    </>
  );
}

/** A one-click action with a confirm step for destructive ones. Reports failure inline. */
export function RowAction({ action, input, label, confirm, variant = "ghost" }: { action: (input: unknown) => Promise<ActionResult<unknown>>; input: Record<string, unknown>; label: string; confirm?: string; variant?: "ghost" | "outline" }) {
  const t = useTranslations(ERRORS);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        size="xs"
        variant={variant}
        disabled={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          startTransition(async () => {
            const result = await action(input);
            setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
          });
        }}
      >
        {label}
      </Button>
      {errorKey ? <span role="alert" className="text-xs text-destructive">{t.has(errorKey) ? t(errorKey) : t("generic")}</span> : null}
    </span>
  );
}

export function RecordFileLink({ fileId, fileName }: { fileId: string; fileName: string }) {
  return <FileLink fileId={fileId} fileName={fileName} download={fileDownloadAction} />;
}

// ── Restricted details ──────────────────────────────────────────────────────────────────────

type Revealed = SensitiveFields & { dependents: { id: string; idNumber: string | null; taxCode: string | null }[] };

/** Shows which restricted fields are on file; the values arrive only on "Show", and showing is audited. */
export function SensitivePanel({ personId, summary, canManage, dependentNames }: { personId: string; summary: SensitiveSummary; canManage: boolean; dependentNames: Record<string, string> }) {
  const t = useTranslations("records");
  const [revealed, setRevealed] = useState<Revealed | null>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const form = useActionForm(updateSensitiveAction, {
    extra: { personId },
    onSuccess: () => {
      // What is on screen is stale now; the next "Show" reads it back.
      setRevealed(null);
      details.current?.removeAttribute("open");
    },
  });

  const reveal = () =>
    startTransition(async () => {
      const result = await revealSensitiveAction({ personId });
      if (result.ok) setRevealed(result.data);
      setErrorKey(result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));
    });

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SENSITIVE_TEXT_FIELDS.map((field) => (
          <div key={field}>
            <dt className="text-xs text-muted-foreground">{t(`sensitive.fields.${field}`)}</dt>
            <dd className="text-sm">{revealed ? (revealed[field] ?? "—") : summary.filled[field] ? "••••••" : "—"}</dd>
          </div>
        ))}
        <div className="sm:col-span-2">
          <dt className="text-xs text-muted-foreground">{t("sensitive.fields.bankAccounts")}</dt>
          <dd className="text-sm">
            {revealed
              ? revealed.bankAccounts.length
                ? revealed.bankAccounts.map((account) => <div key={account.accountNumber}>{[account.bankName, account.accountNumber, account.accountHolder, account.branch].filter(Boolean).join(" · ")}</div>)
                : "—"
              : summary.filled.bankAccounts
                ? "••••••"
                : "—"}
          </dd>
        </div>
        {revealed?.dependents.some((row) => row.idNumber || row.taxCode) ? (
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t("sensitive.dependentIds")}</dt>
            <dd className="text-sm">
              {revealed.dependents.map((row) => (
                <div key={row.id}>{[dependentNames[row.id], row.idNumber, row.taxCode].filter(Boolean).join(" · ")}</div>
              ))}
            </dd>
          </div>
        ) : null}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={revealed ? () => setRevealed(null) : reveal}>
          {revealed ? t("hide") : t("show")}
        </Button>
        <span className="text-xs text-muted-foreground">{t("sensitive.audited")}</span>
      </div>
      <FormError namespace={ERRORS} errorKey={errorKey} />

      {canManage && revealed ? (
        // Keyed on the values so the defaults follow a fresh reveal.
        <Disclosure summary={t("sensitive.edit")} formRef={details}>
          <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SENSITIVE_TEXT_FIELDS.map((field) => (
                <Field key={field} name={field} label={t(`sensitive.fields.${field}`)}>
                  <Input id={field} name={field} type={field === "nationalIdIssuedOn" ? "date" : "text"} maxLength={200} defaultValue={revealed[field] ?? ""} autoComplete="off" />
                </Field>
              ))}
            </div>
            {BANK_ROWS.map((index) => (
              <fieldset key={index} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <legend className="mb-2 text-xs text-muted-foreground">{t("sensitive.bank.account", { number: index + 1 })}</legend>
                {(["bankName", "accountNumber", "accountHolder", "branch"] as const).map((part) => (
                  <Field key={part} name={`bankAccounts.${index}.${part}`} label={t(`sensitive.bank.${part}`)}>
                    <Input id={`bankAccounts.${index}.${part}`} name={`bankAccounts.${index}.${part}`} maxLength={120} defaultValue={revealed.bankAccounts[index]?.[part] ?? ""} autoComplete="off" />
                  </Field>
                ))}
              </fieldset>
            ))}
            <SubmitRow pending={form.pending} errorKey={form.errorKey} />
          </form>
        </Disclosure>
      ) : null}
    </div>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

export function ContractForm({ personId, parents, canWritePay, today }: { personId: string; parents: { id: string; number: string }[]; canWritePay: boolean; today: string }) {
  const t = useTranslations("records");
  const details = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<(typeof CONTRACT_TYPES)[number]>("fixed_term");
  const { onSubmit, pending, errorKey } = useActionForm(createContractAction, {
    extra: { personId },
    onSuccess: () => {
      formRef.current?.reset();
      details.current?.removeAttribute("open");
    },
  });
  return (
    <Disclosure summary={t("contracts.add")} formRef={details}>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="type" label={t("contracts.type")}>
            <Select id="type" name="type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
              {CONTRACT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`contracts.types.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="number" label={t("contracts.number")}>
            <Input id="number" name="number" required maxLength={60} />
          </Field>
          <Field name="signDate" label={t("contracts.signDate")}>
            <Input id="signDate" name="signDate" type="date" />
          </Field>
          <Field name="startDate" label={t("contracts.startDate")}>
            <Input id="startDate" name="startDate" type="date" required defaultValue={today} />
          </Field>
          {type === "indefinite" ? null : (
            <Field name="endDate" label={t("contracts.endDate")}>
              <Input id="endDate" name="endDate" type="date" required={type === "fixed_term" || type === "probation"} />
            </Field>
          )}
          {type === "probation" ? (
            <Field name="jobCategory" label={t("contracts.jobCategory")}>
              <Select id="jobCategory" name="jobCategory" required defaultValue="professional">
                {JOB_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`contracts.jobCategories.${value}`)}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
          {type === "appendix" ? (
            <Field name="parentContractId" label={t("contracts.parent")}>
              <Select id="parentContractId" name="parentContractId" required defaultValue="">
                <option value="">—</option>
                {parents.map((parent) => (
                  <option key={parent.id} value={parent.id}>
                    {parent.number}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}
        </div>
        {canWritePay ? (
          <Field name="salaryTerms" label={t("contracts.salaryTerms")}>
            <Input id="salaryTerms" name="salaryTerms" maxLength={2000} placeholder={t("contracts.salaryTermsHint")} autoComplete="off" />
          </Field>
        ) : null}
        <Field name="note" label={t("contracts.note")}>
          <Input id="note" name="note" maxLength={500} />
        </Field>
        <SubmitRow pending={pending} errorKey={errorKey} />
      </form>
    </Disclosure>
  );
}

export function TerminateContractForm({ contractId, today }: { contractId: string; today: string }) {
  const t = useTranslations("records");
  const { onSubmit, pending, errorKey } = useActionForm(terminateContractAction, { extra: { contractId } });
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input name="terminatedOn" type="date" required defaultValue={today} aria-label={t("contracts.terminatedOn")} className="w-40" />
      <Button type="submit" size="xs" variant="outline" disabled={pending}>
        {t("contracts.terminate")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

/** Compensation tier only: the pay terms arrive on click, and the click is audited. */
export function ContractTerms({ contractId }: { contractId: string }) {
  const t = useTranslations("records");
  const [terms, setTerms] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (terms !== null) return <span className="text-sm">{terms}</span>;
  return (
    <Button
      type="button"
      size="xs"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await revealContractTermsAction({ contractId });
          // A stale session is told to prove who it is, rather than shown a dash.
          setTerms(result.ok ? (result.data.salaryTerms ?? "—") : result.error === "failed" && result.message === "step_up_required" ? t("errors.step_up_required") : "—");
        })
      }
    >
      {t("contracts.showTerms")}
    </Button>
  );
}

/** Attaches a file to a contract (its signed copy) or a dependent (supporting papers). */
export function AttachmentUpload({ ownerType, ownerId, label }: { ownerType: "contract" | "dependent"; ownerId: string; label: string }) {
  const t = useTranslations("records");
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  return (
    <label className="inline-flex flex-wrap items-center gap-2 text-xs">
      <span className="cursor-pointer underline">{pending ? t("documents.uploading") : label}</span>
      <input
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        disabled={pending}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          startTransition(async () => {
            const result = await uploadThroughSignedUrl(file, (meta) => beginAttachmentUploadAction({ ownerType, ownerId, ...meta }), (fileId) => completeAttachmentUploadAction({ fileId }));
            setErrorKey(result.ok ? null : result.errorKey);
          });
        }}
      />
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </label>
  );
}

// ── Dependents ──────────────────────────────────────────────────────────────────────────────

export function DependentForm({ personId, thisMonth }: { personId: string; thisMonth: string }) {
  const t = useTranslations("records");
  const details = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(createDependentAction, {
    extra: { personId },
    onSuccess: () => {
      formRef.current?.reset();
      details.current?.removeAttribute("open");
    },
  });
  return (
    <Disclosure summary={t("dependents.add")} formRef={details}>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="dependent.fullName" label={t("dependents.fullName")}>
            <Input id="dependent.fullName" name="fullName" required minLength={2} maxLength={120} />
          </Field>
          <Field name="relationship" label={t("dependents.relationship")}>
            <Select id="relationship" name="relationship" defaultValue="child">
              {DEPENDENT_RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {t(`dependents.relationships.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="dependent.dateOfBirth" label={t("dependents.dateOfBirth")}>
            <Input id="dependent.dateOfBirth" name="dateOfBirth" type="date" />
          </Field>
          <Field name="idNumber" label={t("dependents.idNumber")}>
            <Input id="idNumber" name="idNumber" maxLength={40} autoComplete="off" />
          </Field>
          <Field name="dependent.taxCode" label={t("dependents.taxCode")}>
            <Input id="dependent.taxCode" name="taxCode" maxLength={40} autoComplete="off" />
          </Field>
          <div className="hidden lg:block" />
          <Field name="deductionFrom" label={t("dependents.deductionFrom")}>
            <Input id="deductionFrom" name="deductionFrom" type="month" required defaultValue={thisMonth} />
          </Field>
          <Field name="deductionTo" label={t("dependents.deductionTo")}>
            <Input id="deductionTo" name="deductionTo" type="month" />
          </Field>
          <Field name="dependent.note" label={t("dependents.note")}>
            <Input id="dependent.note" name="note" maxLength={500} />
          </Field>
        </div>
        <SubmitRow pending={pending} errorKey={errorKey} />
      </form>
    </Disclosure>
  );
}

export function EndDeductionForm({ dependentId, current }: { dependentId: string; current: string | null }) {
  const t = useTranslations("records");
  const { onSubmit, pending, errorKey } = useActionForm(endDependentDeductionAction, { extra: { dependentId } });
  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-2">
      <Input name="deductionTo" type="month" defaultValue={current?.slice(0, 7) ?? ""} aria-label={t("dependents.deductionTo")} className="w-40" />
      <Button type="submit" size="xs" variant="outline" disabled={pending}>
        {t("dependents.endDeduction")}
      </Button>
      <FormError namespace={ERRORS} errorKey={errorKey} />
    </form>
  );
}

// ── Documents ───────────────────────────────────────────────────────────────────────────────

/** `categories` are the ones this person may file: a category is offered only to those who could read it back. */
export function DocumentUploadForm({ personId, categories }: { personId: string; categories: (typeof DOCUMENT_CATEGORIES)[number][] }) {
  const t = useTranslations("records");
  const details = useRef<HTMLDetailsElement>(null);
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [category, setCategory] = useState(categories[0]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");
    if (!(file instanceof File) || file.size === 0) return setErrorKey("file_empty");
    startTransition(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginDocumentUploadAction({ personId, category, ...meta }),
        (fileId) => completeDocumentUploadAction({ personId, fileId, category, title: data.get("title"), expiresOn: data.get("expiresOn") }),
      );
      setErrorKey(result.ok ? null : result.errorKey);
      if (result.ok) {
        form.reset();
        details.current?.removeAttribute("open");
      }
    });
  }

  return (
    <Disclosure summary={t("documents.add")} formRef={details}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field name="category" label={t("documents.category")}>
            <Select id="category" name="category" value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {t(`documents.categories.${value}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field name="title" label={t("documents.title")}>
            <Input id="title" name="title" required maxLength={200} />
          </Field>
          <Field name="expiresOn" label={t("documents.expiresOn")}>
            <Input id="expiresOn" name="expiresOn" type="date" />
          </Field>
          <Field name="file" label={t("documents.file")}>
            <Input id="file" name="file" type="file" required accept={ACCEPT_ATTRIBUTE} />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">{t(`tierNote.${DOCUMENT_TIERS[category]}`)}</p>
        <FormError namespace={ERRORS} errorKey={errorKey} />
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? t("documents.uploading") : t("documents.upload")}
          </Button>
        </div>
      </form>
    </Disclosure>
  );
}

// ── Emergency contacts ──────────────────────────────────────────────────────────────────────

export function EmergencyContactForm({ personId }: { personId: string }) {
  const t = useTranslations("records");
  const details = useRef<HTMLDetailsElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const { onSubmit, pending, errorKey } = useActionForm(addEmergencyContactAction, {
    extra: { personId },
    onSuccess: () => {
      formRef.current?.reset();
      details.current?.removeAttribute("open");
    },
  });
  return (
    <Disclosure summary={t("contacts.add")} formRef={details}>
      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field name="contact.fullName" label={t("contacts.fullName")}>
            <Input id="contact.fullName" name="fullName" required minLength={2} maxLength={120} />
          </Field>
          <Field name="contact.relationship" label={t("contacts.relationship")}>
            <Input id="contact.relationship" name="relationship" maxLength={60} />
          </Field>
          <Field name="contact.phone" label={t("contacts.phone")}>
            <Input id="contact.phone" name="phone" type="tel" required maxLength={30} />
          </Field>
          <Field name="contact.note" label={t("contacts.note")}>
            <Input id="contact.note" name="note" maxLength={300} />
          </Field>
        </div>
        <SubmitRow pending={pending} errorKey={errorKey} />
      </form>
    </Disclosure>
  );
}
