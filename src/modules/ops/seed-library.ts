// The starter obligation library (FR-OPS-03, 04), written by `pnpm db:seed`.
// A DRAFT: every due date below is a plausible reading of current Vietnamese practice, not legal
// advice. Every template is seeded `unreviewed` and carries the note below until the chief
// accountant / HR lead has been through it on Ops → Library. Existing codes are never overwritten.
import type { DueRule } from "./engine/due-rule";
import { DEFAULT_ESCALATION, DEFAULT_REMINDER_LEAD_DAYS, type EvidenceRequirement, NO_EVIDENCE } from "./enums";
import type { TemplateInput } from "./templates";

const CONFIRM_ACCOUNTANT = "Bản nháp — cần Kế toán trưởng xác nhận hạn nộp và căn cứ pháp lý trước khi dùng chính thức.";
const CONFIRM_HR = "Bản nháp — cần Trưởng phòng Nhân sự xác nhận thời hạn và quy trình trước khi dùng chính thức.";

const FINANCE = "role:finance";
const HR = "permission:person:manage";
const PAYROLL = "permission:payroll:propose";
const ASSETS = "permission:asset:manage";

const FILED: EvidenceRequirement = { file: true, reference: true, submittedDate: true, amount: false };
const PAID: EvidenceRequirement = { file: true, reference: false, submittedDate: true, amount: true };
const FILED_AND_PAID: EvidenceRequirement = { file: true, reference: true, submittedDate: true, amount: true };
const PAPER: EvidenceRequirement = { file: true, reference: false, submittedDate: false, amount: false };

const afterPeriod = (monthsAfter: number, day: number | "last"): DueRule => ({ type: "after_period", monthsAfter, day });
const inPeriod = (month: number, day: number | "last"): DueRule => ({ type: "in_period", month, day });
const afterEvent = (days: number): DueRule => ({ type: "after_event", days });

type Seed = Pick<TemplateInput, "code" | "name" | "category" | "authority" | "recurrence" | "dueRule" | "ownerRule"> & Partial<TemplateInput>;

const template = (seed: Seed): TemplateInput => ({
  shift: "next_working_day",
  eventType: null,
  entityIds: null,
  ownerPersonId: null,
  reviewerRule: "none",
  reviewerPersonId: null,
  checklist: [],
  links: [],
  reminderLeadDays: DEFAULT_REMINDER_LEAD_DAYS,
  escalation: DEFAULT_ESCALATION,
  evidence: NO_EVIDENCE,
  penaltyNote: null,
  isActive: true,
  ...seed,
  guidance: [seed.guidance, seed.authority === "tax" || seed.ownerRule === FINANCE ? CONFIRM_ACCOUNTANT : CONFIRM_HR].filter(Boolean).join("\n\n"),
});

