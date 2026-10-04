import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { getRetroScreen } from "@/modules/payroll/run-views";
import { RetroSection } from "@/modules/payroll/ui/retro-section";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payrollRetro");

/**
 * An entity's retro items that no run has carried yet (FR-PAY-17): what a late salary decision
 * or a correction to a locked timesheet left behind, what C&B entered by hand, and the
 * corrections still waiting for an amount. C&B over the entity and the owner; compensation tier.
 */
export default async function PayrollRetroPage({ searchParams }: PageProps<"/payroll/retro">) {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/retro");

  const params = await searchParams;
  const entities = await listEntityOptions(reach);
  const asked = typeof params.entity === "string" ? params.entity : null;
  // One entity at a time: an item belongs to the entity that pays it.
  const entityId = entities.find((entity) => entity.id === asked)?.id ?? entities[0]?.id ?? null;
  const [t, screen, people] = await Promise.all([getTranslations("payroll"), entityId ? getRetroScreen(user.principal, entityId) : null, entityId ? listEmploymentFacts({ entityIds: [entityId] }) : []]);
  if (!entityId || !screen) notFound();

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={
          <Link href="/payroll/runs" className="text-link hover:underline">
            ← {t("runs.title")}
          </Link>
        }
        title={t("retro.pageTitle")}
        description={t("retro.pageDescription")}
      />

      {entities.length > 1 ? (
        <form className="toolbar" action="/payroll/retro">
          <Select name="entity" defaultValue={entityId} aria-label={t("runs.entity")} className="w-auto min-w-40">
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.code} — {entity.shortName}
              </option>
            ))}
          </Select>
          <Button type="submit" variant="outline">
            {t("salaries.filter")}
          </Button>
        </form>
      ) : null}

      <RetroSection
        screen={screen}
        entityId={entityId}
        editable
        people={people.map((person) => ({ personId: person.personId, fullName: person.fullName })).sort((left, right) => left.fullName.localeCompare(right.fullName, "vi"))}
        viewerPersonId={user.person.id}
      />
    </Page>
  );
}
