import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { Page, PageHeader } from "@/components/ui/page";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/page-title";
import { cn } from "@/lib/utils";
import { listPositionCatalogue } from "@/modules/core-hr/corrections";
import { canManagePositions } from "@/modules/core-hr/policy";
import { peopleModuleOpen } from "@/modules/core-hr/service";
import { RenamePositionButton } from "@/modules/core-hr/ui/correction-forms";
import { requireUser } from "@/modules/platform/auth/session";

export const generateMetadata = pageTitle("positions");

// The position catalogue ("chức vụ", CHR-02): one row per post for the whole group, made the first
// time a placement names it. A name typed wrong was written into the catalogue for good; here
// group-wide HR corrects it once, for everybody who holds it. Holders are counted in SQL.
export default async function PositionsPage() {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user)) || !canManagePositions(user.principal)) notFound();
  const [t, rows] = await Promise.all([getTranslations("people"), listPositionCatalogue()]);

  return (
    <Page>
      <PageHeader
        title={t("positions.title")}
        description={t("positions.description", { count: rows.length })}
        actions={
          <Link href="/people" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("orgChart.backToList")}
          </Link>
        }
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("positions.name")}</TableHead>
              <TableHead kind="number">{t("positions.holders")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{t("positions.empty")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell kind="number">{row.holders > 0 ? row.holders : <span className="text-faint">0</span>}</TableCell>
                <TableCell kind="actions">
                  <RenamePositionButton entry={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>
    </Page>
  );
}
