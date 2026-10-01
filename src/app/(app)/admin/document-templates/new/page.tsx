import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates } from "@/modules/documents/service";
import { listEntities } from "@/modules/platform/org/service";
import { DocumentTemplateForm } from "@/modules/documents/ui/template-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newDocumentTemplate");

export default async function NewDocumentTemplatePage() {
  const user = await requireUser();
  if (!canManageTemplates(user.principal)) notFound();
  const [allEntities, t] = await Promise.all([listEntities(), getTranslations("documents.designer")]);
  const entities = allEntities.map((entity) => ({ id: entity.id, code: entity.code, shortName: entity.shortName }));
  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/admin/document-templates" className="hover:text-foreground">
            {t("title")}
          </Link>
        }
        title={t("new")}
        description={t("description")}
      />
      <DocumentTemplateForm value={null} entities={entities} />
    </Page>
  );
}
