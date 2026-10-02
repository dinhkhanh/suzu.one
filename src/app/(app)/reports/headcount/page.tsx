import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Page, PageHeader, Tile, TileGrid } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { addDays, todayInVietnam } from "@/lib/dates";
import { exportHeadcountAction } from "@/modules/core-hr/export-actions";
import { getHeadcountReport } from "@/modules/core-hr/reports";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listEntities } from "@/modules/platform/org/service";
import { can } from "@/modules/platform/rbac/policy";
import { RateBar } from "@/modules/reports/ui/bar";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("headcount");

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
  const tOverview = await getTranslations("reports.overview");
  const tc = await getTranslations("records.contracts.types");
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });
  const { snapshot, movement } = report;
  const label = (group: string, key: string) => (t.has(`keys.${group}.${key}` as never) ? t(`keys.${group}.${key}` as never) : key === "unknown" ? t("unknown") : key);
  const percent = (count: number) => (snapshot.total ? `${Math.round((count * 100) / snapshot.total)}%` : "—");

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={<Link href="/reports">{tOverview("title")}</Link>}
        title={t("title")}
        description={t("description")}
        actions={<ExportButton action={exportHeadcountAction} input={{ ...filters, entityId: filters.entityId ?? "", locale }} label={te("button")} failedLabel={te("failed")} truncatedLabel={te("truncated")} />}
      >
        {report.scoped ? <p className="text-sm text-muted-foreground">{t("scoped")}</p> : null}
      </PageHeader>

      <form className="toolbar">
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("asOf")}
          <DatePicker name="asOf" defaultValue={filters.asOf} className="w-auto" />
        </Label>
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("from")}
          <DatePicker name="from" defaultValue={filters.from} className="w-auto" />
        </Label>
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("to")}
          <DatePicker name="to" defaultValue={filters.to} className="w-auto" />
        </Label>
        <Select name="entityId" defaultValue={filters.entityId ?? ""} aria-label={t("allEntities")} className="w-full sm:w-44">
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

      <TileGrid>
        <Tile label={t("total")} value={snapshot.total} />
        <Tile label={t("opening")} value={movement.opening} />
        <Tile label={t("joiners")} value={movement.joiners} tone={movement.joiners > 0 ? "success" : undefined} />
        <Tile label={t("leavers")} value={movement.leavers} tone={movement.leavers > 0 ? "warning" : undefined} />
        <Tile label={t("closing")} value={movement.closing} />
        <Tile label={t("turnover")} value={movement.turnoverBp === null ? "—" : `${(movement.turnoverBp / 100).toFixed(1)}%`} hint={t("turnoverHint")} />
      </TileGrid>

      <div className="grid gap-6 md:grid-cols-2">
        {(["byEntity", "byDepartment", "byWorkforceType", "byGender", "byAge", "bySeniority"] as const).map((group) => (
          <TableCard key={group}>
            <TableCardHeader title={t(`groups.${group}`)} />
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind={group === "byEntity" || group === "byDepartment" ? "org" : "select"}>{t("columns.group")}</TableHead>
                  <TableHead kind="number" className="w-24">{t("count")}</TableHead>
                  <TableHead kind="percent" className="w-24">{t("share")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {snapshot[group].length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
                {snapshot[group].map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{label(group, row.key)}</TableCell>
                    <TableCell kind="number">{row.count}</TableCell>
                    <TableCell kind="percent">
                      <RateBar rate={snapshot.total ? row.count / snapshot.total : null} label={percent(row.count)} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ))}
        {(["joinersByDepartment", "leaversByDepartment"] as const).map((group) => (
          <TableCard key={group}>
            <TableCardHeader title={t(group)} />
            <Table numbered={false}>
              <TableHeader>
                <TableRow>
                  <TableHead kind="org">{t("department")}</TableHead>
                  <TableHead kind="number" className="w-24">{t("count")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movement[group].length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
                {movement[group].map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key === "unknown" ? t("unknown") : row.key}</TableCell>
                    <TableCell kind="number">{row.count}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableCard>
        ))}
      </div>

      {(["contractsExpiring", "probations"] as const).map((list) => (
        <TableCard key={list}>
          <TableCardHeader title={t(list)} count={report[list].length || null} />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead kind="person">{t("person")}</TableHead>
                <TableHead kind="org">{t("department")}</TableHead>
                <TableHead kind="select">{t("contractType")}</TableHead>
                <TableHead kind="date">{t("endDate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {report[list].length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
              {report[list].map((row) => (
                <TableRow key={`${row.personId}-${row.endDate}-${row.type}`}>
                  <TableCell>
                    <RecordLink kind="person" id={row.personId} className="font-medium">
                      {row.fullName}
                    </RecordLink>{" "}
                    <span className="font-mono text-xs text-faint">{row.employeeCode}</span>
                  </TableCell>
                  <TableCell>
                    {row.department ? (
                      <>
                        <RecordLink kind="unit" id={row.departmentId}>{row.department}</RecordLink> ·{" "}
                      </>
                    ) : null}
                    <RecordLink kind="entity" id={row.entityId}>{row.entity}</RecordLink>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{tc(row.type as "probation")}</Badge>
                  </TableCell>
                  <TableCell kind="date">{day(row.endDate)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ))}
    </Page>
  );
}
