import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { canHireInto } from "@/modules/core-hr/policy";
import { loadPlacementOptions, peopleModuleOpen } from "@/modules/core-hr/service";
import { HireForm } from "@/modules/core-hr/ui/hire-form";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newPerson");

export default async function NewPersonPage() {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user))) notFound();
  const [allEntities, t, options] = await Promise.all([listEntities(), getTranslations("people"), loadPlacementOptions()]);
  const entities = allEntities.filter((entity) => entity.isActive && canHireInto(user.principal, { entityId: entity.id }));
  if (entities.length === 0) notFound();

  return (
    <Page>
      <PageHeader title={t("hire.title")} description={t("hire.description")} />
      <HireForm entities={entities.map(({ id, shortName }) => ({ id, name: shortName }))} options={options} today={todayInVietnam()} />
    </Page>
  );
}
