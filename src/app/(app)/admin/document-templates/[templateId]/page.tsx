import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates, findTemplate } from "@/modules/documents/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";

export const metadata: Metadata = { title: "Mẫu văn bản" };

export default async function DocumentTemplatePage({ params }: PageProps<"/admin/document-templates/[templateId]">) {
  const user = await requireUser();
  const { templateId } = await params;
  const template = await findTemplate(templateId);
  if (!template || !canManageTemplates(user.principal, template.entityId)) notFound();
  const entities = await db().select({ id: schema.entity.id, code: schema.entity.code, shortName: schema.entity.shortName }).from(schema.entity).orderBy(asc(schema.entity.code));
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{template.name}</h1>
      <DocumentTemplateForm
        value={{ id: template.id, code: template.code, name: template.name, entityId: template.entityId, kind: template.kind, tier: template.tier, body: template.body, letterhead: template.letterhead ?? {}, isActive: template.isActive }}
        entities={entities}
      />
    </div>
  );
}
