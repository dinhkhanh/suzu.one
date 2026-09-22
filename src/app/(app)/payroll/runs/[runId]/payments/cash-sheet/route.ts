// The cash payment sheet as a printable PDF (FR-PAY-39): the paper the chief accountant carries
// round and each person signs. Guarded like every payment screen — `payroll:pay` or C&B over the
// run's entity — and generated on the way out, never stored.
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { renderCashSheetPdf } from "@/modules/payroll/exports/cash-sheet";
import { payslipFont } from "@/modules/platform/pdf/load-font";
import { hasReached } from "@/modules/payroll/lifecycle";
import { cashSheetRows } from "@/modules/payroll/payments";
import { canManageCompensation, canPayPayroll } from "@/modules/payroll/policy";
import { getRun } from "@/modules/payroll/runs";
import { formatVnd } from "@/modules/payroll/ui/money";
import { listEntities } from "@/modules/platform/org/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/payroll/runs/[runId]/payments/cash-sheet">) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const { runId } = await params;
  const run = await getRun(runId);
  if (!run || !(canPayPayroll(user.principal, run) || canManageCompensation(user.principal, run)) || !hasReached(run, "approved")) return new Response(null, { status: 404 });
  if (!isStepUpFresh(user.reauthAt)) return new Response("step_up_required", { status: 403 });

  const [t, rows, entities] = await Promise.all([getTranslations("payroll.payments.cash"), cashSheetRows(run), listEntities()]);
  // The run's entity always exists (a foreign key); it comes from the shared cache of entities.
  const entity = entities.find((row) => row.id === run.entityId)!;
  if (rows.length === 0) return new Response(null, { status: 404 });

  const pdf = renderCashSheetPdf({
    rows,
    entity,
    month: run.month,
    font: payslipFont(),
    formatMoney: formatVnd,
    labels: {
      title: t("sheetTitle"),
      entityTaxCode: t("taxCode"),
      month: t("sheetMonth"),
      columns: { index: t("columns.index"), employeeCode: t("columns.employeeCode"), name: t("columns.name"), amount: t("columns.amount"), signature: t("columns.signature"), date: t("columns.date") },
      total: t("total"),
      headcount: t("headcount"),
      preparedBy: t("preparedBy"),
      receivedBy: t("receivedBy"),
      note: t("sheetNote"),
    },
  });

  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="cash-sheet-${run.month}.pdf"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
