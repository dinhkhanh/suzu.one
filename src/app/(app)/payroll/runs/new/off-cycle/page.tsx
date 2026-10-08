import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { resolveCatalogue } from "@/modules/payroll/components";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { OffCycleRunForm } from "@/modules/payroll/ui/run-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newOffCycleRun");

/**
 * An off-cycle run (FR-PAY-19, PAY-11): a Tết or holiday bonus, a project bonus, anything paid inside
 * a month on top of its regular run and taxed with it. C&B over the entity only; the run then goes
 * through the same lifecycle as any other — calculated, proposed, signed by the CEO, paid.
 */
export default async function NewOffCycleRunPage({ searchParams }: PageProps<"/payroll/runs/new/off-cycle">) {
  const user = await requireUser();
  const query = await searchParams;
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/runs/new/off-cycle");

  const today = todayInVietnam();
  const [t, entities] = await Promise.all([getTranslations("payroll"), listEntityOptions(reach)]);
  // Names and codes only — nothing about anyone's pay. The catalogue is the shared cached table.
  const [facts, catalogues] = await Promise.all([listEmploymentFacts({ entityIds: entities.map((entity) => entity.id) }), Promise.all(entities.map((entity) => resolveCatalogue(entity.id, today)))]);
  // Nobody puts a line for themselves into a run (the action refuses it too); people who have left are not offered.
  const people = facts
    .filter((fact) => fact.entityId && fact.status !== "offboarded" && fact.personId !== user.person.id)
    .map((fact) => ({ personId: fact.personId, fullName: fact.fullName, employeeCode: fact.employeeCode, entityId: fact.entityId! }))
    .sort((a, b) => a.fullName.localeCompare(b.fullName, "vi"));
  const codes = Object.fromEntries(
    entities.map((entity, index) => [
      entity.id,
      catalogues[index].filter((component) => component.source === "input" && component.kind !== "employer_cost").map((component) => ({ code: component.code, name: `${component.code} — ${component.name}` })),
    ]),
  );

  return (
    <Page>
      <PageHeader
        eyebrow={
          <Link href="/payroll/runs" className="text-link hover:underline">
            ← {t("runs.title")}
          </Link>
        }
        title={t("runs.offCycle.title")}
        description={t("runs.offCycle.hint")}
      />
      <Card>
        <CardContent>
          <OffCycleRunForm
            entities={entities}
            people={people}
            codes={codes}
            defaultMonth={typeof query.month === "string" && /^\d{4}-\d{2}$/.test(query.month) ? query.month : today.slice(0, 7)}
            defaultEntityId={typeof query.entity === "string" && entities.some((entity) => entity.id === query.entity) ? query.entity : undefined}
          />
        </CardContent>
      </Card>
    </Page>
  );
}
