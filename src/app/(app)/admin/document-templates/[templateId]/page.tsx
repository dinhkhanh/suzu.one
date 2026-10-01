import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates, findTemplate } from "@/modules/documents/service";
import { listEntities } from "@/modules/platform/org/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("documentTemplates");

export default async function DocumentTemplatePage({ params }: PageProps<"/admin/document-templates/[templateId]">) {
  const user = await requireUser();
  const { templateId } = await params;
  const [template, allEntities, t, kinds] = await Promise.all([findTemplate(templateId), listEntities(), getTranslations("documents.designer"), getTranslations("documents.kind")]);
  if (!template || !canManageTemplates(user.principal, template.entityId)) notFound();
  const entities = allEntities.map((entity) => ({ id: entity.id, code: entity.code, shortName: entity.shortName }));
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/admin/document-templates" className="hover:text-foreground">
            {t("title")}
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
            <span className="min-w-0 truncate">{template.name}</span>
            <Badge dot variant={template.isActive ? "success" : "outline"}>{template.isActive ? t("active") : t("inactive")}</Badge>
          </span>
        }
        description={
          <>
            <span className="font-mono text-xs">{template.code}</span> · {kinds(template.kind)} · v{template.version}
          </>
        }
      />
      <DocumentTemplateForm
        value={{ id: template.id, code: template.code, name: template.name, entityId: template.entityId, kind: template.kind, tier: template.tier, body: template.body, letterhead: template.letterhead ?? {}, isActive: template.isActive }}
        entities={entities}
      />
    </Page>
  );
}
