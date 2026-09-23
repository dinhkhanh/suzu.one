import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { listEmailTemplates } from "@/modules/recruit/emails";
import { canManagePipelines } from "@/modules/recruit/service";
import { EmailTemplateForm } from "@/modules/recruit/ui/email-template-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("candidateEmails");

// The wordings sent to candidates (FR-REC-05). Group-wide, like the pipeline library, so editing
// them takes a group-wide `recruit:manage` — an entity's recruiter runs their openings, they do
// not rewrite what the whole company says when it turns somebody down.
export default async function RecruitEmailsPage() {
  const user = await requireUser();
  if (!canManagePipelines(user.principal)) notFound();

  const t = await getTranslations("recruit");
  const templates = await listEmailTemplates(false);

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1>{t("email.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("email.description")}</p>
      </header>

      {templates.map((template) => (
        <EmailTemplateForm
          key={template.id}
          template={{
            id: template.id,
            code: template.code,
            name: template.name,
            kind: template.kind,
            subject: template.subject,
            body: template.body,
            subjectEn: template.subjectEn,
            bodyEn: template.bodyEn,
            isActive: template.isActive,
          }}
        />
      ))}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("email.new")}</h2>
        <EmailTemplateForm template={null} />
      </section>
    </div>
  );
}
