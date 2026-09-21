import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageAssets, canReadAssetMoney, findAsset, listCategories } from "@/modules/assets/service";
import { AssetForm } from "@/modules/assets/ui/asset-forms";

export const metadata: Metadata = { title: "Sửa tài sản" };

export default async function EditAssetPage({ params }: PageProps<"/assets/[assetId]/edit">) {
  const user = await requireUser();
  const { assetId } = await params;
  const asset = await findAsset(assetId);
  if (!asset || !canManageAssets(user.principal, asset.entityId)) notFound();
  const [categories, entities, t] = await Promise.all([listCategories(), db().select().from(schema.entity).orderBy(asc(schema.entity.code)), getTranslations("assets")]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1>
        {t("nav.edit")} · <span className="font-mono text-base">{asset.code}</span>
      </h1>
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
    </div>
  );
}
