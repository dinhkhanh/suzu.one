import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Table, TableAddRow, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        {canManageTemplates(user.principal) ? (
          <Link href="/admin/document-templates/new" className="h-9 rounded-md bg-primary px-3 text-sm font-medium leading-9 text-primary-foreground">
            {t("new")}
          </Link>
        ) : null}
      </header>

      <TableCard>
        <Table className="min-w-[40rem]">
          <TableHeader>
            <TableRow>
              <TableHead kind="id">{t("code")}</TableHead>
              <TableHead kind="text">{t("name")}</TableHead>
              <TableHead kind="select">{t("kind")}</TableHead>
              <TableHead kind="org">{t("entity")}</TableHead>
              <TableHead kind="select">{t("tier")}</TableHead>
              <TableHead kind="number">{t("version")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id} className={row.isActive ? undefined : "text-muted-foreground"}>
                <TableCell kind="id">
                  <Link href={`/admin/document-templates/${row.id}`} className="hover:underline">
                    {row.code}
                  </Link>
                </TableCell>
                <TableCell>{row.name}</TableCell>
                <TableCell>{kinds(row.kind)}</TableCell>
                <TableCell>{row.entityName ?? t("groupWide")}</TableCell>
                <TableCell>
                  {tiers(row.tier)}
                  {/* What the body actually demands, so a mismatch is visible at a glance. */}
                  {row.tier !== tierNeededFor(row.body) ? <span className="ml-1 text-xs text-muted-foreground">({t("needs")} {tiers(tierNeededFor(row.body))})</span> : null}
                </TableCell>
                <TableCell kind="number">v{row.version}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {canManageTemplates(user.principal) ? <TableAddRow label={t("new")} href="/admin/document-templates/new" /> : null}
      </TableCard>
    </div>
  );
}
