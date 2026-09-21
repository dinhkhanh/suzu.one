import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listOfferAllowances } from "@/modules/payroll/offers";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { NetToGrossForm } from "@/modules/payroll/ui/offer-form";

export const metadata: Metadata = { title: "Net to gross" };

// The offer tool (FR-PAY-03). Compensation tier: only C&B of an entity, after a recent
// re-authentication. Nothing here is stored — it answers a question about a figure not yet agreed.
export default async function NetToGrossPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/tools/net-to-gross");

  const [t, entities] = await Promise.all([getTranslations("payroll.offers"), listEntityOptions(reach)]);
  if (entities.length === 0) notFound();
  const month = todayInVietnam().slice(0, 7);
  const allowances = await listOfferAllowances(entities[0].id, month);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>
      <NetToGrossForm entities={entities} allowances={allowances} defaultMonth={month} />
    </div>
  );
}
