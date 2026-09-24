import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { requireUser } from "@/modules/platform/auth/session";
import { listPersonNames } from "@/modules/platform/people/service";
import { canAcknowledgeCover, canHandBackCover, canSubmitCoverPlan, canViewCoverPlan, coverPlanFacts, getCoverPlan, loadViewer } from "@/modules/work/service";
import { CoverPlanForm } from "@/modules/work/ui/cover";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("leaveCover");

// FR-PJM-44: the person's cover plan for a leave — what falls in the absence and who covers it. The
// person (or work:manage over their entity) fills and submits it; the covers read and acknowledge
// it; after the leave it is handed back from here.
export default async function CoverPlanPage({ params }: PageProps<"/work/cover/[planId]">) {
  const user = await requireUser();
  const { planId } = await params;
  const [viewer, t] = await Promise.all([loadViewer(user), getTranslations("work")]);
  // The work of a private project the reader may not open is listed without its name.
  const plan = /^[0-9a-f-]{36}$/.test(planId) ? await getCoverPlan(planId, viewer) : undefined;
  if (!plan) notFound();
  const facts = await coverPlanFacts(plan);
  if (!canViewCoverPlan(viewer, facts)) notFound();
  const submit = canSubmitCoverPlan(viewer, facts);
  // Anyone active may be the cover for all — a colleague from another team too; never the person on
  // leave. Each item takes only someone of its team or project (the list beside it is narrowed).
  const people = submit && plan.status === "draft" ? (await listPersonNames()).filter((person) => person.id !== plan.personId) : [];

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">
          <Link href="/tasks" className="underline">
            {t("myWork")}
          </Link>
        </p>
        <h1 className="flex flex-wrap items-center gap-2">
          {t("cover.title")}
          <Badge dot variant={statusTone(plan.status)}>{t(`cover.statuses.${plan.status}`)}</Badge>
        </h1>
        <p className="text-sm text-muted-foreground">{t("cover.description")}</p>
      </header>
      <CoverPlanForm
        plan={{
          id: plan.id,
          status: plan.status,
          personName: plan.personName,
          fromDate: plan.fromDate,
          toDate: plan.toDate,
          defaultCoverPersonId: plan.defaultCoverPersonId,
          defaultCoverName: plan.defaultCoverName,
          note: plan.note,
          appliedAt: plan.appliedAt?.toISOString() ?? null,
          items: plan.items.map((item) => ({ ...item, acknowledgedAt: item.acknowledgedAt?.toISOString() ?? null, handedBackAt: item.handedBackAt?.toISOString() ?? null })),
        }}
        people={people}
        canSubmit={submit}
        canAcknowledge={canAcknowledgeCover(viewer, facts)}
        canHandBack={plan.status === "submitted" && canHandBackCover(viewer, facts)}
        selfId={user.person.id}
      />
    </div>
  );
}
