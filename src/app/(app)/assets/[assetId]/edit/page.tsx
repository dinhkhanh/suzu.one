import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageAssets, canReadAssetMoney, findAsset, listCategories } from "@/modules/assets/service";
import { AssetForm } from "@/modules/assets/ui/asset-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("editAsset");

export default async function EditAssetPage({ params }: PageProps<"/assets/[assetId]/edit">) {
  const user = await requireUser();
  const { assetId } = await params;
  const asset = await findAsset(assetId);
  if (!asset || !canManageAssets(user.principal, asset.entityId)) notFound();
  const [categories, entities, t] = await Promise.all([listCategories(), listEntities(), getTranslations("assets")]);

  return (
    <Page width="narrow">
      <PageHeader eyebrow={<span className="font-mono">{asset.code}</span>} title={t("nav.edit")} />
      <AssetForm
        value={{
          id: asset.id,
          categoryId: asset.categoryId,
          entityId: asset.entityId,
          name: asset.name,
          brand: asset.brand,
          model: asset.model,
          serial: asset.serial,
          purchaseDate: asset.purchaseDate,
          purchasePrice: asset.purchasePrice,
          supplier: asset.supplier,
          warrantyUntil: asset.warrantyUntil,
          condition: asset.condition,
          location: asset.location,
          notes: asset.notes,
        }}
        options={{ entities, categories, people: [], teams: [], canSeeMoney: canReadAssetMoney(user.principal, asset.entityId) }}
      />
    </Page>
  );
}
