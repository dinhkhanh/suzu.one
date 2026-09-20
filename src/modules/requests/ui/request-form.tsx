"use client";
// The form an administrator designed, on screen (FR-REQ-01). It renders whatever the definition
// says and re-runs the *same* visibility rules as the server, so what a person sees is exactly
// what will be stored — the engine is the single source of truth and this file only draws it.
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ActionResult } from "@/lib/action";
import { uploadThroughSignedUrl } from "@/modules/platform/files/ui/signed-upload";
import { type FieldValue, type FormDefinition, type FormField, type FormValues, MAX_TEXT, validateSubmission, visibleFields } from "../engine/form";
import { beginRequestAttachmentAction, completeRequestAttachmentAction } from "../file-actions";

type Submit = (input: unknown) => Promise<ActionResult<{ requestId: string }>>;

const emptyValue = (field: FormField): FieldValue => (field.type === "checkbox" ? false : field.type === "multi_select" || field.type === "file" ? [] : "");

export function RequestForm({
  form,
  submit,
  extra,
  initialValues,
  people,
  entities,
  submitLabel,
  addendum,
  addendumInvalid,
}: {
  form: FormDefinition;
  submit: Submit;
  /** `{ code }` when filing, `{ requestId }` when sending a returned request round again. */
  extra: Record<string, unknown>;
  initialValues?: FormValues;
  people: { id: string; fullName: string }[];
  entities: { id: string; name: string }[];
  submitLabel: string;
  /** What a type that is more than a form adds: an expense claim's lines (FR-REQ-03). */
  addendum?: React.ReactNode;
  /** True while the addendum is not ready to be sent; the button stays disabled. */
  addendumInvalid?: boolean;
}) {
  const t = useTranslations("requests");
  const locale = useLocale();
  const router = useRouter();
  const [values, setValues] = useState<FormValues>(() => Object.fromEntries(form.fields.map((field) => [field.key, initialValues?.[field.key] ?? emptyValue(field)])));
  const [fileNames, setFileNames] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const shown = visibleFields(form, values);
  // The same check the action runs, so a mistake is caught before a round trip.
  const problems = Object.fromEntries(validateSubmission(form, values).problems.map((problem) => [problem.field, [problem.problem]]));
  const [touched, setTouched] = useState(false);
  const label = (field: { labelVi: string; labelEn: string }) => (locale === "en" ? field.labelEn : field.labelVi);
  const hint = (field: FormField) => (locale === "en" ? field.hintEn : field.hintVi) ?? null;
  const set = (key: string, value: FieldValue) => setValues((current) => ({ ...current, [key]: value }));

  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(problems).length > 0 || addendumInvalid) return;
    startTransition(async () => {
      // Only what is on screen: a hidden field's answer is nobody's business, here or on the server.
      const payload = Object.fromEntries(shown.map((field) => [field.key, values[field.key] ?? null]));
      const result = await submit({ ...extra, values: payload });
      if (result.ok) {
        setErrorKey(null);
        router.push(`/approvals/request/${result.data.requestId}`);
      } else setErrorKey((result.error === "failed" ? result.message : result.error) ?? "generic");
    });
  }

  function upload(field: FormField, file: File | undefined) {
    if (!file) return;
    setUploadError(null);
    setUploading(field.key);
    startTransition(async () => {
      const result = await uploadThroughSignedUrl(
        file,
        (meta) => beginRequestAttachmentAction(meta) as Promise<ActionResult<{ fileId: string; uploadUrl: string; contentType: string }>>,
        (fileId) => completeRequestAttachmentAction({ fileId }) as Promise<ActionResult<{ fileId: string; fileName: string }>>,
      );
      setUploading(null);
      if (!result.ok) return setUploadError(result.errorKey);
      setFileNames((current) => ({ ...current, [result.data.fileId]: result.data.fileName }));
      set(field.key, [...((values[field.key] as string[] | undefined) ?? []), result.data.fileId]);
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={touched ? problems : {}}>
        {shown.map((field) => (
          <Field key={field.key} name={field.key} label={`${label(field)}${field.required ? " *" : ""}`}>
            <FieldInput field={field} value={values[field.key]} set={(value) => set(field.key, value)} locale={locale} people={people} entities={entities} fileNames={fileNames} upload={(file) => upload(field, file)} uploading={uploading === field.key} t={t} />
            {hint(field) ? <p className="text-xs text-muted-foreground">{hint(field)}</p> : null}
          </Field>
        ))}
      </FieldErrors>
      {uploadError ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${uploadError}`) ? t(`errors.${uploadError}` as "errors.generic") : t("errors.generic")}
        </p>
      ) : null}
      {addendum}
      <FormError namespace="requests.errors" errorKey={errorKey} />
      <div>
        <Button type="submit" disabled={pending || addendumInvalid}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function FieldInput({
  field,
  value,
  set,
  locale,
  people,
  entities,
  fileNames,
  upload,
  uploading,
  t,
}: {
  field: FormField;
  value: FieldValue;
  set: (value: FieldValue) => void;
  locale: string;
  people: { id: string; fullName: string }[];
  entities: { id: string; name: string }[];
  fileNames: Record<string, string>;
  upload: (file: File | undefined) => void;
  uploading: boolean;
  t: ReturnType<typeof useTranslations<"requests">>;
}) {
  const optionLabel = (option: { labelVi: string; labelEn: string }) => (locale === "en" ? option.labelEn : option.labelVi);
  const text = typeof value === "string" ? value : "";

  switch (field.type) {
    case "textarea":
      return <textarea id={field.key} name={field.key} rows={4} value={text} maxLength={Math.min(field.maxLength ?? MAX_TEXT, MAX_TEXT)} onChange={(event) => set(event.target.value)} className="rounded-lg border bg-transparent px-2.5 py-1.5 text-sm" />;
    case "number":
    case "money":
      return <Input id={field.key} name={field.key} inputMode="numeric" value={text} onChange={(event) => set(event.target.value)} placeholder={field.type === "money" ? "0" : undefined} />;
    case "date":
      return <Input id={field.key} name={field.key} type="date" value={text} min={field.minDate ?? undefined} max={field.maxDate ?? undefined} onChange={(event) => set(event.target.value)} />;
    case "checkbox":
      return <input id={field.key} name={field.key} type="checkbox" className="size-4" checked={value === true} onChange={(event) => set(event.target.checked)} />;
    case "select":
      return (
        <Select id={field.key} name={field.key} value={text} onChange={(event) => set(event.target.value)}>
          <option value="">—</option>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {optionLabel(option)}
            </option>
          ))}
        </Select>
      );
    case "multi_select": {
      const chosen = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-3">
          {(field.options ?? []).map((option) => (
            <Label key={option.value} className="flex items-center gap-1.5 text-sm font-normal">
              <input type="checkbox" className="size-4" checked={chosen.includes(option.value)} onChange={(event) => set(event.target.checked ? [...chosen, option.value] : chosen.filter((entry) => entry !== option.value))} />
              {optionLabel(option)}
            </Label>
          ))}
        </div>
      );
    }
    case "person":
    case "entity": {
      const list = field.type === "person" ? people.map((person) => ({ id: person.id, name: person.fullName })) : entities;
      return (
        <Select id={field.key} name={field.key} value={text} onChange={(event) => set(event.target.value)}>
          <option value="">—</option>
          {list.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
      );
    }
    case "file": {
      const ids = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-col gap-2">
          {ids.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {ids.map((fileId) => (
                <li key={fileId} className="flex items-center gap-2">
                  <span>{fileNames[fileId] ?? fileId}</span>
                  <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => set(ids.filter((entry) => entry !== fileId))}>
                    {t("form.removeFile")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : null}
          <input
            type="file"
            aria-label={t("form.addFile")}
            disabled={uploading}
            className="text-sm file:mr-2 file:rounded-md file:border file:bg-transparent file:px-2 file:py-1 file:text-sm"
            onChange={(event) => {
              upload(event.currentTarget.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {uploading ? <span className="text-xs text-muted-foreground">{t("form.uploading")}</span> : null}
        </div>
      );
    }
    default:
      return <Input id={field.key} name={field.key} value={text} maxLength={Math.min(field.maxLength ?? MAX_TEXT, MAX_TEXT)} onChange={(event) => set(event.target.value)} />;
  }
}
