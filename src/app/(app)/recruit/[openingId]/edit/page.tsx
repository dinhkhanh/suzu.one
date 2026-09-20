import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canSetRecruitMoney, getOpeningView, listPipelines } from "@/modules/recruit/service";
import { OpeningForm } from "@/modules/recruit/ui/opening-form";

export const metadata: Metadata = { title: "Edit job opening" };

export default async function EditOpeningPage({ params }: PageProps<"/recruit/[openingId]/edit">) {
  const { openingId } = await params;
  const user = await requireUser();
  const view = await getOpeningView({ principal: user.principal, personId: user.person.id }, openingId);
  if (!view?.canEdit) notFound();

  const t = await getTranslations("recruit");
  const [pipelines, entities, departments] = await Promise.all([
    listPipelines(),
    db().select().from(schema.entity).orderBy(asc(schema.entity.code)),
    db().select({ id: schema.department.id, name: schema.department.name }).from(schema.department).orderBy(asc(schema.department.name)),
  ]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("actions.edit")}</h1>
      <OpeningForm
        value={{
          id: view.opening.id,
          title: view.opening.title,
          titleEn: view.opening.titleEn,
          entityId: view.opening.entityId,
          departmentId: view.opening.departmentId,
          teamId: view.opening.teamId,
          positionName: view.opening.positionName,
          jobLevel: view.opening.jobLevel,
          employmentType: view.opening.employmentType,
          workMode: view.opening.workMode,
          workLocation: view.opening.workLocation,
          headcount: view.opening.headcount,
          description: view.opening.description,
          requirements: view.opening.requirements,
          benefits: view.opening.benefits,
          pipelineId: view.opening.pipelineId,
          targetStartDate: view.opening.targetStartDate,
          // The band is only put in the form for somebody who may read it — `view.salary` is
          // already null for everybody else, so an editor without the tier cannot overwrite it.
          salaryMinVnd: view.salary?.minVnd ?? null,
          salaryMaxVnd: view.salary?.maxVnd ?? null,
          salaryPublic: view.salary?.isPublic ?? false,
        }}
        entities={entities}
        departments={departments}
        pipelines={pipelines}
        canSetMoney={canSetRecruitMoney(user.principal, { entityId: view.opening.entityId, departmentId: view.opening.departmentId, teamId: view.opening.teamId })}
      />
    </div>
  );
}
