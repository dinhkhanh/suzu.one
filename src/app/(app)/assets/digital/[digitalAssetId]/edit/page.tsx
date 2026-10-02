import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { findPersonById, listPersonNames } from "@/modules/platform/people/service";
import { assetReach, canManageDigitalAssets, canRunDigitalAsset, findDigitalAsset } from "@/modules/assets/service";
import { DigitalAssetForm } from "@/modules/assets/ui/digital-forms";
import { listClients } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("editDigitalAsset");

export default async function EditDigitalAssetPage({ params }: PageProps<"/assets/digital/[digitalAssetId]/edit">) {
  const user = await requireUser();
  const { digitalAssetId } = await params;
  const asset = /^[0-9a-f-]{36}$/.test(digitalAssetId) ? await findDigitalAsset(digitalAssetId) : undefined;
  // Not there, or not theirs to run — the same answer either way.
  if (!asset || !canRunDigitalAsset(user.principal, asset)) notFound();
  const [entities, clients, people, t] = await Promise.all([listEntities(), listClients(), listPersonNames(), getTranslations("assets.digital")]);
  const reach = assetReach(user.principal);
  // The owner who keeps no register edits the asset but cannot move it to another entity's books.
  const canMoveEntity = canManageDigitalAssets(user.principal, asset.entityId);
  const offered = entities.filter((entity) => entity.id === asset.entityId || reach.all || reach.entityIds.includes(entity.id));
  // Somebody who has left may still be named as the owner: keep their name in the picker until replaced.
  const gone = asset.ownerPersonId && !people.some((person) => person.id === asset.ownerPersonId) ? await findPersonById(asset.ownerPersonId) : undefined;
  const peopleOptions = gone ? [...people, { id: gone.id, fullName: gone.fullName }] : people;

  return (
    <Page width="narrow">
      <PageHeader eyebrow={asset.name} title={t("edit")} />
      <DigitalAssetForm
        value={{
          id: asset.id,
          kind: asset.kind,
          platform: asset.platform,
          name: asset.name,
          handle: asset.handle,
          url: asset.url,
          entityId: asset.entityId,
          ownership: asset.ownership,
          clientId: asset.clientId,
          ownerPersonId: asset.ownerPersonId,
          visibility: asset.visibility,
          status: asset.status,
          loginIdentity: asset.loginIdentity,
          recoveryContact: asset.recoveryContact,
          credentialLocation: asset.credentialLocation,
          notes: asset.notes,
        }}
        entities={offered.map(({ id, code, shortName }) => ({ id, code, shortName }))}
        clients={clients.filter((client) => client.isActive || client.id === asset.clientId).map(({ id, name }) => ({ id, name }))}
        people={peopleOptions}
        canMoveEntity={canMoveEntity}
      />
    </Page>
  );
}
