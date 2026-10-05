import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManagePipelines, listPipelines } from "@/modules/recruit/service";
import { PipelineForm } from "@/modules/recruit/ui/pipeline-form";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("hiringPipelines");

// The hiring pipelines an opening may run (FR-REC-02). The group's library, like the candidate
// wordings, so editing it takes a group-wide `recruit:manage`: an entity's recruiter picks one for
// their opening; they do not rewrite how the whole company hires.
export default async function RecruitPipelinesPage() {
  const user = await requireUser();
  if (!canManagePipelines(user.principal)) notFound();

  const [t, pipelines] = await Promise.all([getTranslations("recruit"), listPipelines()]);

  return (
    <Page>
      <PageHeader title={t("pipelines")} description={t("pipelineEditor.description")} />

      {pipelines.map((pipeline) => (
        <PipelineForm
          key={pipeline.id}
          pipeline={{
            id: pipeline.id,
            code: pipeline.code,
            name: pipeline.name,
            nameEn: pipeline.nameEn,
            description: pipeline.description,
            isDefault: pipeline.isDefault,
            isActive: pipeline.isActive,
            stages: pipeline.stages.map((stage) => ({ key: stage.key, name: stage.name, nameEn: stage.nameEn, category: stage.category })),
          }}
        />
      ))}

      <Section title={t("pipelineEditor.new")}>
        <PipelineForm pipeline={null} />
      </Section>
    </Page>
  );
}
