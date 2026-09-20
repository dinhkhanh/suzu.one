import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listMyPayslips } from "@/modules/payroll/payslips";
import { formatVnd } from "@/modules/payroll/ui/money";

export const metadata: Metadata = { title: "Payslips" };

/** My payslips (FR-PAY-32). Every signed-in person has this page; it shows their own months only. */
export default async function MyPayslipsPage() {
  const user = await requireUser();
  requireStepUp(user, "/payslips");
  const [t, format, payslips] = await Promise.all([getTranslations("payroll.payslips"), getFormatter(), listMyPayslips(user.person.id)]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("mine")}</h1>
        <p className="text-sm text-muted-foreground">{t("mineDescription")}</p>
      </header>

      {payslips.length === 0 ? (
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("month")}</TableHead>
              <TableHead>{t("entity")}</TableHead>
              <TableHead className="text-right">{t("net")}</TableHead>
              <TableHead>{t("published")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {payslips.map((payslip) => (
              <TableRow key={payslip.id}>
                <TableCell>
                  <Link href={`/payslips/${payslip.id}`} className="font-medium hover:underline">
                    {payslip.month}
                  </Link>
                  {payslip.kind === "off_cycle" ? <span className="ml-2 text-xs text-muted-foreground">{payslip.runName}</span> : null}
                  {payslip.firstViewedAt ? null : (
                    <Badge className="ml-2 text-[10px]" variant="default">
                      {t("new")}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">{payslip.entityCode}</TableCell>
                <TableCell className="text-right tabular-nums">{formatVnd(payslip.net)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{format.dateTime(payslip.publishedAt, { dateStyle: "medium" })}</TableCell>
                <TableCell className="text-right">
                  {payslip.openQueries > 0 ? <Badge variant="outline">{t("queryOpen")}</Badge> : null}
                  <Link href={`/payslips/${payslip.id}`} className="ml-2 text-sm hover:underline">
                    {t("open")}
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
