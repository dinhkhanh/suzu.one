import type { Metadata } from "next";
import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canRunRecruitment, canSetRecruitMoney, findHiringRequest, listPipelines } from "@/modules/recruit/service";
import { OpeningForm } from "@/modules/recruit/ui/opening-form";

export const metadata: Metadata = { title: "New job opening" };

// Writing the advertisement. With `?from=<hiring request>` the form opens filled in from the
// approved ask — the "no retyping" half of FR-REC-01.
export default async function NewOpeningPage({ searchParams }: PageProps<"/recruit/openings/new">) {
  const user = await requireUser();
  if (!canRunRecruitment(user.principal)) notFound();
  const { from } = await searchParams;
  const t = await getTranslations("recruit");

  const [pipelines, entities, departments] = await Promise.all([
    listPipelines(),
    db().select().from(schema.entity).orderBy(asc(schema.entity.code)),
    db().select({ id: schema.department.id, name: schema.department.name }).from(schema.department).orderBy(asc(schema.department.name)),
  ]);

  const ask = typeof from === "string" ? await findHiringRequest(from) : undefined;
  // Only an approved ask this person may act on prefills anything; anything else opens blank.
  const seed = ask && ask.status === "approved" && canRunRecruitment(user.principal, { entityId: ask.entityId, departmentId: ask.departmentId, teamId: ask.teamId }) ? ask : undefined;
  const defaultPipeline = pipelines.find((pipeline) => pipeline.isDefault) ?? pipelines[0];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("newOpening")}</h1>
      <OpeningForm
        value={{
          id: null,
          title: seed?.positionTitle ?? "",
          titleEn: null,
          entityId: seed?.entityId ?? entities[0]?.id ?? "",
          departmentId: seed?.departmentId ?? null,
          teamId: seed?.teamId ?? null,
          positionName: seed?.positionTitle ?? null,
          jobLevel: seed?.jobLevel ?? null,
          employmentType: seed?.employmentType ?? "employee",
          workMode: "onsite",
          workLocation: seed?.workLocation ?? null,
          headcount: seed?.headcount ?? 1,
          description: "",
          requirements: "",
          benefits: "",
          pipelineId: defaultPipeline?.id ?? "",
          targetStartDate: seed?.targetStartDate ?? null,
          // Carried across only for somebody who may read it; the action re-checks regardless.
          salaryMinVnd: seed?.budgetMinVnd ?? null,
          salaryMaxVnd: seed?.budgetMaxVnd ?? null,
          salaryPublic: false,
        }}
        entities={entities}
        departments={departments}
        pipelines={pipelines}
        canSetMoney={canSetRecruitMoney(user.principal)}
        hiringRequestId={seed?.id ?? null}
      />
    </div>
  );
}
