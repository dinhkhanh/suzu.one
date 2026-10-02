import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { CreateEntityForm } from "@/modules/platform/org/ui/entity-forms";
import { can } from "@/modules/platform/rbac/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("entities");

export default async function EntitiesPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:read")) notFound();

  const t = await getTranslations("entities");
  // Entity-scoped admins only see the entities their grants cover.
  const entities = (await listEntities()).filter((entity) => can(user.principal, "org:read", { entityId: entity.id }));

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />

      <TableCard>
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="org">{t("legalName")}</TableHead>
              <TableHead kind="id">{t("taxCode")}</TableHead>
              <TableHead kind="select">{t("wageRegion")}</TableHead>
              <TableHead kind="status">{t("status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entities.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {entities.map((entity) => (
              <TableRow key={entity.id}>
                <TableCell kind="id">{entity.code}</TableCell>
                <TableCell className="max-w-96">
                  <RecordLink kind="entity" id={entity.id} className="block truncate font-medium">
                    {entity.shortName}
                  </RecordLink>
                  <p className="truncate text-xs text-muted-foreground">{entity.legalName}</p>
                </TableCell>
                <TableCell kind="id">{entity.taxCode ?? "—"}</TableCell>
                <TableCell>{entity.wageRegion ? t("wageRegionValue", { region: entity.wageRegion }) : <span className="text-faint">—</span>}</TableCell>
                <TableCell>
                  <Badge dot variant={entity.isActive ? "success" : "outline"}>{entity.isActive ? t("active") : t("inactive")}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {can(user.principal, "org:manage", {}) ? (
          <TableAddRow label={t("add")} open={entities.length === 0}>
            <CreateEntityForm />
          </TableAddRow>
        ) : null}
      </TableCard>
    </Page>
  );
}
