import { getFormatter, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { List, ListItem } from "@/components/ui/list";
import { Page, PageHeader, Section } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";
import { Table, TableBody, TableCard, TableCardHeader, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { todayInVietnam } from "@/lib/dates";
import { requireUser } from "@/modules/platform/auth/session";
import { listAnonymisationDue } from "@/modules/privacy/anonymise";
import { AI_CONVERSATION_RETENTION_DAYS, FORMER_EMPLOYEE_RETENTION_YEARS, PUNCH_POSITION_RETENTION_DAYS } from "@/modules/privacy/engine/retention";
import { canSeeRetentionList } from "@/modules/privacy/policy";
import { AnonymiseButton } from "@/modules/privacy/ui/anonymise-button";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("privacy");

// Retention (NFR-PRV-04): the former employees whose personal details are due to go, among the
// people the viewer keeps records of, each anonymised only when somebody here confirms it — and the
// schedule the nightly sweeps keep by themselves.
export default async function PrivacyAdminPage() {
  const user = await requireUser();
  if (!canSeeRetentionList(user.principal)) notFound();

  const [t, format, due] = await Promise.all([getTranslations("privacy.admin"), getFormatter(), listAnonymisationDue(user.principal, todayInVietnam())]);
  const day = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { dateStyle: "medium" });

  return (
    <Page>
      <PageHeader title={t("title")} description={t("description")} />
      <TableCard>
        <TableCardHeader title={t("dueTitle")} count={due.length} description={t("dueDescription", { years: FORMER_EMPLOYEE_RETENTION_YEARS })} />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead kind="person">{t("columns.person")}</TableHead>
              <TableHead kind="id">{t("columns.code")}</TableHead>
              <TableHead kind="org">{t("columns.entity")}</TableHead>
              <TableHead kind="date">{t("columns.lastDay")}</TableHead>
              <TableHead kind="date">{t("columns.dueOn")}</TableHead>
              <TableHead kind="actions" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {due.length === 0 ? <TableEmpty>{t("none")}</TableEmpty> : null}
            {due.map((row) => (
              <TableRow key={row.personId}>
                <TableCell className="font-medium">
                  <RecordLink kind="person" id={row.personId}>
                    {row.fullName}
                  </RecordLink>
                </TableCell>
                <TableCell kind="id">{row.employeeCode}</TableCell>
                <TableCell className="text-muted-foreground">{row.entity}</TableCell>
                <TableCell kind="date">{day(row.lastDay)}</TableCell>
                <TableCell kind="date">{day(row.dueOn)}</TableCell>
                <TableCell kind="actions">
                  <AnonymiseButton personId={row.personId} name={row.fullName} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      <Section title={t("scheduleTitle")} description={t("scheduleDescription")}>
        <List>
          <ListItem>{t("schedule.positions", { days: PUNCH_POSITION_RETENTION_DAYS })}</ListItem>
          <ListItem>{t("schedule.assistant", { days: AI_CONVERSATION_RETENTION_DAYS })}</ListItem>
          <ListItem>{t("schedule.faces")}</ListItem>
          <ListItem>{t("schedule.candidates")}</ListItem>
          <ListItem>{t("schedule.former", { years: FORMER_EMPLOYEE_RETENTION_YEARS })}</ListItem>
          <ListItem>{t("schedule.byLaw")}</ListItem>
        </List>
      </Section>
    </Page>
  );
}
