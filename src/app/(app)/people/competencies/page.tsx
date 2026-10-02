import { getTranslations } from "next-intl/server";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { pageTitle } from "@/i18n/page-title";
import { toSearchKey } from "@/lib/text";
import { cn } from "@/lib/utils";
import { COMPETENCY_KINDS } from "@/modules/core-hr/enums";
import { canManageCompetencies } from "@/modules/core-hr/policy";
import { listCompetencyCatalogue, peopleModuleOpen } from "@/modules/core-hr/service";
import { AddCompetencyRow, EditCompetencyButton } from "@/modules/core-hr/ui/competency-catalogue";
import { requireUser } from "@/modules/platform/auth/session";

export const generateMetadata = pageTitle("competencies");

// The catalogue of professional fields and skills (FR-CHR-14), both kinds in one list: people add
// to it from their own profile, and HR keeps it tidy here — a misspelt name corrected, a double
// merged, an entry nobody needs removed. Every name on a profile is read from this list.
export default async function CompetenciesPage(props: PageProps<"/people/competencies">) {
  const user = await requireUser();
  if (!(await peopleModuleOpen(user)) || !canManageCompetencies(user.principal)) notFound();
  const t = await getTranslations("people");
  const query = await props.searchParams;
  const one = (key: string) => (typeof query[key] === "string" && query[key] !== "" ? (query[key] as string) : undefined);
  const q = one("q")?.slice(0, 100);
  const kind = COMPETENCY_KINDS.find((value) => value === one("kind"));

  const all = await listCompetencyCatalogue();
  const key = q ? toSearchKey(q) : null;
  const rows = all.filter((row) => (!kind || row.kind === kind) && (!key || toSearchKey(row.name).includes(key)));

  return (
    <Page>
      <PageHeader
        title={t("competencies.title")}
        description={t("competencies.catalogueDescription", { count: all.length })}
        actions={
          <Link href="/people" className={cn(buttonVariants({ variant: "outline" }))}>
            {t("orgChart.backToList")}
          </Link>
        }
      />

      <Form action="/people/competencies" className="toolbar">
        <Input name="q" defaultValue={q} placeholder={t("competencies.searchName")} aria-label={t("competencies.searchName")} className="w-full sm:w-64" />
        <Select name="kind" defaultValue={kind ?? ""} aria-label={t("competencies.kind")} className="w-auto">
          <option value="">{t("competencies.allKinds")}</option>
          {COMPETENCY_KINDS.map((value) => (
            <option key={value} value={value}>
              {t(`competencies.${value}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {t("filters.apply")}
        </Button>
        {q || kind ? (
          <Link href="/people/competencies" className={cn(buttonVariants({ variant: "ghost" }))}>
            {t("filters.clear")}
          </Link>
        ) : null}
      </Form>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("competencies.name")}</TableHead>
              <TableHead kind="select">{t("competencies.kind")}</TableHead>
              <TableHead kind="number">{t("competencies.holders")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableEmpty>{all.length === 0 ? t("competencies.empty") : t("competencies.noMatch")}</TableEmpty> : null}
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary">{t(`competencies.${row.kind}`)}</Badge>
                </TableCell>
                <TableCell kind="number">
                  {row.holders > 0 ? (
                    <Link href={`/people?competencyId=${row.id}`} title={t("competencies.seeHolders", { count: row.holders, name: row.name })} className="underline-offset-4 hover:underline">
                      {row.holders}
                    </Link>
                  ) : (
                    <span className="text-faint">0</span>
                  )}
                </TableCell>
                <TableCell kind="actions">
                  <EditCompetencyButton entry={row} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <AddCompetencyRow />
      </TableCard>
    </Page>
  );
}
