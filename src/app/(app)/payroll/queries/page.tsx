import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { noteToPlainText } from "@/modules/platform/rich-text/engine/note";
import { listQueriesForManager } from "@/modules/payroll/payslips";
import { compensationReach } from "@/modules/payroll/policy";
import { pageTitle } from "@/i18n/page-title";
import { Page, PageHeader } from "@/components/ui/page";
import { RecordLink } from "@/components/ui/record-link";

export const generateMetadata = pageTitle("payslipQueries");

/** C&B's queue of payslip questions (FR-PAY-32), scoped in SQL to the entities they manage. */
export default async function PayslipQueriesPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/queries");

  const [t, format, rows] = await Promise.all([getTranslations("payroll.payslips.queries"), getFormatter(), listQueriesForManager(user.principal)]);

  return (
    <Page width="default">
      <PageHeader
        eyebrow={
          <Link href="/payroll" className="text-link hover:underline">
            ← {t("queue")}
          </Link>
        }
        title={t("queue")}
        description={t("queueDescription")}
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead kind="person">{t("asker")}</TableHead>
            <TableHead kind="text">{t("lastMessage")}</TableHead>
            <TableHead kind="status">{t("statuses.open")}</TableHead>
            <TableHead kind="actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableEmpty>{t("noneInQueue")}</TableEmpty> : null}
          {rows.map((row) => (
            <TableRow key={row.query.id}>
              <TableCell>
                <RecordLink kind="person" id={row.payslip.personId} className="font-medium">
                  {row.personName}
                </RecordLink>
                <span className="ml-2 font-mono text-xs text-muted-foreground">
                  {row.entityCode} · {row.payslip.month}
                </span>
              </TableCell>
              <TableCell className="max-w-md truncate text-muted-foreground">{noteToPlainText(row.lastMessage)}</TableCell>
              <TableCell>
                <Badge dot variant={statusTone(row.query.status)}>
                  {t(`statuses.${row.query.status}` as "statuses.open")}
                </Badge>
                <span className="ml-2 text-xs text-muted-foreground">{format.dateTime(row.lastAt, { dateStyle: "short", timeStyle: "short" })}</span>
              </TableCell>
              <TableCell kind="actions">
                <Link href={`/payslips/${row.payslip.id}`} className="text-sm hover:underline">
                  {t("reply")}
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Page>
  );
}
