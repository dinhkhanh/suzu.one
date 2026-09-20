import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { asc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageAssets, canReadAssetMoney, listCategories } from "@/modules/assets/service";
import { AssetForm } from "@/modules/assets/ui/asset-forms";

export const metadata: Metadata = { title: "Ghi nhận tài sản" };

export default async function NewAssetPage() {
  const user = await requireUser();
  if (!canManageAssets(user.principal)) redirect("/assets/mine");
  const [categories, entities, t] = await Promise.all([listCategories(), db().select().from(schema.entity).orderBy(asc(schema.entity.code)), getTranslations("assets")]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">{t("nav.new")}</h1>
      <AssetForm
        value={{ id: null, categoryId: categories[0]?.id ?? "", entityId: entities[0]?.id ?? "", name: "", brand: null, model: null, serial: null, purchaseDate: null, purchasePrice: null, supplier: null, warrantyUntil: null, condition: "new", location: null, notes: null }}
        options={{ entities, categories, people: [], teams: [], canSeeMoney: canReadAssetMoney(user.principal) }}
      />
    </div>
  );
}
