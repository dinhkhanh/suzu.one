import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { listPersonNames } from "@/modules/platform/people/service";
import { assetReach, canManageDigitalAssets } from "@/modules/assets/service";
import { DigitalAssetForm } from "@/modules/assets/ui/digital-forms";
import { listClients } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("newDigitalAsset");

export default async function NewDigitalAssetPage() {
  const user = await requireUser();
  if (!canManageDigitalAssets(user.principal)) notFound();
  const [entities, clients, people, t] = await Promise.all([listEntities(), listClients({ activeOnly: true }), listPersonNames(), getTranslations("assets.digital")]);
  // Only the entities whose register this person keeps: an asset goes on books they answer for.
  const reach = assetReach(user.principal);
  const offered = entities.filter((entity) => reach.all || reach.entityIds.includes(entity.id));

  return (
    <Page width="narrow">
      <PageHeader title={t("new")} description={t("form.intro")} />
      <DigitalAssetForm
        value={{
          id: null,
          kind: "social_channel",
          platform: "facebook",
          name: "",
          handle: null,
          url: null,
          entityId: offered[0]?.id ?? "",
          ownership: "company",
          clientId: null,
          ownerPersonId: user.person.id,
          visibility: "staff",
          status: "active",
          loginIdentity: null,
          recoveryContact: null,
          credentialLocation: null,
          notes: null,
        }}
        entities={offered.map(({ id, code, shortName }) => ({ id, code, shortName }))}
        clients={clients.map(({ id, name }) => ({ id, name }))}
        people={people}
        canMoveEntity
      />
    </Page>
  );
}
