// The payslip as a PDF (FR-PAY-32). A route handler rather than a page because it answers with a
// file — but it is guarded exactly like the page: `getPayslipView` decides, so self, C&B over the
// entity and the owner get the file and everybody else gets the same 404 as a payslip that does
// not exist. A stale session is sent to re-authenticate first (FR-PLT-06).
//
// The file is generated on the way out and never stored: nothing about anyone's pay is written to
// disk, and no caching layer is allowed to keep a copy (NFR-SEC-08).
import { getFormatter, getTranslations } from "next-intl/server";
import { isStepUpFresh } from "@/modules/platform/auth/step-up-policy";
import { getCurrentUser } from "@/modules/platform/auth/session";
import { renderPayslipPdf } from "@/modules/payroll/exports/payslip-pdf";
import { payslipFont } from "@/modules/payroll/exports/pdf/load-font";
import { getPayslipView, recordPayslipView } from "@/modules/payroll/payslips";
import { formatVnd } from "@/modules/payroll/ui/money";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: RouteContext<"/payslips/[payslipId]/pdf">) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });

  const { payslipId } = await params;
  const view = await getPayslipView(user.principal, payslipId);
  // Not there, or not theirs — the same answer either way.
  if (!view) return new Response(null, { status: 404 });
  // No redirect from a download: the browser would save the sign-in page as a PDF.
  if (!isStepUpFresh(user.reauthAt)) return new Response("step_up_required", { status: 403 });

  const [t, format] = await Promise.all([getTranslations("payroll.payslips"), getFormatter()]);
  const { result, person, entity, run } = view;

  const pdf = renderPayslipPdf({
    result,
    componentNames: view.componentNames,
    person,
    entity,
    month: run.month,
    font: payslipFont(),
    formatMoney: formatVnd,
    labels: {
      title: t("titleFor", { month: run.month }),
      entityLabel: { taxCode: t("taxCode") },
      person: { person: t("person"), employeeCode: t("employeeCode"), position: t("position"), department: t("department"), profile: t("profile"), paidDays: t("paidDays") },
      profileName: t(`profiles.${result.profile}` as "profiles.statutory"),
      sections: { earnings: t("earnings"), deductions: t("deductions"), net: t("net"), insurance: t("insurance.title"), pit: t("pit.title"), employerCosts: t("employerCosts") },
      columns: { line: t("line"), amount: t("amount"), fund: t("insurance.fund"), base: t("insurance.base"), employee: t("insurance.employee"), employer: t("insurance.employer") },
      totals: { gross: t("grossEarnings"), deductions: t("totalDeductions") },
      insurance: {
        funds: { bhxh: t("insurance.funds.bhxh"), bhyt: t("insurance.funds.bhyt"), bhtn: t("insurance.funds.bhtn") },
        notCovered: result.insurance.reason ? t(`insurance.reasons.${result.insurance.reason}` as "insurance.reasons.probation") : t("insurance.notCovered"),
      },
      pit: {
        method: t(`pit.methods.${result.pit.method}` as "pit.methods.progressive"),
        taxableIncome: t("pit.taxableIncome"),
        assessableIncome: t("pit.assessableIncome"),
        personalDeduction: t("pit.personalDeduction"),
        dependentDeduction: t("pit.dependentDeduction"),
        insuranceDeduction: t("pit.insuranceDeduction"),
        tax: t("pit.title"),
      },
      footer: t("pdfFooter", { at: format.dateTime(new Date(), { dateStyle: "medium", timeStyle: "short" }) }),
    },
  });

  if (view.isOwner) await recordPayslipView(payslipId, user.person.id);

  const fileName = `payslip-${run.month}-${(person.employeeCode ?? person.id).replace(/[^\w-]/g, "")}.pdf`;
  return new Response(pdf as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
