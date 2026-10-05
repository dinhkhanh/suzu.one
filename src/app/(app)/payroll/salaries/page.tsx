import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Page, PageHeader } from "@/components/ui/page";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecordLink } from "@/components/ui/record-link";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { listSalaryOverview } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";
import { PayrollTabs } from "@/modules/payroll/ui/payroll-tabs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("salaries");

export default async function SalariesPage({ searchParams }: PageProps<"/payroll/salaries">) {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/salaries");

  const params = await searchParams;
  const entityId = typeof params.entity === "string" && /^[0-9a-f-]{36}$/.test(params.entity) ? params.entity : null;
  const search = typeof params.q === "string" ? params.q.slice(0, 80) : null;
  const [t, format, rows, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listSalaryOverview(user.principal, { entityId, search }), listEntityOptions(reach)]);
  const entityCode = new Map(entities.map((entity) => [entity.id, entity.code]));
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00+07:00`), { dateStyle: "medium" });

  return (
    <Page width="wide">
      <PageHeader eyebrow={t("title")} title={t("salaries.title")} description={t("salaries.description")} />
      <PayrollTabs active="salaries" principal={user.principal} />
      <form className="toolbar" action="/payroll/salaries">
        <Input name="q" defaultValue={search ?? ""} placeholder={t("salaries.search")} aria-label={t("salaries.search")} className="w-full md:w-64" />
        <Select name="entity" defaultValue={entityId ?? ""} aria-label={t("salaries.allEntities")} className="w-auto min-w-40">
          <option value="">{t("salaries.allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {t("salaries.filter")}
        </Button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("salaries.person")}</TableHead>
            <TableHead kind="org">{t("salaries.entity")}</TableHead>
            <TableHead kind="select">{t("profiles.profile")}</TableHead>
            <TableHead kind="money">{t("salaries.baseSalary")}</TableHead>
            <TableHead kind="money">{t("salaries.insuranceSalary")}</TableHead>
            <TableHead kind="money">{t("salaries.allowances")}</TableHead>
            <TableHead kind="date">{t("salaries.validFrom")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("salaries.empty")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/payroll/salaries/${row.personId}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
                <span className="ml-2 font-mono text-xs text-faint">{row.employeeCode}</span>
                {row.hasOpenChange ? (
                  <Badge dot variant="warning" className="ml-2">
                    {t("salaries.openChange")}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{row.entityId ? <RecordLink kind="entity" id={row.entityId}>{entityCode.get(row.entityId)}</RecordLink> : "—"}</TableCell>
              <TableCell>{row.profile ? <Badge variant={row.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${row.profile}`)}</Badge> : <Badge dot variant="destructive">{t("salaries.noProfile")}</Badge>}</TableCell>
              {row.structure ? (
                <>
                  <TableCell kind="money">{formatVnd(row.structure.baseSalary)}</TableCell>
                  <TableCell kind="money" className="text-muted-foreground">{formatVnd(row.structure.insuranceSalary)}</TableCell>
                  <TableCell kind="money" className="text-muted-foreground">{formatVnd(row.structure.allowancesTotal)}</TableCell>
                  <TableCell className="text-muted-foreground">{day(row.structure.validFrom)}</TableCell>
                </>
              ) : (
                <TableCell colSpan={4} className="text-destructive">
                  {t("salaries.noStructure")}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
}
