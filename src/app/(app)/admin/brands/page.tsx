import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/page-title";
import { publicOrigin } from "@/lib/site";
import { canManageAnyBrandKit, canManageBrandKit } from "@/modules/brand/policy";
import { listManagedBrandKits, totalsByKit } from "@/modules/brand/service";
import { CreateBrandKitForm } from "@/modules/brand/ui/kit-forms";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";

export const generateMetadata = pageTitle("brands");

const VISIBILITY_TONE = { hidden: "outline", unlisted: "info", listed: "success" } as const;

// Every brand kit this person keeps (FR-BRD-01): where each one lives on the public domain, whether
// the public can see it, and how much it is downloaded.
export default async function BrandKitsPage() {
  const user = await requireUser();
  if (!canManageAnyBrandKit(user.principal)) notFound();

  const [t, kits, entities] = await Promise.all([getTranslations("brands"), listManagedBrandKits(user.principal), listEntities()]);
  const totals = await totalsByKit(kits.map((kit) => kit.id));
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));
  const creatableEntities = entities.filter((entity) => entity.isActive && canManageBrandKit(user.principal, { entityId: entity.id })).map((entity) => ({ id: entity.id, name: entity.shortName }));
  const allowGroup = canManageBrandKit(user.principal, { entityId: null });
  const origin = publicOrigin();

  return (
    <Page>
      <PageHeader title={t("title")} description={t("lede")} />

      <TableCard>
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.name")}</TableHead>
              <TableHead kind="link">{t("columns.address")}</TableHead>
              <TableHead kind="status">{t("columns.visibility")}</TableHead>
              <TableHead kind="number">{t("columns.sections")}</TableHead>
              <TableHead kind="number">{t("columns.files")}</TableHead>
              <TableHead kind="number">{t("columns.downloads")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {kits.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {kits.map((kit) => (
              <TableRow key={kit.id}>
                <TableCell className="max-w-72">
                  <RecordLink kind="brandKit" id={kit.id} className="block truncate font-medium">
                    {kit.name}
                  </RecordLink>
                  <p className="truncate text-xs text-muted-foreground">{kit.entityId ? entityName.get(kit.entityId) : t("wholeGroup")}</p>
                </TableCell>
                <TableCell kind="link" className="font-mono text-xs">
                  {kit.visibility === "hidden" ? (
                    <span className="text-muted-foreground">/brands/{kit.slug}</span>
                  ) : (
                    <a href={`${origin}/brands/${kit.slug}`} target="_blank" rel="noopener noreferrer">
                      /brands/{kit.slug}
                    </a>
                  )}
                </TableCell>
                <TableCell>
                  <Badge dot variant={VISIBILITY_TONE[kit.visibility]}>
                    {t(`visibilities.${kit.visibility}`)}
                  </Badge>
                </TableCell>
                <TableCell kind="number">{totals.get(kit.id)?.sections ?? 0}</TableCell>
                <TableCell kind="number">{totals.get(kit.id)?.files ?? 0}</TableCell>
                <TableCell kind="number">{totals.get(kit.id)?.downloads ?? 0}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {allowGroup || creatableEntities.length > 0 ? (
          <TableAddRow label={t("add")} open={kits.length === 0}>
            <CreateBrandKitForm origin={origin} entities={creatableEntities} allowGroup={allowGroup} />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
