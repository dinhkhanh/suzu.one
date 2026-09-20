import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { assetTemplate } from "@/modules/assets/import";
import { commitAssetImportAction, stageAssetImportAction } from "@/modules/assets/import-actions";
import { canManageAssets } from "@/modules/assets/service";
import { requireUser } from "@/modules/platform/auth/session";
import { ImportWizard } from "@/modules/platform/import/ui/import-wizard";

export const metadata: Metadata = { title: "Nhập tài sản" };

export default async function ImportAssetsPage() {
  const user = await requireUser();
  if (!canManageAssets(user.principal)) notFound();
  const t = await getTranslations("assets.import");

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/assets" className={buttonVariants({ variant: "outline" })}>
          {t("back")}
        </Link>
      </header>
      <ul className="list-disc pl-5 text-sm text-muted-foreground">
        <li>{t("notes.newOnly")}</li>
        <li>{t("notes.code")}</li>
        <li>{t("notes.holder")}</li>
        <li>{t("notes.serial")}</li>
      </ul>
      <ImportWizard title={t("wizard")} template={{ fileName: "assets.csv", csv: assetTemplate() }} stageAction={stageAssetImportAction} commitAction={commitAssetImportAction} />
    </div>
  );
}
