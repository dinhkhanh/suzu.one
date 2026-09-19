import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listDepartments, listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";
import { CreateEntityForm } from "./create-entity-form";

export const metadata: Metadata = { title: "Entities" };

export default async function EntitiesPage() {
  const user = await requireUser();
  if (!can(user.principal, "org:read")) notFound();

  const t = await getTranslations("entities");
  const [allEntities, departments] = await Promise.all([listEntities(), listDepartments()]);
  // Entity-scoped admins only see the entities their grants cover.
  const entities = allEntities.filter((entity) => can(user.principal, "org:read", { entityId: entity.id }));
  const sharedDepartments = departments.filter((department) => department.entityId === null);

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("code")}</TableHead>
            <TableHead>{t("legalName")}</TableHead>
            <TableHead>{t("taxCode")}</TableHead>
            <TableHead>{t("wageRegion")}</TableHead>
            <TableHead>{t("status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entities.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            entities.map((entity) => (
              <TableRow key={entity.id}>
                <TableCell className="font-mono text-xs">{entity.code}</TableCell>
                <TableCell>
                  <p className="font-medium">{entity.shortName}</p>
                  <p className="text-xs text-muted-foreground">{entity.legalName}</p>
                </TableCell>
                <TableCell>{entity.taxCode ?? "—"}</TableCell>
                <TableCell>{entity.wageRegion ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={entity.isActive ? "secondary" : "outline"}>{entity.isActive ? t("active") : t("inactive")}</Badge>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {can(user.principal, "org:manage", {}) ? <CreateEntityForm /> : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-medium text-muted-foreground">{t("departments")}</h2>
        <div className="flex flex-wrap gap-2">
          {sharedDepartments.map((department) => (
            <Badge key={department.id} variant="outline">
              {department.name}
            </Badge>
          ))}
        </div>
      </section>
    </div>
  );
}
