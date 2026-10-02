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
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { canReadProfitability, type CostGroup, getProfitability, type ProjectLine } from "@/modules/reports/service";
import { RateBar } from "@/modules/reports/ui/bar";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("profitability");

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The last three whole months and this one so far: margins need more than a few weeks of time. */
function defaultPeriod(today: string): { from: string; to: string } {
  const start = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  start.setUTCMonth(start.getUTCMonth() - 3);
  return { from: start.toISOString().slice(0, 10), to: today };
}

/**
 * Profitability (FR-PJM-63): per project and per client, fee against the cost of the hours logged
 * at each person's loaded cost rate. `pjm:cost` only — everyone else gets a 404, not an empty page —
 * and a fresh step-up first, as every compensation screen asks (FR-PLT-06). The service writes the
 * read to the audit log. No figure on this page belongs to one person: costs are shown per
 * project, client, team and role, and a team or role of one person is folded into "other".
 */
export default async function ProfitabilityPage({ searchParams }: PageProps<"/reports/profitability">) {
  const user = await requireUser();
  if (!canReadProfitability(user.principal)) notFound();
  requireStepUp(user, "/reports/profitability");

  const params = await searchParams;
  const pick = (name: string, pattern: RegExp) => (typeof params[name] === "string" && pattern.test(params[name]) ? (params[name] as string) : undefined);
  const today = todayInVietnam();
  const fallback = defaultPeriod(today);
  const period = { from: pick("from", DAY) ?? fallback.from, to: pick("to", DAY) ?? fallback.to };
  if (period.from > period.to) period.from = period.to;
  const clientId = pick("client", UUID) ?? null;

  const [view, t, tExports, format, locale] = await Promise.all([
    getProfitability({ userId: user.userId, email: user.email, person: user.person, principal: user.principal, request: user.request }, { ...period, clientId }),
    getTranslations("reports.profitability"),
    getTranslations("exports"),
    getFormatter(),
    getLocale(),
  ]);
  if (!view) notFound();
  const money = (amount: number | null) => (amount === null ? "—" : format.number(amount, { style: "currency", currency: "VND", maximumFractionDigits: 0 }));
  const percent = (rate: number | null) => (rate === null ? "—" : format.number(rate, { style: "percent", maximumFractionDigits: 1 }));
  const decimal = (value: number) => format.number(value, { maximumFractionDigits: 1 });
  const tone = (margin: number | null) => (margin !== null && margin < 0 ? "text-destructive" : "");
  const groupLabel = (group: CostGroup) => (group.other ? t("otherGroup") : (group.name ?? t("noGroup")));

  const groups = (title: string, rows: CostGroup[]) => (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-xs font-medium text-muted-foreground">{title}</h3>
      <ul className="flex flex-col gap-0.5 text-xs">
        {rows.map((group, index) => (
          <li key={`${group.name}-${index}`} className="flex justify-between gap-3">
            <span>{groupLabel(group)}</span>
            <span className="tabular-nums">
              {decimal(group.hours)} h · {money(group.costVnd)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );

  const projectRow = (project: ProjectLine) => (
    <TableRow key={project.id}>
      <TableCell className="align-top whitespace-normal">
        <details>
          <summary className="cursor-pointer">
            <RecordLink kind="project" id={project.id} className="font-medium">
              {project.name}
            </RecordLink>
            <span className="ps-2 text-xs text-faint">
              {project.jobNumber}
              {project.jobNumber && project.clientName ? " · " : null}
              <RecordLink kind="account" id={project.clientId}>{project.clientName}</RecordLink>
            </span>
            {project.estimated ? (
              <Badge variant="warning" className="ms-2">
                {t("estimated")}
              </Badge>
            ) : null}
          </summary>
          <div className="grid gap-3 pt-2 sm:grid-cols-2">
            {groups(t("byTeam"), project.byTeam)}
            {groups(t("byRole"), project.byRole)}
          </div>
          {project.unratedHours > 0 ? <p className="pt-1 text-xs text-muted-foreground">{t("unrated", { hours: decimal(project.unratedHours) })}</p> : null}
        </details>
      </TableCell>
      <TableCell className="align-top">
        <Badge variant="outline">{t(`basis.${project.basis}`)}</Badge>
      </TableCell>
      <TableCell kind="time" className="align-top">{decimal(project.hours)}</TableCell>
      <TableCell kind="money" className="align-top">{money(project.feeVnd)}</TableCell>
      <TableCell kind="money" className="align-top">{money(project.costVnd)}</TableCell>
      <TableCell kind="money" className={`align-top ${tone(project.marginVnd)}`}>{money(project.marginVnd)}</TableCell>
      <TableCell kind="percent" className={`align-top ${tone(project.marginVnd)}`}>
        <RateBar rate={project.marginRate} label={percent(project.marginRate)} tone={project.marginVnd !== null && project.marginVnd < 0 ? "destructive" : undefined} />
      </TableCell>
    </TableRow>
  );

  const head = (
    <TableRow>
      <TableHead kind="text">{t("columns.name")}</TableHead>
      <TableHead kind="select">{t("columns.basis")}</TableHead>
      <TableHead kind="time">{t("columns.hours")}</TableHead>
      <TableHead kind="money">{t("columns.fee")}</TableHead>
      <TableHead kind="money">{t("columns.cost")}</TableHead>
      <TableHead kind="money">{t("columns.margin")}</TableHead>
      <TableHead kind="percent">{t("columns.marginRate")}</TableHead>
    </TableRow>
  );

  return (
    <Page width="wide">
      <PageHeader
        eyebrow={<Link href="/reports">{t("back")}</Link>}
        title={t("title")}
        description={t("description")}
        actions={<ExportButton action={exportReportAction} input={{ reportKey: "profitability", parameters: clientId ? { clientId } : {}, from: period.from, to: period.to, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />}
      />

      <form className="toolbar">
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("from")}
          <DatePicker name="from" defaultValue={period.from} className="w-auto" />
        </Label>
        <Label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("to")}
          <DatePicker name="to" defaultValue={period.to} className="w-auto" />
        </Label>
        {view.clientsOffered.length > 0 ? (
          <Label className="flex w-full flex-col gap-1 text-xs text-muted-foreground sm:w-56">
            {t("client")}
            <Select name="client" defaultValue={clientId ?? ""}>
              <option value="">{t("allClients")}</option>
              {view.clientsOffered.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </Label>
        ) : null}
        <Button type="submit" variant="outline">
          {t("apply")}
        </Button>
      </form>

      <TileGrid>
        <Tile label={t("columns.fee")} value={money(view.total.feeVnd)} />
        <Tile label={t("columns.cost")} value={money(view.total.costVnd)} />
        <Tile label={t("columns.margin")} value={money(view.total.marginVnd)} tone={view.total.marginVnd !== null && view.total.marginVnd < 0 ? "destructive" : undefined} />
        <Tile label={t("columns.marginRate")} value={percent(view.total.marginRate)} tone={view.total.marginVnd !== null && view.total.marginVnd < 0 ? "destructive" : undefined} />
      </TileGrid>

      <TableCard>
        <TableCardHeader title={t("byProject")} />
        <Table numbered={false}>
          <TableHeader>{head}</TableHeader>
          <TableBody>
            {view.projects.length === 0 && !view.privateProjects ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {view.projects.map(projectRow)}
            {view.privateProjects ? (
              <TableRow>
                <TableCell className="text-muted-foreground">{t("privateProjects", { count: view.privateProjects.projects })}</TableCell>
                <TableCell />
                <TableCell kind="time">{decimal(view.privateProjects.hours)}</TableCell>
                <TableCell kind="money">{money(view.privateProjects.feeVnd)}</TableCell>
                <TableCell kind="money">{money(view.privateProjects.costVnd)}</TableCell>
                <TableCell kind="money" className={tone(view.privateProjects.marginVnd)}>{money(view.privateProjects.marginVnd)}</TableCell>
                <TableCell kind="percent" className={tone(view.privateProjects.marginVnd)}>{percent(view.privateProjects.marginRate)}</TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableCard>

      {view.projects.length === 0 && !view.privateProjects ? null : (
        <TableCard>
          <TableCardHeader title={t("byClient")} />
          <Table numbered={false}>
            <TableHeader>
              <TableRow>
                <TableHead kind="org">{t("client")}</TableHead>
                <TableHead kind="number">{t("columns.projects")}</TableHead>
                <TableHead kind="time">{t("columns.hours")}</TableHead>
                <TableHead kind="money">{t("columns.fee")}</TableHead>
                <TableHead kind="money">{t("columns.cost")}</TableHead>
                <TableHead kind="money">{t("columns.margin")}</TableHead>
                <TableHead kind="percent">{t("columns.marginRate")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.clients.map((client) => (
                <TableRow key={client.clientId ?? "none"}>
                  <TableCell>
                    {client.clientName ? <RecordLink kind="account" id={client.clientId}>{client.clientName}</RecordLink> : t("noClient")}
                    {client.estimated ? (
                      <Badge variant="warning" className="ms-2">
                        {t("estimated")}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell kind="number">{client.projects}</TableCell>
                  <TableCell kind="time">{decimal(client.hours)}</TableCell>
                  <TableCell kind="money">{money(client.feeVnd)}</TableCell>
                  <TableCell kind="money">{money(client.costVnd)}</TableCell>
                  <TableCell kind="money" className={tone(client.marginVnd)}>{money(client.marginVnd)}</TableCell>
                  <TableCell kind="percent" className={tone(client.marginVnd)}>
                    <RateBar rate={client.marginRate} label={percent(client.marginRate)} tone={client.marginVnd !== null && client.marginVnd < 0 ? "destructive" : undefined} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{t("hintCost")}</p>
        <p>{t("hintEstimated")}</p>
        <p>{t("hintPrivacy")}</p>
      </div>
    </Page>
  );
}
