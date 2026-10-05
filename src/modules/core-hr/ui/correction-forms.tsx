"use client";
// Correcting what was entered wrong (CHR-02): one "Edit" per record, opening a dialog — a bottom
// sheet on a phone — with the record's fields filled in. What is sealed (a dependent's ID numbers,
// a contract's pay terms) is not shown: a blank field keeps it, and only a reader of pay sees the
// pay field at all. Every save goes through its own audited action; the actions re-check.
import { PencilIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { DatePicker, MonthPicker } from "@/components/ui/date-picker";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { correctEmploymentAction, removePersonAction, renamePositionAction } from "../correction-actions";
import { CONTRACT_TYPES, DEPENDENT_RELATIONSHIPS, JOB_CATEGORIES } from "../enums";
import { updateContractAction, updateDependentAction, updateDocumentAction, updateEmergencyContactAction } from "../records-actions";
import type { ContractView, DependentView, DocumentView, EmergencyContactRow } from "../records";

/** The "Edit" key and its dialog. The form inside closes it when the save went through. */
function EditDialog<T>({ title, description, action, extra, errors = "records.errors", wide, children }: { title: string; description?: string; action: (input: unknown) => Promise<ActionResult<T>>; extra: Record<string, unknown>; errors?: string; wide?: boolean; children: ReactNode }) {
  const t = useTranslations("records");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { onSubmit, pending, errorKey, fieldErrors } = useActionForm(action, {
    extra,
    onSuccess: () => {
      setOpen(false);
      router.refresh();
    },
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" size="xs" aria-label={title} />}>
        <PencilIcon />
        <span className="hidden sm:inline">{t("edit")}</span>
      </DialogTrigger>
      <DialogContent className={wide ? "sm:max-w-2xl" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <FieldErrors value={fieldErrors}>{children}</FieldErrors>
          <FormError namespace={errors} errorKey={errorKey} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? t("saving") : t("save")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Contracts ───────────────────────────────────────────────────────────────────────────────

export function EditContractButton({ contract, parents, canWritePay }: { contract: ContractView; parents: { id: string; number: string }[]; canWritePay: boolean }) {
  const t = useTranslations("records");
  const [type, setType] = useState(contract.type);
  const id = (name: string) => `contract-${contract.id}-${name}`;
  return (
    <EditDialog title={t("contracts.editTitle", { number: contract.number })} description={t("contracts.editHint")} action={updateContractAction} extra={{ contractId: contract.id }} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="type" label={t("contracts.type")}>
          <Select id={id("type")} name="type" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            {CONTRACT_TYPES.map((value) => (
              <option key={value} value={value}>
                {t(`contracts.types.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="number" label={t("contracts.number")}>
          <Input id={id("number")} name="number" required maxLength={60} defaultValue={contract.number} />
        </Field>
        <Field name="signDate" label={t("contracts.signDate")}>
          <DatePicker id={id("signDate")} name="signDate" defaultValue={contract.signDate ?? ""} />
        </Field>
        <Field name="startDate" label={t("contracts.startDate")}>
          <DatePicker id={id("startDate")} name="startDate" required defaultValue={contract.startDate} />
        </Field>
        {type === "indefinite" ? null : (
          <Field name="endDate" label={t("contracts.endDate")}>
            <DatePicker id={id("endDate")} name="endDate" required={type === "fixed_term" || type === "probation"} defaultValue={contract.endDate ?? ""} />
          </Field>
        )}
        {type === "probation" ? (
          <Field name="jobCategory" label={t("contracts.jobCategory")}>
            <Select id={id("jobCategory")} name="jobCategory" required defaultValue={contract.jobCategory ?? "professional"}>
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
            <Select id={id("parent")} name="parentContractId" required defaultValue={contract.parentContractId ?? ""}>
              <option value="">—</option>
              {parents
                .filter((parent) => parent.id !== contract.id)
                .map((parent) => (
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
          <Input id={id("salaryTerms")} name="salaryTerms" maxLength={2000} placeholder={t("contracts.salaryTermsKeep")} autoComplete="off" />
        </Field>
      ) : null}
      <Field name="note" label={t("contracts.note")}>
        <Input id={id("note")} name="note" maxLength={500} defaultValue={contract.note ?? ""} />
      </Field>
    </EditDialog>
  );
}

// ── Dependents ──────────────────────────────────────────────────────────────────────────────

export function EditDependentButton({ dependent }: { dependent: DependentView }) {
  const t = useTranslations("records");
  const id = (name: string) => `dependent-${dependent.id}-${name}`;
  return (
    <EditDialog title={t("dependents.editTitle", { name: dependent.fullName })} description={t("dependents.editHint")} action={updateDependentAction} extra={{ dependentId: dependent.id }} wide>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="fullName" label={t("dependents.fullName")}>
          <Input id={id("fullName")} name="fullName" required minLength={2} maxLength={120} defaultValue={dependent.fullName} />
        </Field>
        <Field name="relationship" label={t("dependents.relationship")}>
          <Select id={id("relationship")} name="relationship" defaultValue={dependent.relationship}>
            {DEPENDENT_RELATIONSHIPS.map((value) => (
              <option key={value} value={value}>
                {t(`dependents.relationships.${value}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field name="dateOfBirth" label={t("dependents.dateOfBirth")}>
          <DatePicker id={id("dateOfBirth")} name="dateOfBirth" defaultValue={dependent.dateOfBirth ?? ""} />
        </Field>
        <Field name="idNumber" label={t("dependents.idNumber")}>
          <Input id={id("idNumber")} name="idNumber" maxLength={40} autoComplete="off" placeholder={dependent.hasIdNumber ? t("keepSealed") : ""} />
        </Field>
        <Field name="taxCode" label={t("dependents.taxCode")}>
          <Input id={id("taxCode")} name="taxCode" maxLength={40} autoComplete="off" placeholder={dependent.hasTaxCode ? t("keepSealed") : ""} />
        </Field>
        <Field name="deductionFrom" label={t("dependents.deductionFrom")}>
          <MonthPicker id={id("deductionFrom")} name="deductionFrom" required defaultValue={dependent.deductionFrom.slice(0, 7)} />
        </Field>
        <Field name="deductionTo" label={t("dependents.deductionTo")}>
          <MonthPicker id={id("deductionTo")} name="deductionTo" defaultValue={dependent.deductionTo?.slice(0, 7) ?? ""} />
        </Field>
        <Field name="note" label={t("dependents.note")}>
          <Input id={id("note")} name="note" maxLength={500} defaultValue={dependent.note ?? ""} />
        </Field>
      </div>
    </EditDialog>
  );
}

// ── Emergency contacts and the vault ────────────────────────────────────────────────────────

export function EditContactButton({ contact }: { contact: Pick<EmergencyContactRow, "id" | "fullName" | "relationship" | "phone" | "note"> }) {
  const t = useTranslations("records");
  const id = (name: string) => `contact-${contact.id}-${name}`;
  return (
    <EditDialog title={t("contacts.editTitle", { name: contact.fullName })} action={updateEmergencyContactAction} extra={{ contactId: contact.id }}>
      <Field name="fullName" label={t("contacts.fullName")}>
        <Input id={id("fullName")} name="fullName" required minLength={2} maxLength={120} defaultValue={contact.fullName} />
      </Field>
      <Field name="relationship" label={t("contacts.relationship")}>
        <Input id={id("relationship")} name="relationship" maxLength={60} defaultValue={contact.relationship ?? ""} />
      </Field>
      <Field name="phone" label={t("contacts.phone")}>
        <Input id={id("phone")} name="phone" type="tel" required maxLength={30} defaultValue={contact.phone} />
      </Field>
      <Field name="note" label={t("contacts.note")}>
        <Input id={id("note")} name="note" maxLength={300} defaultValue={contact.note ?? ""} />
      </Field>
    </EditDialog>
  );
}

export function EditDocumentButton({ document }: { document: Pick<DocumentView, "id" | "title" | "expiresOn"> }) {
  const t = useTranslations("records");
  const id = (name: string) => `vault-${document.id}-${name}`;
  return (
    <EditDialog title={t("documents.editTitle", { title: document.title })} description={t("documents.editHint")} action={updateDocumentAction} extra={{ documentId: document.id }}>
      <Field name="title" label={t("documents.title")}>
        <Input id={id("title")} name="title" required maxLength={200} defaultValue={document.title} />
      </Field>
      <Field name="expiresOn" label={t("documents.expiresOn")}>
        <DatePicker id={id("expiresOn")} name="expiresOn" defaultValue={document.expiresOn ?? ""} />
      </Field>
    </EditDialog>
  );
}

// ── An employment period, a position, a person created in error ─────────────────────────────

export function CorrectEmploymentButton({ employment }: { employment: { id: string; employeeCode: string; startDate: string; seniorityDate: string } }) {
  const t = useTranslations("people");
  const id = (name: string) => `employment-${employment.id}-${name}`;
  return (
    <EditDialog title={t("corrections.employmentTitle", { code: employment.employeeCode })} description={t("corrections.employmentHint")} action={correctEmploymentAction} extra={{ employmentId: employment.id }} errors="people.errors">
      <Field name="employeeCode" label={t("fields.employeeCode")}>
        <Input id={id("employeeCode")} name="employeeCode" required maxLength={30} defaultValue={employment.employeeCode} className="font-mono" />
      </Field>
      <Field name="startDate" label={t("fields.startDate")}>
        <DatePicker id={id("startDate")} name="startDate" required defaultValue={employment.startDate} />
      </Field>
      <Field name="seniorityDate" label={t("fields.seniorityDate")}>
        <DatePicker id={id("seniorityDate")} name="seniorityDate" required defaultValue={employment.seniorityDate} />
      </Field>
    </EditDialog>
  );
}

export function RenamePositionButton({ entry }: { entry: { id: string; name: string; holders: number } }) {
  const t = useTranslations("people");
  return (
    <EditDialog title={t("positions.renameTitle", { name: entry.name })} description={t("positions.renameHint", { count: entry.holders })} action={renamePositionAction} extra={{ positionId: entry.id }} errors="people.errors">
      <Field name="name" label={t("positions.name")}>
        <Input id={`position-${entry.id}-name`} name="name" required maxLength={120} defaultValue={entry.name} autoComplete="off" />
      </Field>
    </EditDialog>
  );
}

/** HR's last resort for a record that should never have been made. The name is typed back; the service refuses when anything else names the person. */
export function RemovePersonForm({ personId, fullName }: { personId: string; fullName: string }) {
  const t = useTranslations("people");
  const router = useRouter();
  const { onSubmit, pending, errorKey } = useActionForm(removePersonAction, { extra: { personId }, onSuccess: () => router.push("/people") });
  return (
    <details className="rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium text-destructive">{t("corrections.removeTitle")}</summary>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">{t("corrections.removeHint")}</p>
        <Field name="confirmName" label={t("corrections.removeConfirm", { name: fullName })}>
          <Input id={`remove-${personId}`} name="confirmName" required autoComplete="off" />
        </Field>
        <FormError namespace="people.errors" errorKey={errorKey} />
        <div>
          <Button type="submit" variant="destructive" disabled={pending}>
            {t("corrections.removeSubmit")}
          </Button>
        </div>
      </form>
    </details>
  );
}
