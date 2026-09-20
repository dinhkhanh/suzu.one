import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach } from "@/modules/payroll/policy";
import { listSalaryOverview } from "@/modules/payroll/salaries";
import { formatVnd } from "@/modules/payroll/ui/money";

export const metadata: Metadata = { title: "Salaries" };

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
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("title")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("salaries.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("salaries.description")}</p>
      </header>
      <form className="flex flex-wrap items-end gap-2" action="/payroll/salaries">
        <input name="q" defaultValue={search ?? ""} placeholder={t("salaries.search")} className="h-9 rounded-md border bg-transparent px-3 text-sm" />
        <select name="entity" defaultValue={entityId ?? ""} className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">{t("salaries.allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code}
            </option>
          ))}
        </select>
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
          {t("salaries.filter")}
        </button>
      </form>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("salaries.person")}</TableHead>
            <TableHead>{t("salaries.entity")}</TableHead>
            <TableHead>{t("profiles.profile")}</TableHead>
            <TableHead className="text-right">{t("salaries.baseSalary")}</TableHead>
            <TableHead className="text-right">{t("salaries.insuranceSalary")}</TableHead>
            <TableHead className="text-right">{t("salaries.allowances")}</TableHead>
            <TableHead>{t("salaries.validFrom")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.personId}>
              <TableCell>
                <Link href={`/payroll/salaries/${row.personId}`} className="font-medium hover:underline">
                  {row.fullName}
                </Link>
                <span className="ml-2 font-mono text-xs text-muted-foreground">{row.employeeCode}</span>
                {row.hasOpenChange ? (
                  <Badge variant="outline" className="ml-2 text-[10px]">
                    {t("salaries.openChange")}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>{row.entityId ? entityCode.get(row.entityId) : "—"}</TableCell>
              <TableCell>{row.profile ? <Badge variant={row.profile === "simple" ? "outline" : "secondary"}>{t(`profiles.kinds.${row.profile}`)}</Badge> : <span className="text-destructive">{t("salaries.noProfile")}</span>}</TableCell>
              {row.structure ? (
                <>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.structure.baseSalary)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.structure.insuranceSalary)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatVnd(row.structure.allowancesTotal)}</TableCell>
                  <TableCell>{day(row.structure.validFrom)}</TableCell>
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
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("salaries.empty")}</p> : null}
    </div>
  );
}
