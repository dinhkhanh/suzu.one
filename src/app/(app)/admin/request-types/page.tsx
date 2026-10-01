import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { listEntities } from "@/modules/platform/org/service";
import { canManageRequestTypes } from "@/modules/requests/policy";
import { listRequestTypes } from "@/modules/requests/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("requestTypes");

// The catalogue an administrator designs (FR-REQ-01). A type's flow lives on its own page, edited
// by the approval engine's editor.
export default async function RequestTypesPage() {
  const user = await requireUser();
  if (!canManageRequestTypes(user.principal)) notFound();
  const [t, locale, types, entities] = await Promise.all([getTranslations("requests.designer"), getLocale(), listRequestTypes(), listEntities()]);
  const entityName = new Map(entities.map((entity) => [entity.id, entity.shortName]));

  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <Link href="/admin/request-types/new" className={buttonVariants({ size: "sm" })}>
          {t("add")}
        </Link>
      </header>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.name")}</TableHead>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="org">{t("entity")}</TableHead>
              <TableHead kind="number">{t("columns.fields")}</TableHead>
              <TableHead kind="number">{t("columns.followUps")}</TableHead>
              <TableHead kind="time">{t("columns.reminder")}</TableHead>
              <TableHead kind="status">{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {types.map((type) => (
              <TableRow key={type.id}>
                <TableCell className="max-w-80 truncate">
                  <Link href={`/admin/request-types/${type.id}`} className="font-medium hover:underline">
                    {locale === "en" ? type.nameEn : type.nameVi}
                  </Link>
                </TableCell>
                <TableCell kind="id">{type.code}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{type.entityId ? (entityName.get(type.entityId) ?? "—") : t("wholeGroup")}</Badge>
                </TableCell>
                <TableCell kind="number">{type.form.fields.length}</TableCell>
                <TableCell kind="number">{type.followUps.length || "—"}</TableCell>
                <TableCell kind="time">{type.slaRemindAfterDays > 0 ? t("remindsAfter", { days: type.slaRemindAfterDays }) : "—"}</TableCell>
                <TableCell>
                  <span className="flex gap-1.5">
                    {type.standalone ? null : <Badge variant="outline">{t("followUpOnly")}</Badge>}
                    {type.active ? null : <Badge variant="outline">{t("off")}</Badge>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("add")} href="/admin/request-types/new" />
      </TableCard>
    </div>
  );
}
