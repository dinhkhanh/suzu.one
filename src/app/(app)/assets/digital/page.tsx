import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { TableAddRow, TableCard } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageAssets, canManageDigitalAssets, DIGITAL_KINDS, DIGITAL_PLATFORMS, listDigitalAssets, summariseDigitalAssets } from "@/modules/assets/service";
import { DigitalFilterBar, DigitalTable } from "@/modules/assets/ui/digital-views";
import { AssetsNav } from "@/modules/assets/ui/nav";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("digitalAssets");

// The digital-asset register (FR-AST-07): pages, channels, ad accounts, websites. Everybody on the
// staff has this page — a page or a channel is a working tool — and each reader sees the assets
// that exist for them: every `staff` one, and the restricted ones they run or hold access to.
export default async function DigitalAssetsPage({ searchParams }: PageProps<"/assets/digital">) {
  const user = await requireUser();
  const query = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const filter = {
    platform: DIGITAL_PLATFORMS.find((value) => value === one(query.platform)),
    kind: DIGITAL_KINDS.find((value) => value === one(query.kind)),
    entityId: one(query.entityId),
    search: one(query.search),
    mine: one(query.mine) === "1",
  };

  const [rows, totals, entities, t] = await Promise.all([listDigitalAssets(user.principal, filter), summariseDigitalAssets(user.principal), listEntities(), getTranslations("assets.digital")]);
  const manages = canManageDigitalAssets(user.principal);

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manages ? (
            <Button nativeButton={false} render={<Link href="/assets/digital/new" />}>
              {t("new")}
            </Button>
          ) : null
        }
      />
      <AssetsNav current="digital" manages={canManageAssets(user.principal)} principal={user.principal} />

      {/* Counted over everything this reader may see — not the page of rows below. */}
      <TileGrid>
        <Tile label={t("tiles.total")} value={totals.total} href="/assets/digital" />
        <Tile label={t("tiles.mine")} value={totals.mine} href="/assets/digital?mine=1" />
        {totals.waiting > 0 ? <Tile label={t("tiles.waiting")} value={totals.waiting} tone="warning" /> : null}
        {totals.rotationDue > 0 ? <Tile label={t("tiles.rotationDue")} value={totals.rotationDue} tone="destructive" /> : null}
      </TileGrid>

      <DigitalFilterBar query={{ ...filter, mine: filter.mine ? "1" : undefined }} entities={entities.map(({ id, code, shortName }) => ({ id, code, shortName }))} />
      <TableCard>
        <DigitalTable rows={rows} />
        {manages ? <TableAddRow label={t("new")} href="/assets/digital/new" /> : null}
      </TableCard>
    </Page>
  );
}
