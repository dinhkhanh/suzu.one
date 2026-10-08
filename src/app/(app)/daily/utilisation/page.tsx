import { getFormatter, getTranslations } from "next-intl/server";
import { Fragment } from "react";
import { List, ListEmpty } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
      <TableCell kind="percent" className={cn("align-top", strong && "font-medium")} title={t("cellTitle", { logged: hoursOf(value.logged), available: hoursOf(value.available) })}>
        <span className={cn("block", value.ratio !== null && value.ratio > 1.1 && "text-warning", value.ratio === null && "text-faint")}>{ratio === null ? "—" : t("ratio", { value: ratio })}</span>
        <span className="block text-xs text-muted-foreground">{t("hoursOf", { logged: hoursOf(value.logged), available: hoursOf(value.available) })}</span>
        {billable !== null ? <span className="block text-xs text-muted-foreground">{t("billableRatio", { value: billable })}</span> : null}
      </TableCell>
    );
  };

  const table = (group: UtilisationGroup) => (
    <Table numbered={false}>
      <TableHeader>
        <TableRow>
          <TableHead kind="person" className="min-w-40">
            {t("person")}
          </TableHead>
          {view.weeks.map((week) => (
            <TableHead key={week} kind="percent" className="min-w-20">
              {weekLabel(week)}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {group.kind !== "team" && group.kind !== "reports" && group.kind !== "company"
          ? null
          : group.people.map((person: UtilisationPerson) => (
              <TableRow key={person.personId}>
                <TableCell className="align-top font-medium">
                  <RecordLink kind="person" id={person.personId}>
                    {person.name}
                  </RecordLink>
                </TableCell>
                {person.weeks.map((value, index) => (
                  <Fragment key={view.weeks[index]}>{cell(value)}</Fragment>
                ))}
              </TableRow>
            ))}
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell className="align-top">{group.kind === "portfolio" || group.kind === "portfolio_other" ? t("headcount", { count: group.headcount }) : t("teamTotal")}</TableCell>
          {group.total.map((value, index) => (
            <Fragment key={view.weeks[index]}>{cell(value, true)}</Fragment>
          ))}
        </TableRow>
      </TableFooter>
    </Table>
  );

  return (
    <Page width="full">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={view.groups.length > 0 ? <ExportButton action={exportUtilisationAction} input={{}} label={t("export")} failedLabel={t("exportFailed")} truncatedLabel={t("exportTruncated")} /> : null}
      />

      {view.groups.length === 0 ? (
        <List>
          <ListEmpty>{t("empty")}</ListEmpty>
        </List>
      ) : null}
      {view.groups.map((group) => (
        <Section
          key={group.kind === "reports" || group.kind === "company" || group.kind === "portfolio_other" ? group.kind : `${group.kind}:${group.teamId}`}
          title={
            group.kind === "reports" ? (
              t("myReports")
            ) : group.kind === "company" ? (
              t("everyoneElse")
            ) : group.kind === "portfolio_other" ? (
              t("otherTeams", { count: group.teams })
            ) : (
              <RecordLink kind="team" id={group.teamId}>
                {group.name}
              </RecordLink>
            )
          }
        >
          {group.kind === "portfolio" || group.kind === "portfolio_other" ? <p className="px-0.5 text-xs text-muted-foreground">{t("portfolioHint")}</p> : null}
          {table(group)}
        </Section>
      ))}
    </Page>
  );
}
