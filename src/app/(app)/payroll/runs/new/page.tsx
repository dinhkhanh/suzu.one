import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { listRunnableMonthsOf } from "@/modules/payroll/run-views";
import { NewRunForm } from "@/modules/payroll/ui/run-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newPayrollRun");

/** Starting a month's run — only C&B, and only for a month whose timesheet is locked (FR-PAY-10). */
export default async function NewPayrollRunPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/runs/new");

  const [t, entities] = await Promise.all([getTranslations("payroll"), listEntityOptions(reach)]);
  const months = await listRunnableMonthsOf(entities.map((entity) => entity.id));

  return (
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href="/payroll/runs" className="text-link hover:underline">
            ← {t("runs.title")}
          </Link>
        }
        title={t("runs.new.title")}
        description={t("runs.new.hint")}
        actions={
          <Link href="/payroll/runs/new/off-cycle" className={buttonVariants({ variant: "outline" })}>
            {t("runs.offCycle.link")}
          </Link>
        }
      />
      <NewRunForm entities={entities} months={months.map(({ entityId, month, hasRun }) => ({ entityId, month, hasRun }))} />
    </Page>
  );
}
