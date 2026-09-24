import { getFormatter, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { todayInVietnam } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { getUtilisation, type Utilisation, type UtilisationGroup, type UtilisationPerson } from "@/modules/daily/service";
import { exportUtilisationAction } from "@/modules/daily/time-actions";
import { hoursOf, percentOf } from "@/modules/daily/ui/format";
import { requireUser } from "@/modules/platform/auth/session";
import { ExportButton } from "@/modules/platform/export/ui/export-button";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("utilisation");

// FR-PJM-61: logged ÷ available hours for the last eight weeks — each lead's teams, each line
// manager's reports, person by person with team totals; teams seen through `work:manage` only as
// totals. No ranking: people are listed by name.
export default async function UtilisationPage() {
  const user = await requireUser();
  const today = todayInVietnam();
  const [t, format, view] = await Promise.all([getTranslations("daily.utilisation"), getFormatter(), getUtilisation({ personId: user.person.id, principal: user.principal }, today)]);
  const weekLabel = (iso: string) => format.dateTime(new Date(`${iso}T12:00:00Z`), { day: "numeric", month: "numeric" });

  const cell = (value: Utilisation, strong = false) => {
    const ratio = percentOf(value.ratio);
    const billable = percentOf(value.billableRatio);
    return (
      <td className={cn("px-2 py-1.5 text-right align-top", strong && "font-medium")} title={t("cellTitle", { logged: hoursOf(value.logged), available: hoursOf(value.available) })}>
        <span className={cn("block tabular-nums", value.ratio !== null && value.ratio > 1.1 && "text-warning", value.ratio === null && "text-faint")}>{ratio === null ? "—" : t("ratio", { value: ratio })}</span>
        <span className="block text-xs text-muted-foreground tabular-nums">{t("hoursOf", { logged: hoursOf(value.logged), available: hoursOf(value.available) })}</span>
        {billable !== null ? <span className="block text-xs text-muted-foreground tabular-nums">{t("billableRatio", { value: billable })}</span> : null}
      </td>
    );
  };

  const table = (group: UtilisationGroup) => (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-xs text-muted-foreground">
          <tr className="border-b">
            <th className="min-w-40 px-3 py-2 text-left font-medium">{t("person")}</th>
            {view.weeks.map((week) => (
              <th key={week} className="min-w-20 px-2 py-2 text-right font-medium">
                {weekLabel(week)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {group.kind !== "team" && group.kind !== "reports"
            ? null
            : group.people.map((person: UtilisationPerson) => (
                <tr key={person.personId} className="border-b">
                  <td className="px-3 py-1.5 align-top">{person.name}</td>
                  {person.weeks.map((value, index) => (
                    <Fragment key={view.weeks[index]}>{cell(value)}</Fragment>
                  ))}
                </tr>
              ))}
          <tr className="bg-muted/20">
            <td className="px-3 py-1.5 align-top font-medium">{group.kind === "portfolio" || group.kind === "portfolio_other" ? t("headcount", { count: group.headcount }) : t("teamTotal")}</td>
            {group.total.map((value, index) => (
              <Fragment key={view.weeks[index]}>{cell(value, true)}</Fragment>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1">{t("title")}</h1>
          {view.groups.length > 0 ? <ExportButton action={exportUtilisationAction} input={{}} label={t("export")} failedLabel={t("exportFailed")} truncatedLabel={t("exportTruncated")} /> : null}
        </div>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </header>

      {view.groups.length === 0 ? <p className="text-sm text-muted-foreground">{t("empty")}</p> : null}
      {view.groups.map((group) => (
        <section key={group.kind === "reports" || group.kind === "portfolio_other" ? group.kind : `${group.kind}:${group.teamId}`} className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">{group.kind === "reports" ? t("myReports") : group.kind === "portfolio_other" ? t("otherTeams", { count: group.teams }) : group.name}</h2>
          {group.kind === "portfolio" || group.kind === "portfolio_other" ? <p className="text-xs text-muted-foreground">{t("portfolioHint")}</p> : null}
          {table(group)}
        </section>
      ))}
    </div>
  );
}
