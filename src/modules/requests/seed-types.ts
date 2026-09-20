// The request types the company actually files (FR-REQ-02), as starter configuration. Plain data:
// no I/O. Seeded once per code by `pnpm db:seed`; an administrator edits them afterwards on
// Admin → Request types, and an edited or switched-off type is never touched again.
//
// Each type ships its **flow** too, saved as an ordinary group-wide `approval_flow` row for
// `request:<code>` — the approval engine already owns flows and the builder does not fork it.
// The thresholds below are the company's current practice as far as this build knows it; they are
// configuration precisely so that the owner can correct them without a deployment.
import type { FlowDefinition } from "@/modules/platform/approvals/engine/flow";
import type { FormDefinition } from "./engine/form";

export type RequestTypeSeed = {
  code: string;
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  category: string;
  icon: string;
  sortOrder: number;
  form: FormDefinition;
  flow: FlowDefinition;
  slaRemindAfterDays: number;
  slaEscalateAfterDays: number;
  /** Whoever the request is escalated to when nobody has answered. */
  slaEscalateTo: { rule: string; [key: string]: unknown } | null;
};

const finance = { rule: "permission", permission: "payroll:pay" } as const;
const ceo = { rule: "role", role: "c_level" } as const;
const hr = { rule: "permission", permission: "person:manage" } as const;

// Above this, the CEO signs as well. Twenty million đồng — the owner moves it on the flow screen.
const CEO_THRESHOLD = 20_000_000;

