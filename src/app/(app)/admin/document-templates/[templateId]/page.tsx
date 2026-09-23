import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates, findTemplate } from "@/modules/documents/service";
import { listEntities } from "@/modules/platform/org/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("documentTemplates");

export default async function DocumentTemplatePage({ params }: PageProps<"/admin/document-templates/[templateId]">) {
  const user = await requireUser();
  const { templateId } = await params;
  const [template, allEntities] = await Promise.all([findTemplate(templateId), listEntities()]);
  if (!template || !canManageTemplates(user.principal, template.entityId)) notFound();
  const entities = allEntities.map((entity) => ({ id: entity.id, code: entity.code, shortName: entity.shortName }));
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1>{template.name}</h1>
      <DocumentTemplateForm
        value={{ id: template.id, code: template.code, name: template.name, entityId: template.entityId, kind: template.kind, tier: template.tier, body: template.body, letterhead: template.letterhead ?? {}, isActive: template.isActive }}
        entities={entities}
      />
    </div>
  );
}
