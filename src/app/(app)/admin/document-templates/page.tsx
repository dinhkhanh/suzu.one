import { PlusIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { canManageTemplates, canReadTemplates, listTemplates, tierNeededFor } from "@/modules/documents/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("documentTemplates");

// The template library (FR-CHR-06). Writing templates is HR's; the tier on each is enforced by
// the engine, so this screen only has to show it.
export default async function DocumentTemplatesPage() {
  const user = await requireUser();
  if (!canReadTemplates(user.principal)) notFound();

  const [rows, t, tiers, kinds] = await Promise.all([listTemplates(), getTranslations("documents.designer"), getTranslations("documents.tier"), getTranslations("documents.kind")]);
  const manage = canManageTemplates(user.principal);

  return (
    <Page>
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={
          manage ? (
            <Link href="/admin/document-templates/new" className={buttonVariants()}>
              <PlusIcon aria-hidden />
              {t("new")}
            </Link>
          ) : null
        }
      />

      <TableCard>
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="file">{t("name")}</TableHead>
              <TableHead kind="select">{t("kind")}</TableHead>
              <TableHead kind="org">{t("entity")}</TableHead>
              <TableHead kind="status">{t("tier")}</TableHead>
              <TableHead kind="number">{t("version")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {rows.map((row) => {
              const needed = tierNeededFor(row.body);
              return (
                <TableRow key={row.id} className={row.isActive ? undefined : "text-muted-foreground"}>
                  <TableCell kind="id">{row.code}</TableCell>
                  <TableCell className="max-w-96 truncate">
                    <Link href={`/admin/document-templates/${row.id}`} className="font-medium hover:underline">
                      {row.name}
                    </Link>
                    {row.isActive ? null : <span className="ml-2 text-xs text-faint">{t("inactive")}</span>}
                  </TableCell>
                  <TableCell>{kinds(row.kind)}</TableCell>
                  <TableCell>
                    {row.entityName ? (
                      <RecordLink kind="entity" id={row.entityId}>
                        {row.entityName}
                      </RecordLink>
                    ) : (
                      <span className="text-muted-foreground">{t("groupWide")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Badge variant={row.tier === "compensation" ? "destructive" : row.tier === "restricted" ? "warning" : "outline"}>{tiers(row.tier)}</Badge>
                      {/* What the body actually demands, so a mismatch is visible at a glance. */}
                      {row.tier !== needed ? (
                        <span className="text-xs text-faint">
                          ({t("needs")} {tiers(needed)})
                        </span>
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell kind="number" className="text-faint">
                    v{row.version}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {manage ? <TableAddRow label={t("new")} href="/admin/document-templates/new" /> : null}
      </TableCard>
    </Page>
  );
}
