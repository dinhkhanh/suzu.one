import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { Page, PageHeader } from "@/components/ui/page";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageCategories, listCategories } from "@/modules/assets/service";
import { CategoryForm } from "@/modules/assets/ui/asset-forms";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("assetCategories");

// The category library belongs to the group, so it takes a group-wide grant to change.
export default async function AssetCategoriesPage() {
  const user = await requireUser();
  if (!canManageCategories(user.principal)) redirect("/assets");
  const [categories, t] = await Promise.all([listCategories(), getTranslations("assets.categories")]);

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="flex flex-col gap-4">
        {categories.map((category) => (
          <CategoryForm
            key={category.id}
            value={{ id: category.id, code: category.code, name: category.name, kind: category.kind, requiresSerial: category.requiresSerial, defaultWarrantyMonths: category.defaultWarrantyMonths, bookable: category.bookable, sortOrder: category.sortOrder, isActive: category.isActive }}
          />
        ))}
        <div>
          <h2 className="mb-2 font-medium">{t("addTitle")}</h2>
          <CategoryForm value={{ id: null, code: "", name: "", kind: "it_equipment", requiresSerial: false, defaultWarrantyMonths: null, bookable: false, sortOrder: (categories.at(-1)?.sortOrder ?? 0) + 1, isActive: true }} />
        </div>
      </div>
    </Page>
  );
}
