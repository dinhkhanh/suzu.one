"use client";
// Sending a candidate one of the seeded wordings (FR-REC-05). The recruiter picks a template and
// the language the candidate reads; everything the letter says is filled in on the server from the
// application, so there is no free-text box here and no way to make this screen send arbitrary
// text to an arbitrary address.
import { useTranslations } from "next-intl";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { sendCandidateEmailAction } from "../actions";

export type EmailTemplateOption = { id: string; name: string; kind: string };

export function SendCandidateEmail({ applicationId, templates, hasEmail }: { applicationId: string; templates: EmailTemplateOption[]; hasEmail: boolean }) {
  const t = useTranslations("recruit");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const form = useActionForm<{ to: string }>(sendCandidateEmailAction, { extra: { applicationId }, onSuccess: (data) => setSentTo(data.to) });

  if (templates.length === 0) return null;

  return (
    <form onSubmit={form.onSubmit} className="flex flex-col gap-3 rounded-xl border p-4">
      <h2 className="text-sm font-medium">{t("email.title")}</h2>
      {hasEmail ? null : <p className="text-xs text-muted-foreground">{t("email.noAddress")}</p>}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1.5">
          <Label htmlFor="templateId">{t("email.template")}</Label>
          <select id="templateId" name="templateId" required disabled={!hasEmail} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm">
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="locale">{t("email.language")}</Label>
          <select id="locale" name="locale" defaultValue="vi" disabled={!hasEmail} className="h-9 rounded-md border bg-transparent px-3 text-sm">
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </div>
        <Button type="submit" size="sm" disabled={form.pending || !hasEmail}>
          {t("email.send")}
        </Button>
      </div>
      <FormError namespace="recruit.errors" errorKey={form.errorKey} />
      {sentTo ? <p className="text-xs text-muted-foreground">{t("email.sent", { to: sentTo })}</p> : null}
    </form>
  );
}
