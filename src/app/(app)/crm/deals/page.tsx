import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Segmented } from "@/components/ui/segmented";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { addDays, todayInVietnam } from "@/lib/dates";
import { pageTitle } from "@/i18n/page-title";
import { requireUser } from "@/modules/platform/auth/session";
import { listTeams } from "@/modules/work/service";
import { crmSettings, forecast, isStaleDeal, listDeals, listStages, pipelineTotals, SERVICE_LINES, type ServiceLine, stageName } from "@/modules/crm/service";
import { crmShell } from "@/modules/crm/pages";
import { type BoardColumn, DealBoard } from "@/modules/crm/ui/board";
import { CrmTabs } from "@/modules/crm/ui/tabs";
import { formatters } from "@/modules/crm/ui/views";

export const generateMetadata = pageTitle("crmDeals");

const VIEWS = ["board", "list", "forecast"] as const;

export default async function DealsPage({ searchParams }: PageProps<"/crm/deals">) {
  const user = await requireUser();
  const shell = await crmShell(user);
  if (!shell.show.deals) notFound();
  const params = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" && value ? value : undefined);
  const view = (VIEWS as readonly string[]).includes(one(params.view) ?? "") ? (one(params.view) as (typeof VIEWS)[number]) : "board";
  const mine = one(params.mine) === "1";
  const teamId = one(params.team) ?? null;
  const serviceLine = (SERVICE_LINES as readonly string[]).includes(one(params.service) ?? "") ? (one(params.service) as ServiceLine) : null;
  const status = (["open", "won", "lost", "all"] as const).find((value) => value === one(params.status)) ?? (view === "list" ? "open" : "all");
  const q = one(params.q) ?? null;
  const today = todayInVietnam();
  const [t, f, locale, stages, teams, deals, settings] = await Promise.all([getTranslations("crm"), formatters(), getLocale(), listStages(), listTeams(), listDeals(shell.viewer, { mine, teamId, serviceLine, status, q }), crmSettings(today)]);
  const recent = addDays(today, -30);
  const params_ = (patch: Record<string, string>) => {
    const next = new URLSearchParams(Object.entries({ view, ...(mine ? { mine: "1" } : {}), ...(teamId ? { team: teamId } : {}), ...(serviceLine ? { service: serviceLine } : {}), ...patch }).filter(([, value]) => value) as [string, string][]);
    return `/crm/deals?${next.toString()}`;
  };

  const boardDeals = deals.filter((deal) => deal.status === "open" || (deal.wonAt ?? deal.lostAt ?? new Date(0)).toISOString().slice(0, 10) >= recent);
  const totals = pipelineTotals(boardDeals);
  const columns: BoardColumn[] = stages
    .filter((stage) => stage.isActive)
    .map((stage) => {
      const total = totals.get(stage.id) ?? { count: 0, valued: 0, totalVnd: 0, weightedVnd: 0 };
      return {
        id: stage.id,
        name: stageName(stage, locale),
        category: stage.category,
        ...total,
        cards: boardDeals
          .filter((deal) => deal.stageId === stage.id)
          .map((deal) => ({ id: deal.id, code: deal.code, title: deal.title, accountName: deal.accountName, ownerName: deal.ownerName, expectedCloseOn: deal.expectedCloseOn, stale: deal.status === "open" && isStaleDeal({ lastTouchedOn: deal.lastTouchedOn }, today, settings.staleDealDays), value: deal.value ? { totalVnd: deal.value.totalVnd, weightedVnd: deal.value.weightedVnd } : null, canMove: deal.canEdit })),
      };
    });
  const months = view === "forecast" ? await forecast(shell.viewer, { teamId, ownerId: mine ? user.person.id : null }, today) : [];

  return (
    <Page width="wide">
      <PageHeader title={t("deals.title")} description={t("deals.intro")} />
      <CrmTabs current="deals" show={shell.show} />
      <form method="get" className="toolbar">
        <input type="hidden" name="view" value={view} />
        <Segmented aria-label={t("deals.views")} value={view} options={VIEWS.map((value) => ({ value, label: t(`deals.view.${value}`), href: params_({ view: value }) }))} />
        {view === "list" ? <Input name="q" defaultValue={q ?? ""} placeholder={t("deals.search")} aria-label={t("deals.search")} className="w-full sm:w-48" /> : null}
        <Select name="team" defaultValue={teamId ?? ""} aria-label={t("deal.fields.team")} className="w-full sm:w-44">
          <option value="">{t("deals.anyTeam")}</option>
          {teams
            .filter((team) => team.isActive)
            .map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
        </Select>
        <Select name="service" defaultValue={serviceLine ?? ""} aria-label={t("deal.fields.serviceLines")} className="w-full sm:w-44">
          <option value="">{t("deals.anyService")}</option>
          {SERVICE_LINES.map((line) => (
            <option key={line} value={line}>
              {t(`enums.serviceLine.${line}`)}
            </option>
          ))}
        </Select>
        {view === "list" ? (
          <Select name="status" defaultValue={status} aria-label={t("deals.status")} className="w-full sm:w-40">
            {(["open", "won", "lost", "all"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`deals.statuses.${value}`)}
              </option>
            ))}
          </Select>
        ) : null}
        <Label className="flex h-10 items-center gap-2 text-sm md:h-9">
          <Checkbox name="mine" value="1" defaultChecked={mine} /> {t("deals.mine")}
        </Label>
        <Button type="submit" variant="outline">
          {t("filter")}
        </Button>
      </form>

      {view === "board" ? <DealBoard columns={columns} /> : null}

      {view === "list" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="text">{t("deals.columns.deal")}</TableHead>
              <TableHead kind="org">{t("deals.columns.account")}</TableHead>
              <TableHead kind="status">{t("deals.columns.stage")}</TableHead>
              <TableHead kind="person">{t("deals.columns.owner")}</TableHead>
              <TableHead kind="date">{t("deals.columns.close")}</TableHead>
              <TableHead kind="money">{t("deals.columns.value")}</TableHead>
              <TableHead kind="money">{t("deals.columns.weighted")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {deals.length === 0 ? <TableEmpty>{t("deals.empty")}</TableEmpty> : null}
            {deals.map((deal) => (
              <TableRow key={deal.id}>
                <TableCell>
                  <RecordLink kind="deal" id={deal.id} className="font-medium">
                    {deal.title}
                  </RecordLink>
                  <p className="font-mono text-xs text-faint">{deal.code}</p>
                </TableCell>
                <TableCell>
                  <RecordLink kind="account" id={deal.clientId}>{deal.accountName}</RecordLink>
                </TableCell>
                <TableCell>
                  <Badge dot variant={deal.status === "won" ? "success" : deal.status === "lost" ? "secondary" : "info"}>
                    {stageName(deal.stage, locale)}
                  </Badge>
                </TableCell>
                <TableCell>
                  <RecordLink kind="person" id={deal.ownerPersonId}>{deal.ownerName}</RecordLink>
                </TableCell>
                <TableCell kind="date">{f.date(deal.expectedCloseOn)}</TableCell>
                <TableCell kind="money">{deal.value ? f.money(deal.value.totalVnd) : "—"}</TableCell>
                <TableCell kind="money">{deal.value && deal.status === "open" ? f.money(deal.value.weightedVnd) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}

      {view === "forecast" ? (
        <Table numbered={false}>
          <TableHeader>
            <TableRow>
              <TableHead kind="date">{t("deals.columns.closeMonth")}</TableHead>
              <TableHead kind="number">{t("deals.columns.count")}</TableHead>
              <TableHead kind="money">{t("deals.columns.value")}</TableHead>
              <TableHead kind="money">{t("deals.columns.weighted")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.length === 0 ? <TableEmpty>{t("deals.noForecast")}</TableEmpty> : null}
            {months.map((row) => (
              <TableRow key={row.month}>
                <TableCell className={row.month === "none" ? undefined : "font-mono text-[0.8125rem] tabular-nums"}>{row.month === "none" ? t("deals.undatedOrLate") : row.month}</TableCell>
                <TableCell kind="number">{row.count}</TableCell>
                <TableCell kind="money">{f.money(row.value)}</TableCell>
                <TableCell kind="money">{f.money(row.weighted)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </Page>
  );
}
