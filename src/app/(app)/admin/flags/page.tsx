import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { List } from "@/components/ui/list";
import { Page, PageHeader } from "@/components/ui/page";
import { TableCard, TableCardHeader } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listRollouts } from "@/modules/platform/flags/service";
import { RolloutForm } from "@/modules/platform/flags/ui/rollout-form";
import { listEntities, unitChoices } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("rollout");

// One card, one row per module: its switch for the whole group, or the pilot it is open to.
export default async function FlagsPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:manage", {})) notFound();

  const t = await getTranslations("flags");
  const [rollouts, entities, departments, people] = await Promise.all([listRollouts(), listEntities(), unitChoices(), listPersonNames()]);

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <TableCard>
        <TableCardHeader title={t("modules")} count={rollouts.length} description={t("orPilot")} />
        <List>
          {rollouts.map(({ key, rollout }) => (
            <RolloutForm
              key={key}
              flag={key}
              rollout={rollout}
              entities={entities.filter((entity) => entity.isActive).map((entity) => ({ id: entity.id, name: entity.shortName }))}
              departments={departments}
              people={people.map((person) => ({ id: person.id, name: person.fullName }))}
            />
          ))}
        </List>
      </TableCard>
    </Page>
  );
}
