"use client";
// Editing the wording a candidate reads (FR-REC-05). The placeholder list is shown beside the
// body on purpose: the engine refuses a wording that names anything else, and a recruiter should
// find that out while typing rather than when the form comes back refused.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Field, FieldErrors, FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveRecruitEmailTemplateAction } from "../actions";
import { RECRUIT_EMAIL_KINDS, RECRUIT_EMAIL_PLACEHOLDERS } from "../enums";

export type EmailTemplateDraft = { id: string; code: string; name: string; kind: string; subject: string; body: string; subjectEn: string | null; bodyEn: string | null; isActive: boolean } | null;

const textarea = "w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs";

export function EmailTemplateForm({ template }: { template: EmailTemplateDraft }) {
  const t = useTranslations("recruit");
  const router = useRouter();
  const form = useActionForm(saveRecruitEmailTemplateAction, { extra: template ? { templateId: template.id } : {}, onSuccess: () => router.refresh() });

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-4 rounded-xl border p-4">
      <FieldErrors value={form.fieldErrors}>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field name="code" label={t("form.code")}>
            <Input id="code" name="code" defaultValue={template?.code ?? ""} readOnly={!!template} required />
          </Field>
          <Field name="name" label={t("form.name")}>
            <Input id="name" name="name" defaultValue={template?.name ?? ""} required />
          </Field>
          <Field name="kind" label={t("form.kind")}>
            <select id="kind" name="kind" defaultValue={template?.kind ?? "general"} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">
              {RECRUIT_EMAIL_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {t(`emailKind.${kind}` as "emailKind.general")}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <p className="text-xs text-muted-foreground">
          {t("email.placeholders")}: {RECRUIT_EMAIL_PLACEHOLDERS.map((key) => `{{${key}}}`).join(" · ")}
        </p>

        <Field name="subject" label={`${t("email.subject")} (vi)`}>
          <Input id="subject" name="subject" defaultValue={template?.subject ?? ""} required />
        </Field>
        <Field name="body" label={`${t("email.body")} (vi)`}>
          <textarea id="body" name="body" rows={10} defaultValue={template?.body ?? ""} required className={textarea} />
        </Field>
        <Field name="subjectEn" label={`${t("email.subject")} (en)`}>
          <Input id="subjectEn" name="subjectEn" defaultValue={template?.subjectEn ?? ""} />
        </Field>
        <Field name="bodyEn" label={`${t("email.body")} (en)`}>
          <textarea id="bodyEn" name="bodyEn" rows={10} defaultValue={template?.bodyEn ?? ""} className={textarea} />
        </Field>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isActive" defaultChecked={template?.isActive ?? true} />
          {t("form.isActive")}
        </label>
      </FieldErrors>

      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={form.pending}>
          {t("save")}
        </Button>
        {form.saved ? <span className="text-xs text-muted-foreground">{t("saved")}</span> : null}
      </div>
    </form>
  );
}
