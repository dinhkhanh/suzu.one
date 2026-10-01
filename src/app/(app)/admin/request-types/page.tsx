import { PlusIcon } from "lucide-react";
import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
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
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          <Link href="/admin/request-types/new" className={buttonVariants()}>
            <PlusIcon aria-hidden />
            {t("add")}
          </Link>
        }
      />
      <TableCard>
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("columns.name")}</TableHead>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="org">{t("entity")}</TableHead>
              <TableHead kind="number">{t("columns.fields")}</TableHead>
              <TableHead kind="number">{t("columns.followUps")}</TableHead>
              <TableHead kind="time" className="text-left">{t("columns.reminder")}</TableHead>
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
                  <Badge variant={type.entityId ? "info" : "secondary"}>{type.entityId ? (entityName.get(type.entityId) ?? "—") : t("wholeGroup")}</Badge>
                </TableCell>
                <TableCell kind="number">{type.form.fields.length}</TableCell>
                <TableCell kind="number">{type.followUps.length || <span className="text-faint">—</span>}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{type.slaRemindAfterDays > 0 ? t("remindsAfter", { days: type.slaRemindAfterDays }) : <span className="text-faint">—</span>}</TableCell>
                <TableCell>
                  <span className="flex gap-1.5">
                    <Badge dot variant={type.active ? "success" : "outline"}>{type.active ? t("on") : t("off")}</Badge>
                    {type.standalone ? null : <Badge variant="outline">{t("followUpOnly")}</Badge>}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TableAddRow label={t("add")} href="/admin/request-types/new" />
      </TableCard>
    </Page>
  );
}
