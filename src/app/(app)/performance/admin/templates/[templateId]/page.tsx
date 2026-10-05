import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { canManageReviewTemplates, findReviewTemplate } from "@/modules/performance/service";
import { ReviewTemplateEditor } from "@/modules/performance/ui/review-template-editor";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("reviewTemplate");

/**
 * One review form (PRF-01). Group HR edits it; whoever else opens the HR desk reads it — they
 * build cycles on it. Editing changes nothing already asked: a launched cycle keeps its snapshot.
 */
export default async function ReviewTemplatePage({ params }: PageProps<"/performance/admin/templates/[templateId]">) {
  const user = await requireUser();
  const { templateId } = await params;
  const [template, t] = await Promise.all([/^[0-9a-f-]{36}$/.test(templateId) ? findReviewTemplate(templateId) : null, getTranslations("performance.reviews.templates")]);
  if (!template) notFound();
  const editable = canManageReviewTemplates(user.principal);

  return (
    <div className="flex flex-col gap-4">
      <Link href="/performance/admin/templates" className="text-sm text-link underline-offset-4 hover:underline">
        {t("back")}
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h2>{template.name}</h2>
        {editable ? (
          <Link href={`/performance/admin/templates/new?from=${template.id}`} className="text-sm underline-offset-4 hover:underline">
            {t("copy")}
          </Link>
        ) : null}
      </div>
      {template.description ? <p className="max-w-3xl text-sm text-muted-foreground">{template.description}</p> : null}
      {!editable ? <p className="text-sm text-muted-foreground">{t("readOnly")}</p> : null}
      <ReviewTemplateEditor
        key={template.updatedAt.toISOString()}
        draft={{ id: template.id, name: template.name, nameEn: template.nameEn, description: template.description, kinds: template.kinds, isActive: template.isActive, sections: template.sections, ratingScale: template.ratingScale }}
        editable={editable}
      />
    </div>
  );
}
