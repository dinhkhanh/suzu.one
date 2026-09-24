import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { statusTone } from "@/components/ui/tone";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listQueriesForManager } from "@/modules/payroll/payslips";
import { compensationReach } from "@/modules/payroll/policy";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("payslipQueries");

/** C&B's queue of payslip questions (FR-PAY-32), scoped in SQL to the entities they manage. */
export default async function PayslipQueriesPage() {
  const user = await requireUser();
  const reach = compensationReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/queries");

  const [t, format, rows] = await Promise.all([getTranslations("payroll.payslips.queries"), getFormatter(), listQueriesForManager(user.principal)]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
          ← {t("queue")}
        </Link>
        <h1>{t("queue")}</h1>
        <p className="text-sm text-muted-foreground">{t("queueDescription")}</p>
      </header>

      {rows.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("noneInQueue")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("asker")}</TableHead>
              <TableHead>{t("lastMessage")}</TableHead>
              <TableHead>{t("statuses.open")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.query.id}>
                <TableCell>
                  <span className="font-medium">{row.personName}</span>
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    {row.entityCode} · {row.payslip.month}
                  </span>
                </TableCell>
                <TableCell className="max-w-md truncate text-sm text-muted-foreground">{row.lastMessage}</TableCell>
                <TableCell>
                  <Badge dot variant={statusTone(row.query.status)}>{t(`statuses.${row.query.status}` as "statuses.open")}</Badge>
                  <span className="ml-2 text-xs text-muted-foreground">{format.dateTime(row.lastAt, { dateStyle: "short", timeStyle: "short" })}</span>
                </TableCell>
                <TableCell className="text-right">
                  <Link href={`/payslips/${row.payslip.id}`} className="text-sm hover:underline">
                    {t("reply")}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
