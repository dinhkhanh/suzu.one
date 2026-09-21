import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/modules/platform/auth/session";
import { requireStepUp } from "@/modules/platform/auth/step-up";
import { listEntityOptions } from "@/modules/payroll/options";
import { compensationReach, payrollReadReach } from "@/modules/payroll/policy";
import { listRunsForViewer } from "@/modules/payroll/run-views";
import { formatVnd } from "@/modules/payroll/ui/money";

export const metadata: Metadata = { title: "Payroll runs" };

/** The run register (FR-PAY-30): every entity the viewer may read payroll for. */
export default async function PayrollRunsPage({ searchParams }: PageProps<"/payroll/runs">) {
  const user = await requireUser();
  const reach = payrollReadReach(user.principal);
  if (!reach.all && reach.entityIds.length === 0) notFound();
  requireStepUp(user, "/payroll/runs");

  const params = await searchParams;
  const entityId = typeof params.entity === "string" && /^[0-9a-f-]{36}$/.test(params.entity) ? params.entity : null;
  const month = typeof params.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : null;
  const [t, format, rows, entities] = await Promise.all([getTranslations("payroll"), getFormatter(), listRunsForViewer(user.principal, { entityId, month }), listEntityOptions(reach)]);
  const manages = compensationReach(user.principal);
  const canCreate = manages.all || manages.entityIds.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/payroll" className="text-sm text-muted-foreground hover:underline">
            ← {t("title")}
          </Link>
          <h1>{t("runs.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("runs.description")}</p>
        </div>
        {canCreate ? (
          <Link href="/payroll/runs/new" className="h-9 rounded-md border px-3 text-sm leading-9 hover:bg-muted">
            {t("runs.new.link")}
          </Link>
        ) : null}
      </header>

      <form className="toolbar" action="/payroll/runs">
        <select name="entity" defaultValue={entityId ?? ""} className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">{t("salaries.allEntities")}</option>
          {entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.code}
            </option>
          ))}
        </select>
        <input name="month" defaultValue={month ?? ""} placeholder="2026-08" pattern="\d{4}-\d{2}" className="h-9 w-28 rounded-md border bg-transparent px-3 text-sm" />
        <button type="submit" className="h-9 rounded-md border px-3 text-sm hover:bg-muted">
          {t("salaries.filter")}
        </button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("runs.month")}</TableHead>
            <TableHead>{t("runs.entity")}</TableHead>
            <TableHead>{t("runs.kind")}</TableHead>
            <TableHead>{t("runs.status")}</TableHead>
            <TableHead className="text-right">{t("runs.headcount")}</TableHead>
            <TableHead className="text-right">{t("runs.net")}</TableHead>
            <TableHead>{t("runs.paidAt")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Link href={`/payroll/runs/${row.id}`} className="font-medium tabular-nums hover:underline">
                  {row.month}
                </Link>
                {row.name ? <span className="ml-2 text-xs text-muted-foreground">{row.name}</span> : null}
              </TableCell>
              <TableCell>{row.entityCode}</TableCell>
              <TableCell>
                <Badge variant={row.kind === "off_cycle" ? "outline" : "secondary"}>{t(`runs.kinds.${row.kind}`)}</Badge>
              </TableCell>
              <TableCell>
                <Badge variant={row.status === "locked" || row.status === "paid" ? "secondary" : row.status === "cancelled" ? "outline" : "default"}>{t(`runs.statuses.${row.status}`)}</Badge>
                {row.calcState === "running" || row.calcState === "queued" ? <span className="ml-2 text-xs text-muted-foreground">{t("runs.calculating")}</span> : null}
                {row.calcState === "failed" ? <span className="ml-2 text-xs text-destructive">{t("runs.calcFailed")}</span> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{row.headcount}</TableCell>
              <TableCell className="text-right tabular-nums">{row.net === null ? "—" : formatVnd(row.net)}</TableCell>
              <TableCell>{row.paidAt ? format.dateTime(row.paidAt, { dateStyle: "medium" }) : "—"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("runs.empty")}</p> : null}
    </div>
  );
}
