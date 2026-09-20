"use client";
// Making a document about somebody. The template list this form is given has already been
// narrowed to the ones the viewer may actually generate, so a salary letter is not even an
// option for a reader without the compensation tier — and the action refuses it as well.
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { generateDocumentAction } from "../actions";

export function GenerateDocumentForm({ subjectPersonId, templates }: { subjectPersonId: string; templates: { id: string; name: string; kind: string }[] }) {
  const t = useTranslations("documents");
  const kinds = useTranslations("documents.kind");
  const router = useRouter();
  const [made, setMade] = useState<{ id: string; number: string } | null>(null);
  const { onSubmit, pending, errorKey } = useActionForm(generateDocumentAction, {
    extra: { subjectPersonId },
    onSuccess: (data) => {
      setMade(data as { id: string; number: string });
      router.refresh();
    },
  });

  if (templates.length === 0) return <p className="text-sm text-muted-foreground">{t("noTemplates")}</p>;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Select name="templateId" required defaultValue="" className="h-9 min-w-64">
          <option value="" disabled>
            {t("pickTemplate")}
          </option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} ({kinds(template.kind)})
            </option>
          ))}
        </Select>
        <Button type="submit" disabled={pending}>
          {t("generate")}
        </Button>
      </div>
      <FormError namespace="documents.errors" errorKey={errorKey} />
      {made ? (
        <p className="text-sm">
          {t("made", { number: made.number })}{" "}
          <a href={`/documents/${made.id}/pdf`} className="underline">
            {t("download")}
          </a>
        </p>
      ) : null}
    </form>
  );
}
