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
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";

export const generateMetadata = pageTitle("netToGross");

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
    <Page width="narrow">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("back")}
          </Link>
        }
        title={t("title")}
        description={t("description")}
      />
      <NetToGrossForm entities={entities} allowances={allowances} defaultMonth={month} />
    </Page>
  );
}
