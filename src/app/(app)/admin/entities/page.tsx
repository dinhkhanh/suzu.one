import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="text">{t("legalName")}</TableHead>
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
                <TableCell>
                  <Link href={`/admin/entities/${entity.id}`} className="font-medium hover:underline">
                    {entity.shortName}
                  </Link>
                  <p className="text-xs text-muted-foreground">{entity.legalName}</p>
                </TableCell>
                <TableCell kind="id">{entity.taxCode ?? "—"}</TableCell>
                <TableCell>{entity.wageRegion ?? "—"}</TableCell>
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
    </div>
  );
}
