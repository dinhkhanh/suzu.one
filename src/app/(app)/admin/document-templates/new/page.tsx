import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates } from "@/modules/documents/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";

export const metadata: Metadata = { title: "Mẫu văn bản mới" };

export default async function NewDocumentTemplatePage() {
  const user = await requireUser();
  if (!canManageTemplates(user.principal)) notFound();
  const [entities, t] = await Promise.all([db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).orderBy(asc(schema.entity.code)), getTranslations("documents.designer")]);
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1>{t("new")}</h1>
      <DocumentTemplateForm value={null} entities={entities} />
    </div>
  );
}
