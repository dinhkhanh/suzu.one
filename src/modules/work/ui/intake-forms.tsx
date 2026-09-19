"use client";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState } from "react";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { IntakeField } from "../engine/intake";
import { saveIntakeFormAction, submitIntakeAction } from "../intake-actions";

const TEXTAREA = "min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm";
const FIELD_TYPES = ["text", "long_text", "select", "date", "url"] as const;

export type IntakeFormValue = { id: string | null; name: string; description: string | null; projectId: string | null; audience: string; fields: IntakeField[]; isActive: boolean; submissions: number };

/** One form's editor. The field rows are plain inputs named "fields.<n>.<prop>"; rows left without a label are ignored by the action. */
function IntakeFormEditor({ teamId, value, projects }: { teamId: string; value: IntakeFormValue; projects: { id: string; name: string }[] }) {
  const t = useTranslations("work.intake");
  const [rows, setRows] = useState(Math.max(value.fields.length + 1, 3));
  const form = useActionForm(saveIntakeFormAction, { extra: { teamId, formId: value.id } });
  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field name="name" label={t("name")}>
            <Input id="name" name="name" required maxLength={120} defaultValue={value.name} />
          </Field>
          <Field name="projectId" label={t("project")}>
            <Select id="projectId" name="projectId" defaultValue={value.projectId ?? ""}>
              <option value="">{t("backlogOnly")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field name="audience" label={t("audience")}>
          <Select id="audience" name="audience" defaultValue={value.audience} className="sm:w-1/2">
            <option value="entity">{t("audiences.entity")}</option>
            <option value="group">{t("audiences.group")}</option>
          </Select>
        </Field>
        <Field name="description" label={t("description")}>
          <textarea id="description" name="description" maxLength={1000} defaultValue={value.description ?? ""} className={TEXTAREA} />
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="pb-1 text-sm font-medium">{t("fields")}</legend>
          {Array.from({ length: rows }, (_, index) => {
            const field = value.fields[index];
            return (
              <div key={index} className="grid items-start gap-2 sm:grid-cols-[1fr_9rem_1fr_auto]">
                <Input name={`fields.${index}.label`} maxLength={120} defaultValue={field?.label ?? ""} placeholder={t("fieldLabel")} aria-label={t("fieldLabel")} />
                <Select name={`fields.${index}.type`} defaultValue={field?.type ?? "text"} aria-label={t("fieldType")}>
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`types.${type}`)}
                    </option>
                  ))}
                </Select>
                <textarea name={`fields.${index}.options`} defaultValue={(field?.options ?? []).join("\n")} placeholder={t("fieldOptions")} aria-label={t("fieldOptions")} className="min-h-9 w-full rounded-md border bg-transparent px-3 py-1.5 text-sm" rows={1} />
                <label className="flex items-center gap-1.5 pt-2 text-sm">
                  <input type="checkbox" name={`fields.${index}.required`} defaultChecked={field?.required ?? false} />
                  {t("fieldRequired")}
                </label>
              </div>
            );
          })}
          {rows < 12 ? (
            <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => setRows(rows + 1)}>
              {t("addField")}
            </Button>
          ) : null}
        </fieldset>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={value.isActive} />
          {t("active")}
        </label>
      </FieldErrors>
      <FormError namespace="work.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {value.id ? t("save") : t("create")}
        </Button>
        {form.saved ? <span className="text-sm text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}

/** A team's intake forms on the team page: everyone sees them with a link to fill one in; leads edit and add. */
export function IntakeFormManager({ teamId, forms, projects, canManage }: { teamId: string; forms: IntakeFormValue[]; projects: { id: string; name: string }[]; canManage: boolean }) {
  const t = useTranslations("work.intake");
  const blank: IntakeFormValue = { id: null, name: "", description: null, projectId: null, audience: "entity", fields: [], isActive: true, submissions: 0 };
  const shown = canManage ? forms : forms.filter((form) => form.isActive);
  return (
    <div className="flex flex-col gap-3">
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
      <ul className="flex flex-col divide-y rounded-xl border empty:hidden">
        {shown.map((form) => (
          <li key={form.id} className="text-sm">
            <details>
              <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3">
                <span className="font-medium">{form.name}</span>
                <span className="text-xs text-muted-foreground">{t("submissions", { count: form.submissions })}</span>
                {form.isActive ? null : <Badge variant="outline">{t("retired")}</Badge>}
                {form.isActive ? (
                  <Link href={`/work/intake/${form.id}`} className="ml-auto text-xs underline">
                    {t("open")}
                  </Link>
                ) : null}
              </summary>
              <div className="border-t p-3">{canManage ? <IntakeFormEditor teamId={teamId} value={form} projects={projects} /> : <p className="text-muted-foreground">{form.description ?? t("noDescription")}</p>}</div>
            </details>
          </li>
        ))}
      </ul>
      {canManage ? (
        <details className="rounded-xl border text-sm">
          <summary className="cursor-pointer p-3 font-medium">{t("new")}</summary>
          <div className="border-t p-3">
            <IntakeFormEditor teamId={teamId} value={blank} projects={projects} />
          </div>
        </details>
      ) : null}
    </div>
  );
}

type AnswerProblem = { key: string; problem: string };

/** The request form itself. */
export function IntakeSubmitForm({ formId, fields }: { formId: string; fields: IntakeField[] }) {
  const t = useTranslations("work.intake");
  const [done, setDone] = useState<{ taskId: string; key: string; title: string } | null>(null);
  const form = useActionForm(submitIntakeAction, { extra: { formId }, onSuccess: setDone });
  const problems = new Map(((form.details as { problems?: AnswerProblem[] } | null)?.problems ?? []).map((item) => [item.key, item.problem]));

  if (done) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border p-4 text-sm">
        <p className="font-medium">{t("submitted", { key: done.key })}</p>
        <p className="text-muted-foreground">{t("submittedHint")}</p>
        <p className="flex gap-3">
          <Link href={`/work/tasks/${done.taskId}`} className="underline">
            {t("openRequest")}
          </Link>
          <button type="button" className="underline" onClick={() => setDone(null)}>
            {t("another")}
          </button>
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={form.onSubmit} className="flex max-w-xl flex-col gap-4">
      <FieldErrors value={form.fieldErrors}>
        <Field name="title" label={t("requestTitle")}>
          <Input id="title" name="title" required maxLength={200} placeholder={t("requestTitleHint")} />
        </Field>
        {fields.map((field) => {
          const name = `answers.${field.key}`;
          const problem = problems.get(field.key);
          return (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label htmlFor={name} className="text-sm font-medium">
                {field.label}
                {field.required ? <span className="text-destructive"> *</span> : null}
              </label>
              {field.type === "long_text" ? (
                <textarea id={name} name={name} required={field.required} maxLength={4000} className={TEXTAREA} />
              ) : field.type === "select" ? (
                <Select id={name} name={name} required={field.required} defaultValue="">
                  <option value="">{t("choose")}</option>
                  {(field.options ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={name} name={name} required={field.required} type={field.type === "date" ? "date" : field.type === "url" ? "url" : "text"} maxLength={field.type === "url" ? 500 : 200} placeholder={field.type === "url" ? "https://" : undefined} />
              )}
              {problem ? (
                <p role="alert" className="text-xs text-destructive">
                  {t(`problems.${problem}`)}
                </p>
              ) : null}
            </div>
          );
        })}
      </FieldErrors>
      <FormError namespace="work.errors" errorKey={form.errorKey} />
      <Button type="submit" className="w-fit" disabled={form.pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
