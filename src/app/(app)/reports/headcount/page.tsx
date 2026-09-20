import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { exportHeadcountAction } from "@/modules/core-hr/export-actions";
import { getHeadcountReport } from "@/modules/core-hr/reports";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";

export const metadata: Metadata = { title: "Headcount" };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function HeadcountPage(props: PageProps<"/reports/headcount">) {
  const user = await requireUser();
  if (!can(user.principal, "report:read")) notFound();
  const query = await props.searchParams;
  const pick = (name: string, pattern: RegExp) => (typeof query[name] === "string" && pattern.test(query[name]) ? query[name] : undefined);
  const today = todayInVietnam();
  const asOf = pick("asOf", DAY) ?? today;
  // Default period: the month of the report date so far.
  const filters = { asOf, from: pick("from", DAY) ?? `${asOf.slice(0, 8)}01`, to: pick("to", DAY) ?? asOf, entityId: pick("entityId", UUID) };
  if (filters.from > filters.to) filters.from = addDays(filters.to, -30);

  const [report, entities, t, format, locale] = await Promise.all([getHeadcountReport(user.principal, filters), listEntities(), getTranslations("reports.headcount"), getFormatter(), getLocale()]);
  if (!report) notFound();
  const te = await getTranslations("exports");
  const tc = await getTranslations("records.contracts.types");
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const { snapshot, movement } = report;
  const label = (group: string, key: string) => (t.has(`keys.${group}.${key}` as never) ? t(`keys.${group}.${key}` as never) : key === "unknown" ? t("unknown") : key);
  const percent = (count: number) => (snapshot.total ? `${Math.round((count * 100) / snapshot.total)}%` : "—");

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          {report.scoped ? <p className="text-sm text-muted-foreground">{t("scoped")}</p> : null}
        </div>
        <ExportButton action={exportHeadcountAction} input={{ ...filters, entityId: filters.entityId ?? "", locale }} label={te("button")} failedLabel={te("failed")} truncatedLabel={te("truncated")} />
      </header>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {t("asOf")}
          <Input type="date" name="asOf" defaultValue={filters.asOf} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          {t("from")}
          <Input type="date" name="from" defaultValue={filters.from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          {t("to")}
          <Input type="date" name="to" defaultValue={filters.to} className="w-auto" />
        </label>
        <Select name="entityId" defaultValue={filters.entityId ?? ""} aria-label={t("allEntities")} className="w-auto">
          <option value="">{t("allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.shortName}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>

      <dl className="grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            [t("total"), snapshot.total],
            [t("opening"), movement.opening],
            [t("joiners"), movement.joiners],
            [t("leavers"), movement.leavers],
            [t("closing"), movement.closing],
            [t("turnover"), movement.turnoverBp === null ? "—" : `${(movement.turnoverBp / 100).toFixed(1)}%`],
          ] as const
        ).map(([name, value]) => (
          <div key={name} className="rounded-xl border p-3">
            <dt className="text-xs text-muted-foreground">{name}</dt>
            <dd className="text-xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="-mt-4 text-xs text-muted-foreground">{t("turnoverHint")}</p>

      <div className="grid gap-6 md:grid-cols-2">
        {(["byEntity", "byDepartment", "byWorkforceType", "byGender", "byAge", "bySeniority"] as const).map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t(`groups.${group}`)}</h2>
            <Table>
              <TableBody>
                {snapshot[group].map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{label(group, row.key)}</TableCell>
                    <TableCell className="w-16 text-right tabular-nums">{row.count}</TableCell>
                    <TableCell className="w-16 text-right text-muted-foreground tabular-nums">{percent(row.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))}
        {(["joinersByDepartment", "leaversByDepartment"] as const).map((group) => (
          <section key={group} className="flex flex-col gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">{t(group)}</h2>
            {movement[group].length === 0 ? <p className="text-sm text-muted-foreground">{t("none")}</p> : null}
            <Table>
              <TableBody>
                {movement[group].map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key === "unknown" ? t("unknown") : row.key}</TableCell>
                    <TableCell className="w-16 text-right tabular-nums">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ))}
      </div>

      {(["contractsExpiring", "probations"] as const).map((list) => (
        <section key={list} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium text-muted-foreground">{t(list)}</h2>
          {report[list].length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("none")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("person")}</TableHead>
                  <TableHead>{t("department")}</TableHead>
                  <TableHead>{t("contractType")}</TableHead>
                  <TableHead>{t("endDate")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report[list].map((row) => (
                  <TableRow key={`${row.personId}-${row.endDate}-${row.type}`}>
                    <TableCell>
                      <Link href={`/people/${row.personId}`} className="hover:underline">
                        {row.fullName}
                      </Link>{" "}
                      <span className="text-xs text-muted-foreground">{row.employeeCode}</span>
                    </TableCell>
                    <TableCell>{[row.department, row.entity].filter(Boolean).join(" · ")}</TableCell>
                    <TableCell>{tc(row.type as "probation")}</TableCell>
                    <TableCell className="whitespace-nowrap">{day(row.endDate)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ))}
    </div>
  );
}
