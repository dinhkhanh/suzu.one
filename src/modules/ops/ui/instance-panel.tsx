"use client";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FileLink, uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { beginEvidenceUploadAction, cancelObligationAction, completeEvidenceUploadAction, completeObligationAction, openEvidenceFileAction, reassignObligationAction, removeEvidenceFileAction, reopenObligationAction, saveObligationProgressAction } from "../actions";
import type { EvidenceKey, EvidenceRequirement } from "../enums";

type Failure = { ok: boolean; error?: string; message?: string; details?: unknown };
const keyOf = (result: Failure) => (result.ok ? null : ((result.error === "failed" ? result.message : result.error) ?? "generic"));

export type EvidenceFile = { id: string; fileName: string; sizeBytes: number; uploadedByName: string | null; createdAt: string; canRemove: boolean };

export type InstancePanelProps = {
  taskId: string;
  open: boolean;
  canWork: boolean;
  canManage: boolean;
  checklist: string[];
  checklistState: Record<string, boolean>;
  required: EvidenceRequirement;
  evidence: { referenceNumber: string | null; submittedDate: string | null; amountPaid: number | null; note: string | null };
  files: EvidenceFile[];
  accept: string;
  today: string;
};

/** Steps, evidence and the close button of one obligation (FR-OPS-05). The server decides what is missing; this only shows it. */
export function InstancePanel({ taskId, open, canWork, canManage, checklist, checklistState, required, evidence, files, accept, today }: InstancePanelProps) {
  const t = useTranslations("ops.instance");
  const format = useFormatter();
  const router = useRouter();
  const editable = open && canWork;
  const form = useActionForm(saveObligationProgressAction, { extra: { taskId }, onSuccess: () => router.refresh() });
  const [pending, startTransition] = useTransition();
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [missing, setMissing] = useState<{ evidence: EvidenceKey[]; checklist: number[] } | null>(null);

  const run = (work: () => Promise<Failure>) =>
    startTransition(async () => {
      const result = await work();
      setErrorKey(keyOf(result));
      setMissing(!result.ok && result.message === "obligation_evidence_missing" ? (result.details as { evidence: EvidenceKey[]; checklist: number[] }) : null);
      router.refresh();
    });
  const star = (key: EvidenceKey) => (required[key] ? " *" : "");
  const size = (bytes: number) => (bytes >= 1_048_576 ? `${format.number(bytes / 1_048_576, { maximumFractionDigits: 1 })} MB` : `${format.number(Math.max(1, Math.round(bytes / 1024)))} KB`);

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={form.onSubmit} className="flex flex-col gap-4">
        <FieldErrors value={form.fieldErrors}>
          {checklist.length ? (
            <fieldset className="flex flex-col gap-2" disabled={!editable}>
              <legend className="mb-1 text-sm font-medium text-muted-foreground">{t("checklist")}</legend>
              {checklist.map((step, index) => (
                <label key={index} className="flex items-start gap-2 text-sm">
                  <input type="checkbox" name={`checklist.${index}`} defaultChecked={!!checklistState[String(index)]} className="mt-0.5" />
                  <span className={missing?.checklist.includes(index) ? "text-destructive" : undefined}>{step}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <fieldset className="grid gap-4 sm:grid-cols-3" disabled={!editable}>
            <legend className="mb-2 text-sm font-medium text-muted-foreground">{t("evidence")}</legend>
            <Field name="referenceNumber" label={`${t("referenceNumber")}${star("reference")}`}>
              <Input id="referenceNumber" name="referenceNumber" defaultValue={evidence.referenceNumber ?? ""} maxLength={120} />
            </Field>
            <Field name="submittedDate" label={`${t("submittedDate")}${star("submittedDate")}`}>
              <Input id="submittedDate" name="submittedDate" type="date" max={today} defaultValue={evidence.submittedDate ?? ""} />
            </Field>
            <Field name="amountPaid" label={`${t("amountPaid")}${star("amount")}`}>
              <Input id="amountPaid" name="amountPaid" inputMode="numeric" defaultValue={evidence.amountPaid === null ? "" : format.number(evidence.amountPaid)} />
            </Field>
            <div className="sm:col-span-3">
              <Field name="note" label={t("note")}>
                <textarea id="note" name="note" rows={2} maxLength={2000} defaultValue={evidence.note ?? ""} className="w-full rounded-md border bg-transparent px-3 py-2 text-sm" />
              </Field>
            </div>
          </fieldset>
        </FieldErrors>
        {editable ? (
          <div className="flex items-center gap-3">
            <Button type="submit" variant="outline" disabled={form.pending}>
              {t("save")}
            </Button>
            {form.saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
          </div>
        ) : null}
        <FormError namespace="ops.errors" errorKey={form.errorKey} />
      </form>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">
          {t("files", { count: files.length })}
          {star("file")}
        </h2>
        {files.length ? (
          <ul className="flex flex-col divide-y rounded-xl border text-sm">
            {files.map((file) => (
              <li key={file.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  <FileLink fileId={file.id} fileName={file.fileName} download={openEvidenceFileAction} onError={setErrorKey} />
                </span>
                <span className="text-xs text-muted-foreground">{[size(file.sizeBytes), file.uploadedByName, format.dateTime(new Date(file.createdAt), { dateStyle: "short" })].filter(Boolean).join(" · ")}</span>
                {file.canRemove && open ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => removeEvidenceFileAction({ fileId: file.id }))}>
                    {t("removeFile")}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noFiles")}</p>
        )}
        {editable ? (
          <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
            <input
              type="file"
              accept={accept}
              disabled={pending}
              aria-label={t("addFile")}
              className="text-sm file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-sm"
              onChange={(event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                run(async () => {
                  const result = await uploadThroughSignedUrl(
                    file,
                    (meta) => beginEvidenceUploadAction({ taskId, ...meta }),
                    (fileId) => completeEvidenceUploadAction({ fileId }),
                  );
                  input.value = "";
                  return result.ok ? { ok: true } : { ok: false, error: "failed", message: result.errorKey };
                });
              }}
            />
            {pending ? <span className="text-xs text-muted-foreground">{t("uploading")}</span> : null}
          </label>
        ) : null}
      </section>

      {missing ? (
        <div role="alert" className="rounded-xl border border-destructive/40 p-3 text-sm text-destructive">
          <p className="font-medium">{t("missingTitle")}</p>
          <ul className="list-disc pl-5">
            {missing.evidence.map((key) => (
              <li key={key}>{t(`missing.${key}`)}</li>
            ))}
            {missing.checklist.length ? <li>{t("missing.checklist", { count: missing.checklist.length })}</li> : null}
          </ul>
        </div>
      ) : (
        <FormError namespace="ops.errors" errorKey={errorKey} />
      )}

      <div className="flex flex-wrap items-center gap-2">
        {editable ? (
          <Button disabled={pending} onClick={() => run(() => completeObligationAction({ taskId }))}>
            {t("complete")}
          </Button>
        ) : null}
        {canManage ? <ReasonButton label={open ? t("cancel") : t("reopen")} placeholder={t("reason")} confirm={t("confirm")} disabled={pending} onConfirm={(reason) => run(() => (open ? cancelObligationAction({ taskId, reason }) : reopenObligationAction({ taskId, reason })))} /> : null}
      </div>
    </div>
  );
}

function ReasonButton({ label, placeholder, confirm, disabled, onConfirm }: { label: string; placeholder: string; confirm: string; disabled: boolean; onConfirm: (reason: string) => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (!asking)
    return (
      <Button variant="ghost" disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Input aria-label={placeholder} placeholder={placeholder} value={reason} onChange={(event) => setReason(event.target.value)} className="w-64" maxLength={1000} />
      <Button
        variant="outline"
        disabled={disabled || reason.trim().length < 3}
        onClick={() => {
          onConfirm(reason.trim());
          setAsking(false);
          setReason("");
        }}
      >
        {confirm}: {label}
      </Button>
    </span>
  );
}

/** Owner and reviewer pickers, for people who manage obligations in the entity. */
export function ReassignForm({ taskId, people, assigneePersonId, reviewerPersonId }: { taskId: string; people: { id: string; fullName: string }[]; assigneePersonId: string | null; reviewerPersonId: string | null }) {
  const t = useTranslations("ops.instance");
  const router = useRouter();
  const form = useActionForm(reassignObligationAction, { extra: { taskId }, onSuccess: () => router.refresh() });
  const options = (
    <>
      <option value="">{t("nobody")}</option>
      {people.map((person) => (
        <option key={person.id} value={person.id}>
          {person.fullName}
        </option>
      ))}
    </>
  );
  return (
    <form onSubmit={form.onSubmit} className="flex flex-wrap items-end gap-3">
      <Field name="assigneePersonId" label={t("owner")}>
        <Select id="assigneePersonId" name="assigneePersonId" defaultValue={assigneePersonId ?? ""} className="w-56">
          {options}
        </Select>
      </Field>
      <Field name="reviewerPersonId" label={t("reviewer")}>
        <Select id="reviewerPersonId" name="reviewerPersonId" defaultValue={reviewerPersonId ?? ""} className="w-56">
          {options}
        </Select>
      </Field>
      <Button type="submit" variant="outline" disabled={form.pending}>
        {t("reassign")}
      </Button>
      <FormError namespace="ops.errors" errorKey={form.errorKey} />
    </form>
  );
}