export const REQUEST_TYPE_SEED: RequestTypeSeed[] = [
  {
    code: "purchase",
    nameVi: "Đề nghị mua sắm",
    nameEn: "Purchase request",
    descriptionVi: "Đề nghị mua thiết bị, phần mềm, vật tư hoặc dịch vụ cho công việc.",
    descriptionEn: "A request to buy equipment, software, supplies or a service for work.",
    category: "purchase",
    icon: "shopping-cart",
    sortOrder: 10,
    form: {
      fields: [
        { key: "item", type: "text", labelVi: "Hạng mục cần mua", labelEn: "What is being bought", required: true, maxLength: 160 },
        { key: "quantity", type: "number", labelVi: "Số lượng", labelEn: "Quantity", required: true, min: 1, max: 9999 },
        { key: "amount", type: "money", labelVi: "Số tiền dự kiến (VNĐ)", labelEn: "Estimated amount (VND)", required: true, min: 0 },
        {
          key: "category",
          type: "select",
          labelVi: "Nhóm chi phí",
          labelEn: "Cost category",
          required: true,
          options: [
            { value: "equipment", labelVi: "Thiết bị sản xuất", labelEn: "Production equipment" },
            { value: "it", labelVi: "Máy tính, phần mềm", labelEn: "Computers and software" },
            { value: "office", labelVi: "Văn phòng phẩm, nội thất", labelEn: "Office supplies and furniture" },
            { value: "service", labelVi: "Dịch vụ thuê ngoài", labelEn: "Outsourced service" },
            { value: "other", labelVi: "Khác", labelEn: "Other" },
          ],
        },
        { key: "supplier", type: "text", labelVi: "Nhà cung cấp dự kiến", labelEn: "Proposed supplier", maxLength: 160 },
        { key: "needed_by", type: "date", labelVi: "Cần có trước ngày", labelEn: "Needed by", required: true },
        { key: "reason", type: "textarea", labelVi: "Lý do / mục đích sử dụng", labelEn: "Why it is needed", required: true, minLength: 10, maxLength: 2000 },
        { key: "quote", type: "file", labelVi: "Báo giá đính kèm", labelEn: "Quotation", hintVi: "PDF hoặc ảnh báo giá, nếu có.", hintEn: "A PDF or photo of the quotation, if there is one." },
      ],
    },
    flow: {
      steps: [
        { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
        { key: "finance", mode: "any", approvers: [finance] },
        { key: "ceo", mode: "any", approvers: [ceo], condition: { field: "amount", op: "gt", value: CEO_THRESHOLD } },
      ],
    },
    slaRemindAfterDays: 2,
    slaEscalateAfterDays: 5,
    slaEscalateTo: { rule: "manager_level", level: 2 },
  },
  {
    code: "payment",
    nameVi: "Đề nghị thanh toán",
    nameEn: "Payment request",
    descriptionVi: "Đề nghị chi tiền cho một khoản đã phát sinh: hóa đơn nhà cung cấp, chi phí dự án, tạm ứng đã quyết toán.",
    descriptionEn: "A request to pay something that has already been incurred: a supplier invoice, a project cost, a settled advance.",
    category: "finance",
    icon: "banknote",
    sortOrder: 20,
    form: {
      fields: [
        { key: "payee", type: "text", labelVi: "Người / đơn vị thụ hưởng", labelEn: "Who is being paid", required: true, maxLength: 160 },
        { key: "amount", type: "money", labelVi: "Số tiền (VNĐ)", labelEn: "Amount (VND)", required: true, min: 1 },
        {
          key: "method",
          type: "select",
          labelVi: "Hình thức",
          labelEn: "Method",
          required: true,
          options: [
            { value: "transfer", labelVi: "Chuyển khoản", labelEn: "Bank transfer" },
            { value: "cash", labelVi: "Tiền mặt", labelEn: "Cash" },
          ],
        },
        { key: "bank_account", type: "text", labelVi: "Số tài khoản và ngân hàng", labelEn: "Account number and bank", maxLength: 160, visibleWhen: { field: "method", op: "eq", value: "transfer" } },
        { key: "due_date", type: "date", labelVi: "Hạn thanh toán", labelEn: "Due date", required: true },
        { key: "purpose", type: "textarea", labelVi: "Nội dung thanh toán", labelEn: "What the payment is for", required: true, minLength: 10, maxLength: 2000 },
        { key: "invoice", type: "file", labelVi: "Hóa đơn / chứng từ", labelEn: "Invoice or receipt", required: true },
      ],
    },
    flow: {
      steps: [
        { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
        { key: "finance", mode: "any", approvers: [finance] },
        { key: "ceo", mode: "any", approvers: [ceo], condition: { field: "amount", op: "gt", value: CEO_THRESHOLD } },
      ],
    },
    slaRemindAfterDays: 2,
    slaEscalateAfterDays: 4,
    slaEscalateTo: { rule: "role", role: "c_level" },
  },
  {
    code: "confirmation_letter",
    nameVi: "Đề nghị cấp giấy xác nhận",
    nameEn: "Confirmation letter request",
    descriptionVi: "Xin giấy xác nhận công tác, xác nhận thu nhập, hoặc thư giới thiệu để làm visa, vay vốn, thuê nhà.",
    descriptionEn: "A letter confirming employment or income, or an introduction letter for a visa, a loan or a tenancy.",
    category: "hr",
    icon: "file-text",
    sortOrder: 30,
    form: {
      fields: [
        {
          key: "letter_kind",
          type: "select",
          labelVi: "Loại giấy cần cấp",
          labelEn: "Kind of letter",
          required: true,
          // Week 3 generates the document itself; the salary letter is compensation tier and only
          // a reader who holds that tier may ever see the figure.
          options: [
            { value: "employment", labelVi: "Xác nhận đang công tác", labelEn: "Confirmation of employment" },
            { value: "salary", labelVi: "Xác nhận thu nhập (có số lương)", labelEn: "Confirmation of income (states the salary)" },
            { value: "introduction", labelVi: "Thư giới thiệu", labelEn: "Introduction letter" },
          ],
        },
        { key: "addressed_to", type: "text", labelVi: "Gửi tới (tên cơ quan / đơn vị)", labelEn: "Addressed to", required: true, maxLength: 200 },
        {
          key: "language",
          type: "select",
          labelVi: "Ngôn ngữ",
          labelEn: "Language",
          required: true,
          options: [
            { value: "vi", labelVi: "Tiếng Việt", labelEn: "Vietnamese" },
            { value: "en", labelVi: "Tiếng Anh", labelEn: "English" },
            { value: "both", labelVi: "Song ngữ", labelEn: "Bilingual" },
          ],
        },
        { key: "copies", type: "number", labelVi: "Số bản", labelEn: "Number of copies", required: true, min: 1, max: 10 },
        { key: "needed_by", type: "date", labelVi: "Cần có trước ngày", labelEn: "Needed by", required: true },
        { key: "purpose", type: "textarea", labelVi: "Mục đích sử dụng", labelEn: "What it is for", maxLength: 1000 },
      ],
    },
    // HR issues it; a letter that states a salary is signed by the CEO as well, because it leaves
    // the company with a figure on it.
    flow: {
      steps: [
        { key: "hr", mode: "any", approvers: [hr] },
        { key: "ceo", mode: "any", approvers: [ceo], condition: { field: "letter_kind", op: "eq", value: "salary" } },
      ],
    },
    slaRemindAfterDays: 2,
    slaEscalateAfterDays: 4,
    slaEscalateTo: { rule: "role", role: "hr_admin" },
  },
  {
    code: "advance",
    nameVi: "Đề nghị tạm ứng",
    nameEn: "Advance request",
    descriptionVi: "Tạm ứng tiền cho công tác, mua hàng hoặc chi phí sản xuất; quyết toán sau khi hoàn thành.",
    descriptionEn: "Money advanced for a trip, a purchase or a production cost, settled once it is done.",
    category: "finance",
    icon: "wallet",
    sortOrder: 40,
    form: {
      fields: [
        { key: "amount", type: "money", labelVi: "Số tiền tạm ứng (VNĐ)", labelEn: "Amount advanced (VND)", required: true, min: 1 },
        { key: "purpose", type: "textarea", labelVi: "Lý do tạm ứng", labelEn: "What the advance is for", required: true, minLength: 10, maxLength: 2000 },
        { key: "settle_by", type: "date", labelVi: "Cam kết quyết toán trước ngày", labelEn: "To be settled by", required: true },
        {
          key: "method",
          type: "select",
          labelVi: "Nhận bằng",
          labelEn: "Paid out as",
          required: true,
          options: [
            { value: "transfer", labelVi: "Chuyển khoản", labelEn: "Bank transfer" },
            { value: "cash", labelVi: "Tiền mặt", labelEn: "Cash" },
          ],
        },
        { key: "agree", type: "checkbox", labelVi: "Tôi cam kết quyết toán đúng hạn và hoàn trả phần chưa sử dụng", labelEn: "I undertake to settle on time and return whatever is unused", required: true },
      ],
    },
    flow: {
      steps: [
        { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
        { key: "finance", mode: "any", approvers: [finance] },
        { key: "ceo", mode: "any", approvers: [ceo], condition: { field: "amount", op: "gt", value: CEO_THRESHOLD } },
      ],
    },
    slaRemindAfterDays: 1,
    slaEscalateAfterDays: 3,
    slaEscalateTo: { rule: "role", role: "c_level" },
  },
  {
    code: "business_trip",
    nameVi: "Đề nghị đi công tác",
    nameEn: "Business trip request",
    descriptionVi: "Đăng ký chuyến công tác: nơi đến, thời gian, phương tiện và chi phí dự kiến.",
    descriptionEn: "A trip for work: where, when, how, and what it is expected to cost.",
    category: "admin",
    icon: "plane",
    sortOrder: 50,
    form: {
      fields: [
        { key: "destination", type: "text", labelVi: "Nơi đến", labelEn: "Destination", required: true, maxLength: 160 },
        { key: "start_date", type: "date", labelVi: "Từ ngày", labelEn: "From", required: true },
        { key: "end_date", type: "date", labelVi: "Đến ngày", labelEn: "To", required: true },
        {
          key: "transport",
          type: "multi_select",
          labelVi: "Phương tiện",
          labelEn: "Transport",
          required: true,
          options: [
            { value: "plane", labelVi: "Máy bay", labelEn: "Plane" },
            { value: "train", labelVi: "Tàu hỏa", labelEn: "Train" },
            { value: "car", labelVi: "Ô tô công ty", labelEn: "Company car" },
            { value: "other", labelVi: "Khác", labelEn: "Other" },
          ],
        },
        { key: "amount", type: "money", labelVi: "Chi phí dự kiến (VNĐ)", labelEn: "Estimated cost (VND)", required: true, min: 0 },
        { key: "needs_accommodation", type: "checkbox", labelVi: "Cần đặt chỗ ở", labelEn: "Accommodation needed" },
        { key: "accommodation_note", type: "text", labelVi: "Ghi chú về chỗ ở", labelEn: "Accommodation note", maxLength: 300, visibleWhen: { field: "needs_accommodation", op: "eq", value: true } },
        { key: "purpose", type: "textarea", labelVi: "Nội dung công việc", labelEn: "What the trip is for", required: true, minLength: 10, maxLength: 2000 },
      ],
    },
    flow: {
      steps: [
        { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
        { key: "department_head", mode: "any", approvers: [{ rule: "department_head" }] },
        { key: "finance", mode: "any", approvers: [finance], condition: { field: "amount", op: "gt", value: 5_000_000 } },
      ],
    },
    slaRemindAfterDays: 1,
    slaEscalateAfterDays: 3,
    slaEscalateTo: { rule: "manager_level", level: 2 },
  },
  {
    // FR-REQ-03. The only seeded type whose approval *does* something: it becomes a line in the
    // entity's open payroll run. Its figure is the lines added up, so the form asks for no total —
    // the money field a generic type would carry is deliberately absent here.
    code: "expense_claim",
    nameVi: "Đề nghị thanh toán chi phí",
    nameEn: "Expense claim",
    descriptionVi: "Hoàn lại tiền bạn đã chi hộ công ty. Kê từng khoản kèm hóa đơn; tiền được trả cùng kỳ lương gần nhất.",
    descriptionEn: "Money you spent on the company's behalf. List each item with its receipt; it is paid back in the next payroll run.",
    category: "finance",
    icon: "receipt",
    sortOrder: 35,
    form: {
      fields: [
        { key: "title", type: "text", labelVi: "Nội dung đề nghị", labelEn: "What the claim is for", required: true, minLength: 3, maxLength: 160, hintVi: "Ví dụ: Công tác Đà Nẵng 12–14/09", hintEn: "For example: Da Nang trip, 12–14 September" },
        { key: "project_tag", type: "text", labelVi: "Dự án / khách hàng", labelEn: "Project or client", maxLength: 60 },
        { key: "note", type: "textarea", labelVi: "Ghi chú cho người duyệt", labelEn: "Note for the approver", maxLength: 2000 },
      ],
    },
    flow: {
      steps: [
        { key: "manager", mode: "any", approvers: [{ rule: "line_manager" }] },
        // Finance settles it, so finance sees every claim — not only the large ones.
        { key: "finance", mode: "any", approvers: [finance] },
        { key: "ceo", mode: "any", approvers: [ceo], condition: { field: "amount", op: "gt", value: CEO_THRESHOLD } },
      ],
    },
    slaRemindAfterDays: 2,
    slaEscalateAfterDays: 5,
    slaEscalateTo: { rule: "manager_level", level: 2 },
  },
];
