"use server";
// Exporting a payroll report (FR-PAY-34, FR-PLT-37). Every export is audited — who took what out
// of the system, for which entity and month, and how many rows — because a spreadsheet of
// everybody's pay leaving the building is exactly the event an audit needs to show (NFR-SEC-07).
//
// The rows themselves go back to the browser that asked and are never stored. The report's own
// function decides who may see it: the ones that name people take `payroll:propose`, so a viewer
// with only `payroll:read` gets `null` and the action refuses.
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { type ExportColumn, toCsv } from "@/modules/platform/export/csv";
import { canReadPayroll } from "./policy";
import { costReport, type InsuranceLine, insuranceSummary, payrollRegister, type PitLine, pitSummary, type RegisterLine, unionReport } from "./reports";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** The reports that can be exported, each with its columns. Money is written as a plain integer. */
const REPORTS = ["register", "insurance", "pit", "cost", "union"] as const;
type ReportKey = (typeof REPORTS)[number];

const registerColumns: ExportColumn<RegisterLine>[] = [
  { header: "Mã NV", value: (row) => row.employeeCode },
  { header: "Họ và tên", value: (row) => row.fullName },
  { header: "Phòng ban", value: (row) => row.departmentName },
  { header: "Hồ sơ", value: (row) => row.profile },
  { header: "Tổng thu nhập", value: (row) => row.gross },
  { header: "BH người lao động", value: (row) => row.employeeInsurance },
  { header: "Đoàn phí", value: (row) => row.unionDues },
  { header: "Thuế TNCN", value: (row) => row.pit },
  { header: "Khấu trừ khác", value: (row) => row.otherDeductions },
  { header: "Thực nhận", value: (row) => row.net },
  { header: "BH công ty đóng", value: (row) => row.employerInsurance },
  { header: "KPCĐ", value: (row) => row.unionFund },
  { header: "Tổng chi phí", value: (row) => row.employerCost },
];

const insuranceColumns: ExportColumn<InsuranceLine>[] = [
  { header: "Mã NV", value: (row) => row.employeeCode },
  { header: "Họ và tên", value: (row) => row.fullName },
  { header: "Số sổ BHXH", value: (row) => row.socialInsuranceNumber },
  { header: "Mức đóng", value: (row) => row.base },
  { header: "BHXH (NLĐ)", value: (row) => row.employee.bhxh },
  { header: "BHYT (NLĐ)", value: (row) => row.employee.bhyt },
  { header: "BHTN (NLĐ)", value: (row) => row.employee.bhtn },
  { header: "BHXH (CTY)", value: (row) => row.employer.bhxh },
  { header: "BHYT (CTY)", value: (row) => row.employer.bhyt },
  { header: "BHTN (CTY)", value: (row) => row.employer.bhtn },
  { header: "Tham gia", value: (row) => (row.covered ? "x" : "") },
  { header: "Lý do không đóng", value: (row) => row.reason },
];

const pitColumns: ExportColumn<PitLine>[] = [
  { header: "Mã NV", value: (row) => row.employeeCode },
  { header: "Họ và tên", value: (row) => row.fullName },
  { header: "Mã số thuế", value: (row) => row.taxCode },
  { header: "Cách tính", value: (row) => row.method },
  { header: "Thu nhập chịu thuế", value: (row) => row.taxableIncome },
  { header: "Thu nhập tính thuế", value: (row) => row.assessableIncome },
  { header: "Người phụ thuộc", value: (row) => row.dependents },
  { header: "Thuế đã khấu trừ", value: (row) => row.tax },
];

const exportPipeline = createAction({
  name: "payroll_report.export",
  stepUp: true,
  input: z.object({ report: z.enum(REPORTS), entityId: z.uuid(), month }),
  // Authorization lives in the report functions, which answer null to a viewer who may not see
  // them; this is the coarse check that the viewer has payroll rights over the entity at all.
  authorize: (user, input) => canReadPayroll(user.principal, { entityId: input.entityId }),
  run: async ({ user, input }) => {
    const built = await build(input.report, user.principal, input.entityId, input.month);
    if (!built) throw new ActionError("report_not_available");
    return {
      data: { fileName: built.fileName, csv: built.csv, rowCount: built.rowCount },
      // What left, for whom, and how much of it — never a figure from inside it.
      audit: { resource: { type: "payroll_report", id: `${input.report}:${input.month}`, entityId: input.entityId }, summary: `${input.report} export ${input.month}`, after: { report: input.report, month: input.month, rows: built.rowCount } },
    };
  },
});

async function build(report: ReportKey, principal: Parameters<typeof payrollRegister>[0], entityId: string, month: string): Promise<{ fileName: string; csv: string; rowCount: number } | null> {
  switch (report) {
    case "register": {
      const built = await payrollRegister(principal, entityId, month);
      return built && { fileName: `bang-luong-${built.entityCode}-${month}.csv`, csv: toCsv(registerColumns, built.lines), rowCount: built.lines.length };
    }
    case "insurance": {
      const built = await insuranceSummary(principal, entityId, month);
      return built && { fileName: `bao-hiem-${built.entityCode}-${month}.csv`, csv: toCsv(insuranceColumns, built.lines), rowCount: built.lines.length };
    }
    case "pit": {
      const built = await pitSummary(principal, entityId, month);
      return built && { fileName: `thue-tncn-${built.entityCode}-${month}.csv`, csv: toCsv(pitColumns, built.lines), rowCount: built.lines.length };
    }
    case "cost": {
      const built = await costReport(principal, { entityId, month });
      const columns: ExportColumn<(typeof built.byDepartment)[number]>[] = [
        { header: "Phòng ban", value: (row) => row.label },
        { header: "Số người", value: (row) => row.headcount },
        { header: "Tổng thu nhập", value: (row) => row.gross },
        { header: "BH công ty đóng", value: (row) => row.employerInsurance },
        { header: "KPCĐ", value: (row) => row.unionFund },
        { header: "Tổng chi phí", value: (row) => row.employerCost },
      ];
      return { fileName: `chi-phi-nhan-su-${month}.csv`, csv: toCsv(columns, built.byDepartment), rowCount: built.byDepartment.length };
    }
    case "union": {
      const built = await unionReport(principal, { entityId, month });
      const columns: ExportColumn<(typeof built.rows)[number]>[] = [
        { header: "Pháp nhân", value: (row) => row.entityCode },
        { header: "Số đoàn viên", value: (row) => row.members },
        { header: "Đoàn phí", value: (row) => row.dues },
        { header: "KPCĐ", value: (row) => row.fund },
        { header: "Tổng", value: (row) => row.total },
      ];
      return { fileName: `cong-doan-${month}.csv`, csv: toCsv(columns, built.rows), rowCount: built.rows.length };
    }
  }
}

export async function exportPayrollReportAction(input: unknown) {
  return exportPipeline(input);
}
