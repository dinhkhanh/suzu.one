import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { todayInVietnam } from "@/lib/dates";
import { exportHistoryAction } from "@/modules/ops/actions";
import { canReadOps, getHistory, listTemplates, periodLabel, readableEntities } from "@/modules/ops/service";
import { EvidenceLinks } from "@/modules/ops/ui/history";
import { isUuid, OpsNav } from "@/modules/ops/ui/overview";
import { StatusBadge } from "@/modules/ops/ui/status-badge";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { pageTitle } from "@/i18n/page-title";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("complianceArchive");

// The archive (FR-OPS-09): every past period of an obligation with who closed it, when, the
// reference number, the amount and the filed papers — what a tax or insurance inspector asks for.
export default async function OpsHistoryPage({ searchParams }: PageProps<"/ops/history">) {
  const user = await requireUser();
  if (!canReadOps(user.principal)) notFound();
  const params = await searchParams;
  const today = todayInVietnam();
  const [entities, templates] = await Promise.all([readableEntities(user.principal), listTemplates()]);
  const templateId = isUuid(params.template) && templates.some((template) => template.id === params.template) ? params.template : null;
  const entityId = isUuid(params.entity) && entities.some((entity) => entity.id === params.entity) ? params.entity : null;
  const thisYear = Number(today.slice(0, 4));
  const year = typeof params.year === "string" && /^\d{4}$/.test(params.year) ? Number(params.year) : params.year === "all" ? null : thisYear;
  const rows = await getHistory({ principal: user.principal, personId: user.person.id }, { templateId: templateId ?? undefined, entityId, year, entityIds: entities.map((entity) => entity.id) }, today);

  const t = await getTranslations("ops");
  const format = await getFormatter();
  const locale = await getLocale();
  const day = (date: string | null) => (date ? format.dateTime(new Date(`${date}T00:00:00`), { dateStyle: "medium" }) : "—");
  const lateCount = rows.filter((row) => row.colour === "done_late" || row.colour === "overdue").length;

  return (
    <Page width="wide">
      <PageHeader title={t("history.title")} description={t("history.description")} />
      <OpsNav active="history" reads />

      <form action="/ops/history" method="get" className="toolbar">
        <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-72">
          {t("history.obligation")}
          <Select name="template" defaultValue={templateId ?? ""}>
            <option value="">{t("filters.all")}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.code} — {template.name}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-36">
          {t("dashboard.entity")}
          <Select name="entity" defaultValue={entityId ?? ""}>
            <option value="">{t("filters.all")}</option>
            {entities.map((entity) => (
              <option key={entity.id} value={entity.id}>
                {entity.code}
              </option>
            ))}
          </Select>
        </Label>
        <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-28">
          {t("history.year")}
          <Select name="year" defaultValue={year === null ? "all" : String(year)}>
            <option value="all">{t("filters.all")}</option>
            {[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </Select>
        </Label>
        <Button type="submit" variant="outline">
          {t("filters.apply")}
        </Button>
        <ExportButton action={exportHistoryAction} input={{ templateId, entityId, year, locale }} label={t("history.export")} failedLabel={t("history.exportFailed")} truncatedLabel={t("history.exportTruncated")} />
      </form>

      <p className="text-sm text-muted-foreground">{t("history.summary", { count: rows.length, late: lateCount })}</p>

      <Table className="min-w-[960px]">
        <TableHeader>
          <TableRow>
            <TableHead kind="org">{t("history.columns.entity")}</TableHead>
            <TableHead kind="text">{t("history.columns.obligation")}</TableHead>
            <TableHead kind="date">{t("history.columns.period")}</TableHead>
            <TableHead kind="date">{t("history.columns.dueDate")}</TableHead>
            <TableHead kind="status">{t("history.columns.status")}</TableHead>
            <TableHead kind="person">{t("history.columns.completedBy")}</TableHead>
            <TableHead kind="date">{t("history.columns.submittedDate")}</TableHead>
            <TableHead kind="id">{t("history.columns.reference")}</TableHead>
            <TableHead kind="money">{t("history.columns.amount")}</TableHead>
            <TableHead kind="file">{t("history.columns.files")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("history.empty")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.taskId}>
              <TableCell className="font-mono text-xs font-medium">
                <RecordLink kind="entity" id={row.entityId}>
                  {row.entityCode}
                </RecordLink>
              </TableCell>
              <TableCell className="whitespace-normal">
                <RecordLink kind="obligation" id={row.taskId} className="font-medium">
                  {row.templateName}
                </RecordLink>
                <p className="font-mono text-xs text-faint">{row.templateCode}</p>
              </TableCell>
              <TableCell>
                {row.periodKey.startsWith("event:") ? (
                  row.subjectName ? (
                    <RecordLink kind="person" id={row.subjectPersonId}>
                      {row.subjectName}
                    </RecordLink>
                  ) : (
                    t("instance.eventDriven")
                  )
                ) : (
                  periodLabel(row.periodKey)
                )}
              </TableCell>
              <TableCell kind="date">{day(row.dueDate)}</TableCell>
              <TableCell>
                <StatusBadge colour={row.colour} label={t(`enums.colour.${row.colour}`)} />
              </TableCell>
              <TableCell>
                {row.completedAt ? (
                  <>
                    {row.completedByName ? (
                      <RecordLink kind="person" id={row.completedByPersonId}>
                        {row.completedByName}
                      </RecordLink>
                    ) : (
                      t("instance.bySystem")
                    )}
                    <p className="text-xs text-faint">{format.dateTime(row.completedAt, { dateStyle: "medium" })}</p>
                  </>
                ) : (
                  <span className="text-muted-foreground">
                    {row.assigneeName ? (
                      <RecordLink kind="person" id={row.assigneePersonId}>
                        {row.assigneeName}
                      </RecordLink>
                    ) : (
                      t("unassigned")
                    )}
                  </span>
                )}
              </TableCell>
              <TableCell kind="date">{day(row.submittedDate)}</TableCell>
              <TableCell kind="id">{row.referenceNumber ?? "—"}</TableCell>
              <TableCell kind="money">{row.amountPaid === null ? "—" : format.number(row.amountPaid)}</TableCell>
              <TableCell className="text-xs">
                <EvidenceLinks files={row.files} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
}
