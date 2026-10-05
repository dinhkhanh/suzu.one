import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Select } from "@/components/ui/select";
import { statusTone } from "@/components/ui/tone";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { listPersonNames } from "@/modules/platform/people/service";
import { exportPortfolioAction } from "@/modules/projects/actions";
import { filterPortfolio, HEALTHS, listPortfolio, PORTFOLIO_GROUPS, type PortfolioFilters, type PortfolioGroup, type PortfolioRow, PROJECT_KINDS, showsFees, slipWords } from "@/modules/projects/service";
import { ProgressBar } from "@/modules/projects/ui/progress";
import { healthVariant, ProjectMark } from "@/modules/projects/ui/project-header";
import { listClients, listCreateTargets, loadViewer } from "@/modules/work/service";
import { CreateProjectButton } from "@/modules/work/ui/edit-dialogs";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projects");

const FILTERS = ["teamId", "clientId", "leadPersonId", "entityId", "kind", "health"] as const;

/**
 * The portfolio (FR-PJM-08): every project the viewer may open, as a card each with the plan's
 * figures. Filters and grouping live in the URL (a plain GET form), so a view can be shared as a
 * link. The fee shows only on the projects whose money this viewer may see.
 */
export default async function PortfolioPage({ searchParams }: PageProps<"/projects">) {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const params = await searchParams;
  const today = todayInVietnam();
  const filters: PortfolioFilters = Object.fromEntries(FILTERS.flatMap((key) => (typeof params[key] === "string" && params[key] ? [[key, params[key]]] : [])));
  const group: PortfolioGroup = PORTFOLIO_GROUPS.includes(params.group as PortfolioGroup) ? (params.group as PortfolioGroup) : "none";

  const [all, targets] = await Promise.all([listPortfolio(viewer, { today, includeDone: params.done === "1" }), listCreateTargets(viewer)]);
  const rows = filterPortfolio(all, filters);
  const [t, tWork, tExports, format, locale] = await Promise.all([getTranslations("projects"), getTranslations("work"), getTranslations("exports"), getFormatter(), getLocale()]);
  const withFees = showsFees(rows);
  // Starting a project: the same dialog as the work page, for whoever may start one in some team.
  const projectTeams = targets.teams.filter((team) => team.canCreateProject);
  const [clients, people] = projectTeams.length ? await Promise.all([listClients({ activeOnly: true }), listPersonNames()]) : [[], []];

  const distinct = (pick: (row: PortfolioRow) => [string | null, string | null]) => [...new Map(all.flatMap((row) => { const [id, name] = pick(row); return id && name ? [[id, name] as const] : []; })).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const options = {
    teamId: distinct((row) => [row.teamId, row.teamName]),
    clientId: distinct((row) => [row.clientId, row.clientName]),
    leadPersonId: distinct((row) => [row.leadPersonId, row.leadName]),
    entityId: distinct((row) => [row.entityId, row.entityName]),
    kind: PROJECT_KINDS.map((kind) => [kind, t(`kinds.${kind}`)] as const),
    health: [...HEALTHS.map((health) => [health, t(`health.${health}`)] as const), ["stale", t("portfolio.stale")] as const, ["none", t("portfolio.noHealth")] as const],
  };

  const groupKey = (row: PortfolioRow): [string, string] => {
    switch (group) {
      case "team":
        return [row.teamId, row.teamName];
      case "client":
        return [row.clientId ?? "", row.clientName ?? t("portfolio.noClient")];
      case "lead":
        return [row.leadPersonId ?? "", row.leadName ?? "—"];
      case "entity":
        return [row.entityId ?? "", row.entityName ?? t("portfolio.group")];
      case "kind":
        return [row.kind, t(`kinds.${row.kind}`)];
      case "health":
        return [row.health ?? "", row.health ? t(`health.${row.health}`) : t("portfolio.noHealth")];
      default:
        return ["", ""];
    }
  };
  // A group named after a record (a team, a client, a lead, an entity) links to it.
  const groupKind = group === "team" ? "team" : group === "client" ? "account" : group === "lead" ? "person" : group === "entity" ? "entity" : null;
  const groups = [...Map.groupBy(rows, (row) => groupKey(row).join("\u0000")).entries()].map(([key, own]) => ({ id: key.split("\u0000")[0], label: key.split("\u0000")[1], rows: own })).sort((a, b) => a.label.localeCompare(b.label));
  const hours = (minutes: number | null) => (minutes === null ? "—" : format.number(minutes / 60, { maximumFractionDigits: 1 }));
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit" }) : null);

  const card = (row: PortfolioRow) => {
    const meta = [row.teamName, row.clientName ?? t("portfolio.noClient"), row.leadName].filter(Boolean).join(" · ");
    const burnTone = row.burn.level === "over" ? "text-destructive" : row.burn.level === "warning" ? "text-warning" : "text-muted-foreground";
    return (
      <Link key={row.id} href={`/projects/${row.id}`} className="press group/project block min-w-0 rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
        <Card className="h-full transition-colors duration-100 group-hover/project:bg-canvas">
          <CardContent className="flex h-full flex-col gap-3">
            <div className="flex items-start gap-3">
              <ProjectMark project={{ id: row.id, name: row.name }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[0.9375rem] font-semibold tracking-[-0.01em]">{row.name}</p>
                <p className="truncate text-xs text-muted-foreground">{meta}</p>
              </div>
              {row.jobNumber ? <span className="shrink-0 font-mono text-xs text-faint tabular-nums">{row.jobNumber}</span> : null}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge dot variant={statusTone(row.status)}>{row.statusName ?? tWork(`projects.status.${row.status as "active"}`)}</Badge>
              <Badge variant="outline">{t(`kinds.${row.kind}`)}</Badge>
              {row.briefStatus !== "approved" ? <Badge variant="secondary">{t(`brief.status.${row.briefStatus as "draft"}`)}</Badge> : null}
              {row.health ? <Badge variant={healthVariant(row.health)}>{t(`health.${row.health}`)}</Badge> : null}
              {row.stale ? <Badge variant="warning">{t("portfolio.stale")}</Badge> : null}
              {row.raid.highRisks > 0 ? <Badge variant="destructive">{t("raid.portfolio.highRisksBadge", { count: row.raid.highRisks })}</Badge> : null}
              {row.raid.openIssues > 0 ? <Badge variant="warning">{t("raid.portfolio.openIssuesBadge", { count: row.raid.openIssues })}</Badge> : null}
            </div>
            <div className="mt-auto flex flex-col gap-1.5">
              <ProgressBar percent={row.register.promised ? (row.register.percent ?? 0) : null} tone="success" />
              <div className="flex items-baseline justify-between gap-3 font-mono text-xs tabular-nums">
                <span>{row.register.promised ? t("portfolio.cardProgress", { accepted: row.register.accepted, promised: row.register.promised, percent: row.register.percent ?? 0 }) : <span className="text-faint">{t("portfolio.noRegister")}</span>}</span>
                <span className={burnTone}>{row.burn.budgetMinutes ? t("portfolio.cardHours", { used: hours(row.burn.loggedMinutes), budget: hours(row.burn.budgetMinutes) }) : t("portfolio.cardHoursNoBudget", { used: hours(row.burn.loggedMinutes) })}</span>
              </div>
            </div>
            <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-muted-foreground">
              {row.nextMilestone ? (
                <>
                  <span className="truncate">{row.nextMilestone.name}</span>
                  {row.nextMilestone.dueDate ? <span className="font-mono tabular-nums">{date(row.nextMilestone.dueDate)}</span> : null}
                </>
              ) : (
                <span className="text-faint">{t("portfolio.noMilestone")}</span>
              )}
              {row.dueSlipDays ? <span className={row.dueSlipDays > 0 ? "text-destructive" : undefined}>{t("plan.slip", slipWords(row.dueSlipDays))}</span> : null}
              {withFees && "feeVnd" in row && row.feeVnd !== null && row.feeVnd !== undefined ? <span className="ml-auto font-mono tabular-nums">{format.number(row.feeVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 })}</span> : null}
            </p>
          </CardContent>
        </Card>
      </Link>
    );
  };
  const grid = (own: PortfolioRow[]) => <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">{own.map(card)}</div>;

  return (
    <Page width="wide">
      <PageHeader
        title={t("title")}
        description={t("portfolio.description")}
        actions={
          <>
            <ExportButton action={exportPortfolioAction} input={{ ...filters, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />
            {projectTeams.length ? <CreateProjectButton teams={projectTeams.map((team) => ({ id: team.id, name: team.name, defaultVisibility: team.defaultVisibility }))} clients={clients.map(({ id, name }) => ({ id, name }))} people={people} /> : null}
          </>
        }
      />

      <form method="get" className="toolbar">
        {FILTERS.map((key) => (
          <label key={key} className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
            {t(`portfolio.filters.${key}`)}
            <Select name={key} defaultValue={filters[key] ?? ""} className="md:w-40">
              <option value="">{t("portfolio.all")}</option>
              {options[key].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        ))}
        <label className="flex min-w-0 flex-col gap-1 text-xs text-muted-foreground max-md:w-[calc(50%-0.25rem)]">
          {t("portfolio.groupBy")}
          <Select name="group" defaultValue={group} className="md:w-36">
            {PORTFOLIO_GROUPS.map((key) => (
              <option key={key} value={key}>
                {t(`portfolio.groups.${key}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex h-10 items-center gap-2 text-sm md:h-9">
          <Checkbox name="done" value="1" defaultChecked={params.done === "1"} />
          {t("portfolio.includeDone")}
        </label>
        <div className="flex items-center gap-1 max-md:w-full">
          <Button type="submit" variant="outline">
            {t("portfolio.apply")}
          </Button>
          <Button nativeButton={false} variant="ghost" render={<Link href="/projects" />}>
            {t("portfolio.reset")}
          </Button>
        </div>
      </form>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("portfolio.empty")}</CardContent>
        </Card>
      ) : group === "none" ? (
        <Section title={t("portfolio.count", { count: rows.length })}>{grid(rows)}</Section>
      ) : (
        groups.map(({ id, label, rows: own }) => (
          <Section key={label || "all"} title={groupKind ? <RecordLink kind={groupKind} id={id}>{label}</RecordLink> : label} count={own.length}>
            {grid(own)}
          </Section>
        ))
      )}
    </Page>
  );
}
