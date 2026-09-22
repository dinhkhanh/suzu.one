import type { Metadata } from "next";
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { exportReportAction } from "@/modules/reports/actions";
import { canReadProfitability, type CostGroup, getProfitability, type ProjectLine } from "@/modules/reports/service";

export const metadata: Metadata = { title: "Profitability" };

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
      <TableCell className="align-top">
        <details>
          <summary className="cursor-pointer">
            <span className="font-medium">{project.name}</span>
            <span className="ps-2 text-xs text-muted-foreground">{[project.jobNumber, project.clientName].filter(Boolean).join(" · ")}</span>
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
      <TableCell className="align-top text-xs text-muted-foreground">{t(`basis.${project.basis}`)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{decimal(project.hours)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{money(project.feeVnd)}</TableCell>
      <TableCell className="text-right align-top tabular-nums">{money(project.costVnd)}</TableCell>
      <TableCell className={`text-right align-top tabular-nums ${tone(project.marginVnd)}`}>{money(project.marginVnd)}</TableCell>
      <TableCell className={`text-right align-top tabular-nums ${tone(project.marginVnd)}`}>{percent(project.marginRate)}</TableCell>
    </TableRow>
  );

  const head = (
    <TableRow>
      <TableHead>{t("columns.name")}</TableHead>
      <TableHead>{t("columns.basis")}</TableHead>
      <TableHead className="text-right">{t("columns.hours")}</TableHead>
      <TableHead className="text-right">{t("columns.fee")}</TableHead>
      <TableHead className="text-right">{t("columns.cost")}</TableHead>
      <TableHead className="text-right">{t("columns.margin")}</TableHead>
      <TableHead className="text-right">{t("columns.marginRate")}</TableHead>
    </TableRow>
  );

  return (
    <div className="flex max-w-6xl flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm text-muted-foreground">
            <Link href="/reports" className="underline underline-offset-4">
              {t("back")}
            </Link>
          </p>
          <h1>{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <ExportButton action={exportReportAction} input={{ reportKey: "profitability", parameters: clientId ? { clientId } : {}, from: period.from, to: period.to, locale }} label={tExports("button")} failedLabel={tExports("failed")} truncatedLabel={tExports("truncated")} />
      </header>

      <form className="flex flex-wrap items-end gap-3 text-sm">
        <label className="flex flex-col gap-1">
          {t("from")}
          <Input type="date" name="from" defaultValue={period.from} className="w-auto" />
        </label>
        <label className="flex flex-col gap-1">
          {t("to")}
          <Input type="date" name="to" defaultValue={period.to} className="w-auto" />
        </label>
        {view.clientsOffered.length > 0 ? (
          <label className="flex flex-col gap-1">
            {t("client")}
            <Select name="client" defaultValue={clientId ?? ""} className="w-auto">
              <option value="">{t("allClients")}</option>
              {view.clientsOffered.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Button type="submit" variant="secondary">
          {t("apply")}
        </Button>
      </form>

      <section className="grid gap-3 rounded-xl border p-4 text-sm sm:grid-cols-4">
        <div className="flex flex-col">
          <span className="text-muted-foreground">{t("columns.fee")}</span>
          <span className="text-lg font-semibold tabular-nums">{money(view.total.feeVnd)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">{t("columns.cost")}</span>
          <span className="text-lg font-semibold tabular-nums">{money(view.total.costVnd)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">{t("columns.margin")}</span>
          <span className={`text-lg font-semibold tabular-nums ${tone(view.total.marginVnd)}`}>{money(view.total.marginVnd)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-muted-foreground">{t("columns.marginRate")}</span>
          <span className={`text-lg font-semibold tabular-nums ${tone(view.total.marginVnd)}`}>{percent(view.total.marginRate)}</span>
        </div>
      </section>

      {view.projects.length === 0 && !view.privateProjects ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">{t("byProject")}</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>{head}</TableHeader>
                <TableBody>
                  {view.projects.map(projectRow)}
                  {view.privateProjects ? (
                    <TableRow>
                      <TableCell className="text-muted-foreground">{t("privateProjects", { count: view.privateProjects.projects })}</TableCell>
                      <TableCell />
                      <TableCell className="text-right tabular-nums">{decimal(view.privateProjects.hours)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(view.privateProjects.feeVnd)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(view.privateProjects.costVnd)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${tone(view.privateProjects.marginVnd)}`}>{money(view.privateProjects.marginVnd)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${tone(view.privateProjects.marginVnd)}`}>{percent(view.privateProjects.marginRate)}</TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className="text-base font-medium">{t("byClient")}</h2>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("client")}</TableHead>
                    <TableHead className="text-right">{t("columns.projects")}</TableHead>
                    <TableHead className="text-right">{t("columns.hours")}</TableHead>
                    <TableHead className="text-right">{t("columns.fee")}</TableHead>
                    <TableHead className="text-right">{t("columns.cost")}</TableHead>
                    <TableHead className="text-right">{t("columns.margin")}</TableHead>
                    <TableHead className="text-right">{t("columns.marginRate")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {view.clients.map((client) => (
                    <TableRow key={client.clientId ?? "none"}>
                      <TableCell>
                        {client.clientName ?? t("noClient")}
                        {client.estimated ? (
                          <Badge variant="warning" className="ms-2">
                            {t("estimated")}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{client.projects}</TableCell>
                      <TableCell className="text-right tabular-nums">{decimal(client.hours)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(client.feeVnd)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(client.costVnd)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${tone(client.marginVnd)}`}>{money(client.marginVnd)}</TableCell>
                      <TableCell className={`text-right tabular-nums ${tone(client.marginVnd)}`}>{percent(client.marginRate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>
        </>
      )}

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <p>{t("hintCost")}</p>
        <p>{t("hintEstimated")}</p>
        <p>{t("hintPrivacy")}</p>
      </div>
    </div>
  );
}
