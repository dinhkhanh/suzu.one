import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates } from "@/modules/documents/service";
import { listEntities } from "@/modules/platform/org/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";

export const metadata: Metadata = { title: "Mẫu văn bản mới" };

export default async function NewDocumentTemplatePage() {
  const user = await requireUser();
  if (!canManageTemplates(user.principal)) notFound();
  const [allEntities, t] = await Promise.all([listEntities(), getTranslations("documents.designer")]);
  const entities = allEntities.map((entity) => ({ id: entity.id, code: entity.code, shortName: entity.shortName }));
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1>{t("new")}</h1>
      <DocumentTemplateForm value={null} entities={entities} />
    </div>
  );
}
