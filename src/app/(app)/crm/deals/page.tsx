import { getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="flex max-w-7xl flex-col gap-6">
      <header>
        <h1>{t("deals.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("deals.intro")}</p>
      </header>
      <CrmTabs current="deals" show={shell.show} />
      <nav className="flex flex-wrap gap-2 text-sm" aria-label={t("deals.views")}>
        {VIEWS.map((value) => (
          <Link key={value} href={params_({ view: value })} aria-current={value === view ? "page" : undefined} className={`rounded-md border px-3 py-1 ${value === view ? "bg-muted font-medium" : "text-muted-foreground"}`}>
            {t(`deals.view.${value}`)}
          </Link>
        ))}
      </nav>
      <form method="get" className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="view" value={view} />
        {view === "list" ? <Input name="q" defaultValue={q ?? ""} placeholder={t("deals.search")} aria-label={t("deals.search")} className="w-48" /> : null}
        <Select name="team" defaultValue={teamId ?? ""} aria-label={t("deal.fields.team")}>
          <option value="">{t("deals.anyTeam")}</option>
          {teams
            .filter((team) => team.isActive)
            .map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
        </Select>
        <Select name="service" defaultValue={serviceLine ?? ""} aria-label={t("deal.fields.serviceLines")}>
          <option value="">{t("deals.anyService")}</option>
          {SERVICE_LINES.map((line) => (
            <option key={line} value={line}>
              {t(`enums.serviceLine.${line}`)}
            </option>
          ))}
        </Select>
        {view === "list" ? (
          <Select name="status" defaultValue={status} aria-label={t("deals.status")}>
            {(["open", "won", "lost", "all"] as const).map((value) => (
              <option key={value} value={value}>
                {t(`deals.statuses.${value}`)}
              </option>
            ))}
          </Select>
        ) : null}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="mine" value="1" defaultChecked={mine} /> {t("deals.mine")}
        </label>
        <Button type="submit" size="sm" variant="outline">
          {t("filter")}
        </Button>
      </form>

      {view === "board" ? <DealBoard columns={columns} /> : null}

      {view === "list" ? (
        deals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("deals.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("deals.columns.deal")}</TableHead>
                <TableHead>{t("deals.columns.account")}</TableHead>
                <TableHead>{t("deals.columns.stage")}</TableHead>
                <TableHead>{t("deals.columns.owner")}</TableHead>
                <TableHead>{t("deals.columns.close")}</TableHead>
                <TableHead className="text-right">{t("deals.columns.value")}</TableHead>
                <TableHead className="text-right">{t("deals.columns.weighted")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deals.map((deal) => (
                <TableRow key={deal.id}>
                  <TableCell>
                    <Link href={`/crm/deals/${deal.id}`} className="font-medium hover:underline">
                      {deal.title}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">{deal.code}</p>
                  </TableCell>
                  <TableCell>{deal.accountName}</TableCell>
                  <TableCell>
                    <Badge dot variant={deal.status === "won" ? "success" : deal.status === "lost" ? "secondary" : "info"}>
                      {stageName(deal.stage, locale)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{deal.ownerName}</TableCell>
                  <TableCell className="text-sm">{f.date(deal.expectedCloseOn)}</TableCell>
                  <TableCell className="text-right tabular-nums">{deal.value ? f.money(deal.value.totalVnd) : "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{deal.value && deal.status === "open" ? f.money(deal.value.weightedVnd) : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}

      {view === "forecast" ? (
        months.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("deals.noForecast")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("deals.columns.closeMonth")}</TableHead>
                <TableHead className="text-right">{t("deals.columns.count")}</TableHead>
                <TableHead className="text-right">{t("deals.columns.value")}</TableHead>
                <TableHead className="text-right">{t("deals.columns.weighted")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {months.map((row) => (
                <TableRow key={row.month}>
                  <TableCell>{row.month === "none" ? t("deals.undatedOrLate") : row.month}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(row.value)}</TableCell>
                  <TableCell className="text-right tabular-nums">{f.money(row.weighted)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )
      ) : null}
    </div>
  );
}