export const OBLIGATION_LIBRARY: TemplateInput[] = [
  // ── Internal: the monthly payroll calendar (lock by the 2nd → propose by the 3rd → CEO signs by the 4th → pay on the 5th) ──
  template({ code: "INT-TIMESHEET-LOCK", name: "Khóa bảng công tháng", category: "internal", authority: "internal", recurrence: "monthly", dueRule: afterPeriod(1, 2), ownerRule: "permission:attendance:manage", checklist: ["Nhắc nhân viên xác nhận bảng công", "Quản lý duyệt bảng công của nhóm", "Xử lý các bất thường còn lại", "Khóa bảng công của pháp nhân"], guidance: "Hạn: ngày 2 của tháng sau. Tự động hoàn thành khi bảng công của pháp nhân được khóa trong phân hệ Chấm công.", reminderLeadDays: [3, 1] }),
  template({ code: "INT-PAYROLL-PROPOSE", name: "Lập và trình bảng lương tháng", category: "internal", authority: "internal", recurrence: "monthly", dueRule: afterPeriod(1, 3), ownerRule: PAYROLL, reviewerRule: FINANCE, checklist: ["Lấy số liệu công đã khóa", "Cập nhật thay đổi lương, phụ cấp, người phụ thuộc", "Tính lương, BHXH, thuế TNCN", "Đối chiếu với tháng trước", "Trình Tổng Giám đốc"], guidance: "Hạn: ngày 3 của tháng sau.", evidence: PAPER, reminderLeadDays: [3, 1] }),
  template({ code: "INT-PAYROLL-SIGN", name: "Tổng Giám đốc ký duyệt bảng lương", category: "internal", authority: "internal", recurrence: "monthly", dueRule: afterPeriod(1, 4), ownerRule: "permission:payroll:approve", guidance: "Hạn: ngày 4 của tháng sau.", reminderLeadDays: [1] }),
  template({ code: "INT-SALARY-PAYMENT", name: "Chi lương tháng", category: "internal", authority: "internal", recurrence: "monthly", dueRule: afterPeriod(1, 5), shift: "previous_working_day", ownerRule: "permission:payroll:pay", reviewerRule: PAYROLL, checklist: ["Lập lệnh chi / tệp ngân hàng", "Duyệt lệnh chi trên ngân hàng", "Xác nhận đã ghi có cho nhân viên"], guidance: "Ngày 5 của tháng sau; rơi vào ngày nghỉ thì chi vào ngày làm việc liền trước.", evidence: PAID, reminderLeadDays: [2, 1], penaltyNote: "Chậm lương từ 15 ngày phải trả thêm lãi cho người lao động." }),
  template({ code: "INT-PAYSLIP-RELEASE", name: "Phát hành phiếu lương", category: "internal", authority: "internal", recurrence: "monthly", dueRule: afterPeriod(1, 5), ownerRule: PAYROLL, guidance: "Cùng ngày chi lương.", reminderLeadDays: [1] }),

  // ── Internal: HR and C&B routines ──
  template({ code: "INT-INSURANCE-MOVEMENT", name: "Báo tăng / giảm BHXH trong tháng", category: "internal", authority: "social_insurance", recurrence: "monthly", dueRule: inPeriod(1, "last"), ownerRule: HR, checklist: ["Rà soát nhân sự mới, nghỉ việc, nghỉ không lương từ 14 ngày, thai sản", "Lập hồ sơ 600 trên cổng BHXH", "Lưu thông báo kết quả"], evidence: FILED }),
  template({ code: "INT-INSURANCE-RECONCILE", name: "Đối chiếu số phải nộp BHXH (C12)", category: "internal", authority: "social_insurance", recurrence: "monthly", dueRule: afterPeriod(1, 10), ownerRule: HR, reviewerRule: FINANCE, checklist: ["Tải thông báo C12", "Đối chiếu với bảng lương và danh sách tăng giảm", "Xử lý chênh lệch"], evidence: PAPER }),
  template({ code: "INT-CONTRACT-EXPIRY-REVIEW", name: "Rà soát hợp đồng sắp hết hạn", category: "internal", authority: "internal", recurrence: "monthly", dueRule: inPeriod(1, 5), ownerRule: HR, guidance: "Hợp đồng hết hạn trong 45 ngày tới: gia hạn, ký mới hoặc chấm dứt; báo trước cho người lao động." }),
  template({ code: "INT-PROBATION-REVIEW", name: "Rà soát nhân sự sắp hết thử việc", category: "internal", authority: "internal", recurrence: "monthly", dueRule: inPeriod(1, 5), ownerRule: HR, guidance: "Thu thập đánh giá của quản lý trước khi hết thử việc ít nhất 3 ngày." }),
  template({ code: "INT-LEAVE-YEAR-END", name: "Xử lý phép năm cuối năm (chuyển, hủy, thanh toán)", category: "internal", authority: "internal", recurrence: "annual", dueRule: afterPeriod(1, 15), ownerRule: "permission:leave:manage", reminderLeadDays: [14, 7, 1] }),
  template({ code: "INT-13TH-MONTH", name: "Tính và chi lương tháng 13", category: "internal", authority: "internal", recurrence: "annual", dueRule: afterPeriod(1, 25), shift: "previous_working_day", ownerRule: PAYROLL, reviewerRule: FINANCE, guidance: "Trước Tết Nguyên đán; ngày cụ thể do Ban Giám đốc quyết định hằng năm.", evidence: PAID, reminderLeadDays: [30, 14, 7] }),
  template({ code: "INT-HEALTH-CHECK", name: "Khám sức khỏe định kỳ hằng năm", category: "internal", authority: "labour", recurrence: "annual", dueRule: inPeriod(10, "last"), ownerRule: HR, evidence: PAPER, reminderLeadDays: [45, 14, 7], penaltyNote: "Không tổ chức khám sức khỏe định kỳ có thể bị phạt theo số người lao động." }),
  template({ code: "INT-LABOUR-RULES-REVIEW", name: "Rà soát nội quy lao động và chính sách nhân sự", category: "internal", authority: "internal", recurrence: "annual", dueRule: inPeriod(11, "last"), ownerRule: HR, reminderLeadDays: [30, 7] }),

  // ── External: tax ──
  template({ code: "EXT-VAT-MONTHLY", name: "Tờ khai thuế GTGT tháng", category: "external", authority: "tax", recurrence: "monthly", dueRule: afterPeriod(1, 20), ownerRule: FINANCE, evidence: FILED_AND_PAID, guidance: "Chỉ áp dụng cho pháp nhân kê khai theo tháng — tắt mẫu này hoặc giới hạn pháp nhân nếu kê khai theo quý.", penaltyNote: "Chậm nộp tờ khai: phạt hành chính; chậm nộp tiền thuế: 0,03%/ngày." }),
  template({ code: "EXT-VAT-QUARTERLY", name: "Tờ khai thuế GTGT quý", category: "external", authority: "tax", recurrence: "quarterly", dueRule: afterPeriod(1, "last"), ownerRule: FINANCE, evidence: FILED_AND_PAID, guidance: "Chỉ áp dụng cho pháp nhân kê khai theo quý.", isActive: false }),
  template({ code: "EXT-PIT-MONTHLY", name: "Tờ khai thuế TNCN tháng (05/KK-TNCN)", category: "external", authority: "tax", recurrence: "monthly", dueRule: afterPeriod(1, 20), ownerRule: FINANCE, evidence: FILED_AND_PAID, guidance: "Chỉ áp dụng cho pháp nhân kê khai theo tháng.", isActive: false }),
  template({ code: "EXT-PIT-QUARTERLY", name: "Tờ khai thuế TNCN quý (05/KK-TNCN)", category: "external", authority: "tax", recurrence: "quarterly", dueRule: afterPeriod(1, "last"), ownerRule: FINANCE, evidence: FILED_AND_PAID }),
  template({ code: "EXT-CIT-PROVISIONAL", name: "Tạm nộp thuế TNDN quý", category: "external", authority: "tax", recurrence: "quarterly", dueRule: afterPeriod(1, 30), ownerRule: FINANCE, evidence: PAID, penaltyNote: "Tổng tạm nộp 4 quý dưới 80% số quyết toán thì tính tiền chậm nộp trên phần thiếu." }),
  template({ code: "EXT-INVOICE-USAGE", name: "Báo cáo tình hình sử dụng hóa đơn (nếu áp dụng)", category: "external", authority: "tax", recurrence: "quarterly", dueRule: afterPeriod(1, "last"), ownerRule: FINANCE, evidence: FILED, guidance: "Không áp dụng cho pháp nhân chỉ dùng hóa đơn điện tử có mã — hủy kỳ không áp dụng với lý do.", isActive: false }),
  template({ code: "EXT-FINANCIAL-STATEMENTS", name: "Báo cáo tài chính năm", category: "external", authority: "tax", recurrence: "annual", dueRule: afterPeriod(3, "last"), ownerRule: FINANCE, evidence: FILED, reminderLeadDays: [45, 14, 7, 1] }),
  template({ code: "EXT-CIT-FINALIZATION", name: "Quyết toán thuế TNDN năm", category: "external", authority: "tax", recurrence: "annual", dueRule: afterPeriod(3, "last"), ownerRule: FINANCE, evidence: FILED_AND_PAID, reminderLeadDays: [45, 14, 7, 1] }),
  template({ code: "EXT-PIT-FINALIZATION", name: "Quyết toán thuế TNCN năm (05/QTT-TNCN)", category: "external", authority: "tax", recurrence: "annual", dueRule: afterPeriod(3, "last"), ownerRule: FINANCE, reviewerRule: PAYROLL, evidence: FILED_AND_PAID, reminderLeadDays: [45, 14, 7, 1] }),
  template({ code: "EXT-LICENCE-FEE", name: "Lệ phí môn bài", category: "external", authority: "tax", recurrence: "annual", dueRule: inPeriod(1, 30), ownerRule: FINANCE, evidence: PAID, reminderLeadDays: [14, 7, 1] }),
  template({ code: "EXT-AUDIT", name: "Kiểm toán độc lập báo cáo tài chính (nếu bắt buộc)", category: "external", authority: "other", recurrence: "annual", dueRule: afterPeriod(3, 20), ownerRule: FINANCE, evidence: PAPER, isActive: false, reminderLeadDays: [60, 30, 7] }),

  // ── External: insurance, labour, union, statistics ──
  template({ code: "EXT-INSURANCE-PAYMENT", name: "Nộp BHXH, BHYT, BHTN tháng", category: "external", authority: "social_insurance", recurrence: "monthly", dueRule: inPeriod(1, "last"), ownerRule: FINANCE, reviewerRule: HR, evidence: PAID, penaltyNote: "Chậm đóng từ 30 ngày: tính lãi chậm đóng." }),
  template({ code: "EXT-UNION-FEE", name: "Nộp kinh phí công đoàn tháng", category: "external", authority: "trade_union", recurrence: "monthly", dueRule: inPeriod(1, "last"), ownerRule: FINANCE, evidence: PAID }),
  template({ code: "EXT-UNEMPLOYMENT-REPORT", name: "Báo cáo tình hình tham gia BHTN năm", category: "external", authority: "labour", recurrence: "annual", dueRule: afterPeriod(1, 15), ownerRule: HR, evidence: FILED }),
  template({ code: "EXT-LABOUR-USAGE-H1", name: "Báo cáo tình hình sử dụng lao động 6 tháng đầu năm", category: "external", authority: "labour", recurrence: "annual", dueRule: inPeriod(6, 5), ownerRule: HR, evidence: FILED }),
  template({ code: "EXT-LABOUR-USAGE-ANNUAL", name: "Báo cáo tình hình sử dụng lao động năm", category: "external", authority: "labour", recurrence: "annual", dueRule: inPeriod(12, 5), ownerRule: HR, evidence: FILED }),
  template({ code: "EXT-ACCIDENT-REPORT-H1", name: "Báo cáo tai nạn lao động 6 tháng đầu năm", category: "external", authority: "labour", recurrence: "annual", dueRule: inPeriod(7, 5), ownerRule: HR, evidence: FILED }),
  template({ code: "EXT-ACCIDENT-REPORT-ANNUAL", name: "Báo cáo tai nạn lao động và công tác ATVSLĐ năm", category: "external", authority: "labour", recurrence: "annual", dueRule: afterPeriod(1, 10), ownerRule: HR, evidence: FILED }),
  template({ code: "EXT-STATISTICS-SURVEY", name: "Phiếu điều tra doanh nghiệp của Cục Thống kê", category: "external", authority: "statistics", recurrence: "annual", dueRule: inPeriod(4, "last"), ownerRule: FINANCE, evidence: FILED, guidance: "Hạn cụ thể theo thông báo hằng năm của cơ quan thống kê." }),
  template({ code: "EXT-WORK-PERMIT-REVIEW", name: "Rà soát giấy phép lao động của người nước ngoài", category: "external", authority: "labour", recurrence: "quarterly", dueRule: inPeriod(1, 15), ownerRule: HR, guidance: "Gia hạn phải nộp trước khi hết hạn từ 5 đến 45 ngày. Hủy kỳ nếu pháp nhân không có lao động nước ngoài.", isActive: false }),

  // ── Event-driven (FR-OPS-04): pulled from HR lifecycle events ──
  template({ code: "EVT-HIRE-CONTRACT", name: "Ký hợp đồng lao động", category: "internal", authority: "internal", recurrence: "event", eventType: "hire", dueRule: afterEvent(0), shift: "previous_working_day", ownerRule: HR, evidence: PAPER, reminderLeadDays: [3, 1] }),
  template({ code: "EVT-HIRE-INSURANCE", name: "Báo tăng BHXH cho nhân sự mới", category: "external", authority: "social_insurance", recurrence: "event", eventType: "hire", dueRule: afterEvent(30), ownerRule: HR, evidence: FILED, guidance: "Trong 30 ngày kể từ ngày ký hợp đồng lao động." }),
  template({ code: "EVT-HIRE-TAX-CODE", name: "Đăng ký mã số thuế cá nhân", category: "external", authority: "tax", recurrence: "event", eventType: "hire", dueRule: afterEvent(10), ownerRule: PAYROLL, evidence: { ...NO_EVIDENCE, reference: true }, guidance: "Chỉ khi người lao động chưa có mã số thuế; nếu đã có, ghi mã số vào ô số tham chiếu." }),
  template({ code: "EVT-HIRE-DEPENDENTS", name: "Đăng ký người phụ thuộc giảm trừ gia cảnh", category: "external", authority: "tax", recurrence: "event", eventType: "hire", dueRule: afterEvent(30), ownerRule: PAYROLL, guidance: "Thu bản đăng ký và hồ sơ chứng minh; hủy nếu không có người phụ thuộc." }),
  template({ code: "EVT-REHIRE-CONTRACT", name: "Ký hợp đồng lao động (tái tuyển dụng)", category: "internal", authority: "internal", recurrence: "event", eventType: "rehire", dueRule: afterEvent(0), shift: "previous_working_day", ownerRule: HR, evidence: PAPER, reminderLeadDays: [3, 1] }),
  template({ code: "EVT-REHIRE-INSURANCE", name: "Báo tăng BHXH (tái tuyển dụng)", category: "external", authority: "social_insurance", recurrence: "event", eventType: "rehire", dueRule: afterEvent(30), ownerRule: HR, evidence: FILED }),
  template({ code: "EVT-TERMINATION-INSURANCE", name: "Báo giảm và chốt sổ BHXH", category: "external", authority: "social_insurance", recurrence: "event", eventType: "termination", dueRule: afterEvent(14), ownerRule: HR, evidence: FILED, penaltyNote: "Báo giảm chậm: phải đóng BHYT của tháng báo chậm." }),
  template({ code: "EVT-TERMINATION-SETTLEMENT", name: "Thanh toán các khoản khi chấm dứt hợp đồng", category: "internal", authority: "internal", recurrence: "event", eventType: "termination", dueRule: afterEvent(14), ownerRule: PAYROLL, reviewerRule: FINANCE, evidence: PAID, guidance: "Trong 14 ngày làm việc kể từ ngày chấm dứt: lương, phép năm chưa nghỉ, trợ cấp (nếu có)." }),
  template({ code: "EVT-TERMINATION-PIT-CERT", name: "Cấp chứng từ khấu trừ thuế TNCN", category: "external", authority: "tax", recurrence: "event", eventType: "termination", dueRule: afterEvent(14), ownerRule: PAYROLL, evidence: PAPER }),
  template({ code: "EVT-LONG-LEAVE-DECREASE", name: "Báo giảm BHXH do nghỉ dài ngày", category: "external", authority: "social_insurance", recurrence: "event", eventType: "long_leave", dueRule: afterEvent(10), ownerRule: HR, evidence: FILED, guidance: "Nghỉ thai sản, ốm dài ngày, nghỉ không lương từ 14 ngày làm việc trong tháng." }),
  template({ code: "EVT-LONG-LEAVE-CLAIM", name: "Hồ sơ hưởng chế độ BHXH (thai sản, ốm đau)", category: "external", authority: "social_insurance", recurrence: "event", eventType: "long_leave", dueRule: afterEvent(45), ownerRule: HR, evidence: FILED, guidance: "Hủy nếu loại nghỉ không có chế độ BHXH (nghỉ không lương, nghỉ phép dài)." }),
  template({ code: "EVT-LONG-LEAVE-RETURN", name: "Báo tăng BHXH khi đi làm lại", category: "external", authority: "social_insurance", recurrence: "event", eventType: "long_leave_return", dueRule: afterEvent(10), ownerRule: HR, evidence: FILED }),
  template({ code: "EVT-SALARY-CHANGE-INSURANCE", name: "Điều chỉnh mức đóng BHXH do thay đổi lương", category: "external", authority: "social_insurance", recurrence: "event", eventType: "salary_change", dueRule: afterEvent(30), ownerRule: HR, evidence: FILED }),
  // Licences and subscriptions (FR-AST-05). The source is the asset module's licence register, not
  // HR: the scheduler pulls one fact per renewal that falls due. Fourteen days *before* the money
  // goes out, which is the point — a subscription that renews itself is decided in advance or not
  // at all. The owner named on the licence takes it; `ASSETS` is only the fallback.
  template({
    code: "EVT-LICENCE-RENEWAL",
    name: "Gia hạn hoặc hủy bản quyền / thuê bao",
    category: "internal",
    authority: "internal",
    recurrence: "event",
    eventType: "licence_renewal",
    dueRule: afterEvent(-14),
    shift: "previous_working_day",
    ownerRule: ASSETS,
    reviewerRule: FINANCE,
    checklist: ["Xác nhận còn dùng hay không", "Rà soát số lượng người dùng thực tế", "Đàm phán giá / đổi gói nếu cần", "Gia hạn hoặc hủy trước ngày đến hạn"],
    evidence: { file: false, reference: false, submittedDate: true, amount: true },
    guidance: "Hạn: 14 ngày trước ngày đến hạn, để kịp quyết định trước khi thuê bao tự động gia hạn. Sinh ra từ Tài sản → Bản quyền & thuê bao.",
    reminderLeadDays: [7, 3, 1],
  }),
];

/** Rows for the `obligation_template` table, in library order. */
export const obligationSeedRows = () => OBLIGATION_LIBRARY.map((row, index) => ({ ...row, reviewStatus: "unreviewed", sortOrder: index }));
