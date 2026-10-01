import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPublicOpenings } from "@/modules/recruit/public";

// Every job on offer. The only identifiers on this page are opaque slugs.
export default async function CareersPage() {
  const t = await getTranslations("recruit.careers");
  const locale = await getLocale();
  const openings = await listPublicOpenings();

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="text">{t("columns.role")}</TableHead>
            <TableHead kind="org">{t("columns.company")}</TableHead>
            <TableHead kind="org">{t("columns.department")}</TableHead>
            <TableHead kind="place">{t("columns.location")}</TableHead>
            <TableHead kind="select">{t("columns.workMode")}</TableHead>
            <TableHead kind="select">{t("columns.employmentType")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {openings.length === 0 ? <TableEmpty>{t("noOpenings")}</TableEmpty> : null}
          {openings.map((opening) => (
            <TableRow key={opening.slug}>
              <TableCell>
                <Link href={`/careers/${opening.slug}`} className="font-medium hover:underline">
                  {locale === "en" && opening.titleEn ? opening.titleEn : opening.title}
                </Link>
              </TableCell>
              <TableCell>{opening.entityName}</TableCell>
              <TableCell>{opening.departmentName ?? "—"}</TableCell>
              <TableCell>{opening.workLocation ?? "—"}</TableCell>
              <TableCell>
                <Badge variant="outline">{t(`workMode.${opening.workMode}` as "workMode.onsite")}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{t(`employmentType.${opening.employmentType}` as "employmentType.employee")}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
