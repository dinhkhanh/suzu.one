import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportPortfolioAction } from "@/modules/projects/actions";
import { filterPortfolio, HEALTHS, listPortfolio, PORTFOLIO_GROUPS, type PortfolioFilters, type PortfolioGroup, type PortfolioRow, PROJECT_KINDS, showsFees, slipWords } from "@/modules/projects/service";
import { healthVariant } from "@/modules/projects/ui/project-header";
import { loadViewer } from "@/modules/work/service";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("projects");

const FILTERS = ["teamId", "clientId", "leadPersonId", "entityId", "kind", "health"] as const;

/**
 * The portfolio (FR-PJM-08): every project the viewer may open, with the plan's figures. Filters
 * and grouping live in the URL (a plain GET form), so a view can be shared as a link. The fee
 * column exists only when some project on the list shows its money to this viewer.
 */
export default async function PortfolioPage({ searchParams }: PageProps<"/projects">) {
  const user = await requireUser();
  const viewer = await loadViewer(user);
  const params = await searchParams;
  const today = todayInVietnam();
  const filters: PortfolioFilters = Object.fromEntries(FILTERS.flatMap((key) => (typeof params[key] === "string" && params[key] ? [[key, params[key]]] : [])));
  const group: PortfolioGroup = PORTFOLIO_GROUPS.includes(params.group as PortfolioGroup) ? (params.group as PortfolioGroup) : "none";

  const all = await listPortfolio(viewer, { today, includeDone: params.done === "1" });
  const rows = filterPortfolio(all, filters);
  const [t, tExports, format, locale] = await Promise.all([getTranslations("projects"), getTranslations("exports"), getFormatter(), getLocale()]);
  const withFees = showsFees(rows);

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
  const groups = [...Map.groupBy(rows, (row) => groupKey(row).join("\u0000")).entries()].map(([key, own]) => ({ label: key.split("\u0000")[1], rows: own })).sort((a, b) => a.label.localeCompare(b.label));
  const hours = (minutes: number | null) => (minutes === null ? "—" : format.number(minutes / 60, { maximumFractionDigits: 1 }));
  const date = (value: string | null) => (value ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit" }) : null);

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("portfolio.description")}</p>
        </div>
        <ExportButton action={exportPortfolioAction} input={{ ...filters, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />
      </header>

      <form method="get" className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        {FILTERS.map((key) => (
          <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t(`portfolio.filters.${key}`)}
            <Select name={key} defaultValue={filters[key] ?? ""} className="sm:w-44">
              <option value="">{t("portfolio.all")}</option>
              {options[key].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t("portfolio.groupBy")}
          <Select name="group" defaultValue={group} className="sm:w-40">
            {PORTFOLIO_GROUPS.map((key) => (
              <option key={key} value={key}>
                {t(`portfolio.groups.${key}`)}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-9 items-center gap-2 text-sm">
          <input type="checkbox" name="done" value="1" defaultChecked={params.done === "1"} /> {t("portfolio.includeDone")}
        </label>
        <div className="col-span-2 flex gap-2">
          <Button type="submit" size="sm">
            {t("portfolio.apply")}
          </Button>
          <Link href="/projects" className="inline-flex h-8 items-center px-2 text-sm text-muted-foreground underline">
            {t("portfolio.reset")}
          </Link>
        </div>
      </form>

      <p className="text-sm text-muted-foreground">{t("portfolio.count", { count: rows.length })}</p>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("portfolio.empty")}</p> : null}

      {groups.map(({ label, rows: own }) => (
        <section key={label || "all"} className="flex flex-col gap-2">
          {group !== "none" ? <h2 className="text-sm font-medium text-muted-foreground">{t("portfolio.groupHeading", { name: label, count: own.length })}</h2> : null}
          <ul className="flex flex-col divide-y rounded-xl border">
            {own.map((row) => (
              <li key={row.id} className="flex flex-col gap-2 p-3 sm:grid sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <Link href={`/projects/${row.id}`} className="truncate font-medium hover:underline">
                    {row.jobNumber ? <span className="mr-2 font-mono text-xs text-muted-foreground">{row.jobNumber}</span> : null}
                    {row.name}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">{[row.clientName ?? t("portfolio.noClient"), row.leadName, row.teamName, row.entityName].filter(Boolean).join(" · ")}</p>
                  <div className="flex flex-wrap gap-1">
                    <Badge variant="outline">{t(`kinds.${row.kind}`)}</Badge>
                    {row.briefStatus !== "approved" ? <Badge variant="secondary">{t(`brief.status.${row.briefStatus as "draft"}`)}</Badge> : null}
                    {row.health ? <Badge variant={healthVariant(row.health)}>{t(`health.${row.health}`)}</Badge> : null}
                    {row.stale ? <Badge variant="warning">{t("portfolio.stale")}</Badge> : null}
                    {row.raid.highRisks > 0 ? <Badge variant="destructive">{t("raid.portfolio.highRisksBadge", { count: row.raid.highRisks })}</Badge> : null}
                    {row.raid.openIssues > 0 ? <Badge variant="warning">{t("raid.portfolio.openIssuesBadge", { count: row.raid.openIssues })}</Badge> : null}
                  </div>
                </div>
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground">{t("fields.nextMilestone")}</span>
                  <span>{row.nextMilestone ? [row.nextMilestone.name, date(row.nextMilestone.dueDate)].filter(Boolean).join(" · ") : "—"}</span>
                  {row.phaseName ? <span className="text-muted-foreground">{t("portfolio.phase", { name: row.phaseName })}</span> : null}
                  {row.dueSlipDays ? <span className={row.dueSlipDays > 0 ? "text-destructive" : "text-muted-foreground"}>{t("plan.slip", slipWords(row.dueSlipDays))}</span> : null}
                </div>
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground">{t("portfolio.accepted")}</span>
                  <span>{row.register.promised ? t("portfolio.acceptedValue", { accepted: row.register.accepted, promised: row.register.promised, percent: row.register.percent ?? 0 }) : "—"}</span>
                </div>
                <div className="flex flex-col gap-0.5 text-xs">
                  <span className="text-muted-foreground">{t("portfolio.hours")}</span>
                  <span className={row.burn.level === "over" ? "text-destructive" : row.burn.level === "warning" ? "text-warning" : undefined}>{row.burn.budgetMinutes ? t("portfolio.hoursValue", { used: hours(row.burn.loggedMinutes), budget: hours(row.burn.budgetMinutes), percent: row.burn.percent ?? 0 }) : t("portfolio.hoursNoBudget", { used: hours(row.burn.loggedMinutes) })}</span>
                  {withFees ? <span className="text-muted-foreground">{"feeVnd" in row && row.feeVnd !== null && row.feeVnd !== undefined ? format.number(row.feeVnd, { style: "currency", currency: "VND", maximumFractionDigits: 0 }) : "—"}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
