import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { type AssetStatus, ASSET_STATUSES, canManageAssets, canReadAssetMoney, canReadRegister, listAssets, listCategories, summaryByStatus } from "@/modules/assets/service";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { RegisterFilterBar, RegisterTable } from "@/modules/assets/ui/register-views";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("assets");

// The register (FR-AST-01). Someone without `asset:manage` anywhere has no register at all — only
// the equipment they are holding themselves, at /assets/mine.
export default async function AssetsPage({ searchParams }: PageProps<"/assets">) {
  const user = await requireUser();
  if (!canReadRegister(user.principal)) redirect("/assets/mine");

  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const status = ASSET_STATUSES.find((value) => value === one(query.status));
  const filter = { entityId: one(query.entityId), categoryId: one(query.categoryId), status: status as AssetStatus | undefined, search: one(query.search) };

  const [rows, categories, entities, totals, t, tStatus] = await Promise.all([
    listAssets(user.principal, filter),
    listCategories(),
    listEntities(),
    summaryByStatus(user.principal),
    getTranslations("assets"),
    getTranslations("assets.enums.status"),
  ]);
  const showMoney = canReadAssetMoney(user.principal, filter.entityId);
  const manages = canManageAssets(user.principal);

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manages ? (
            <>
              <Button nativeButton={false} variant="outline" render={<Link href="/assets/labels" />}>
                {t("nav.labels")}
              </Button>
              <Button nativeButton={false} variant="outline" render={<Link href="/assets/import" />}>
                {t("nav.import")}
              </Button>
              <Button nativeButton={false} render={<Link href="/assets/new" />}>{t("nav.new")}</Button>
            </>
          ) : null
        }
      />
      <AssetsNav current="register" manages={manages} />

      {/* The register by status, counted over everything in reach — not the page of rows below. */}
      <TileGrid>
        {ASSET_STATUSES.map((value) => (
          <Tile key={value} label={tStatus(value)} value={totals[value]} href={`/assets?status=${value}`} tone={value === "lost" && totals.lost > 0 ? "destructive" : value === "in_repair" && totals.in_repair > 0 ? "warning" : undefined} />
        ))}
      </TileGrid>

      <RegisterFilterBar query={filter} entities={entities} categories={categories} />
      <TableCard>
        <RegisterTable rows={rows} showMoney={showMoney} />
        {manages ? <TableAddRow label={t("nav.new")} href="/assets/new" /> : null}
      </TableCard>
    </Page>
  );
}
