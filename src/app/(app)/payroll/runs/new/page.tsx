import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { listRunnableMonths } from "@/modules/payroll/run-views";
import { NewRunForm } from "@/modules/payroll/ui/run-forms";

export const metadata: Metadata = { title: "New payroll run" };

/** Starting a month's run — only C&B, and only for a month whose timesheet is locked (FR-PAY-10). */
export default async function NewPayrollRunPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/runs/new");

  const [t, entities] = await Promise.all([getTranslations("payroll"), listEntityOptions(reach)]);
  const months = (await Promise.all(entities.map(async (entity) => (await listRunnableMonths(entity.id)).map((month) => ({ entityId: entity.id, ...month }))))).flat();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header>
        <Link href="/payroll/runs" className="text-sm text-muted-foreground hover:underline">
          ← {t("runs.title")}
        </Link>
        <h1>{t("runs.new.title")}</h1>
      </header>
      <NewRunForm entities={entities} months={months.map(({ entityId, month, hasRun }) => ({ entityId, month, hasRun }))} />
    </div>
  );
}
