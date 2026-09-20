// Starter document templates (FR-CHR-06), group-wide, in Vietnamese. Seeded once per code by
// `pnpm db:seed`; HR edits them afterwards on Admin → Document templates. Plain data: no I/O.
//
// A DRAFT. The wording below is a plausible Vietnamese business letter, not legal advice — the
// labour contract especially is a skeleton, and the note on each says so. What is *not* a draft is
// the tier on each template: `XN-LUONG` is `compensation` because it prints a salary, and the
// engine would refuse to store it any lower.
import type { TemplateInput } from "./service";

const LETTERHEAD = {
  companyName: "CÔNG TY TNHH SUZU MEDIA",
  address: "123 Nguyễn Văn Trỗi, Phường 8, Quận Phú Nhuận, TP. Hồ Chí Minh",
  taxCode: "0312345678",
  phone: "028 1234 5678",
  representative: "Nguyễn Thu Hà",
  representativeTitle: "Tổng Giám đốc",
  place: "TP. Hồ Chí Minh",
};

const DRAFT = "\n\n(Mẫu nháp — cần Trưởng phòng Nhân sự rà soát câu chữ và căn cứ pháp lý trước khi dùng chính thức.)";

export const DOCUMENT_TEMPLATE_SEED: TemplateInput[] = [
  {
    code: "XN-CONG-TAC",
    name: "Giấy xác nhận công tác",
    entityId: null,
    kind: "confirmation_letter",
    // A name, a job title and a start date. No money, so anyone who keeps the person's record may issue it.
    tier: "personal",
    isActive: true,
    letterhead: LETTERHEAD,
    body: `{{company.name}} xác nhận:

Ông/Bà: {{person.fullName}}
Mã nhân viên: {{person.employeeCode}}
Chức danh: {{person.position}}
Bộ phận: {{person.department}}

Hiện đang làm việc tại {{company.name}} theo hình thức {{employment.type}}, kể từ ngày {{employment.startDate}} cho đến nay.

Giấy xác nhận này được cấp theo đề nghị của Ông/Bà {{person.fullName}} để sử dụng vào mục đích cá nhân. {{company.name}} không chịu trách nhiệm về việc sử dụng giấy xác nhận này ngoài mục đích nêu trên.${DRAFT}`,
  },
  {
    code: "XN-LUONG",
    name: "Giấy xác nhận thu nhập",
    entityId: null,
    kind: "confirmation_letter",
    // It prints a salary. The engine refuses to store this below `compensation`, so a line manager
    // or an HR officer without the tier cannot generate it, cannot open one, and is not even shown
    // that one exists.
    tier: "compensation",
    isActive: true,
    letterhead: LETTERHEAD,
    body: `{{company.name}} xác nhận:

Ông/Bà: {{person.fullName}}
Mã nhân viên: {{person.employeeCode}}
Chức danh: {{person.position}}
Bộ phận: {{person.department}}
Ngày vào làm việc: {{employment.startDate}}

Mức thu nhập hiện tại (áp dụng từ ngày {{salary.effectiveFrom}}):
- Lương cơ bản: {{salary.base}} đồng/tháng
- Phụ cấp: {{salary.allowances}} đồng/tháng
- Tổng thu nhập: {{salary.total}} đồng/tháng
  (Bằng chữ: {{salary.totalInWords}})

Giấy xác nhận này được cấp theo đề nghị của Ông/Bà {{person.fullName}} để làm thủ tục vay vốn, xin thị thực hoặc các mục đích cá nhân hợp pháp khác.${DRAFT}`,
  },
  {
    code: "QD-BO-NHIEM",
    name: "Quyết định bổ nhiệm",
    entityId: null,
    kind: "decision",
    tier: "personal",
    isActive: true,
    letterhead: LETTERHEAD,
    body: `QUYẾT ĐỊNH
Về việc bổ nhiệm cán bộ

{{company.representativeTitle}} {{company.name}}

Căn cứ Điều lệ tổ chức và hoạt động của {{company.name}};
Căn cứ nhu cầu tổ chức nhân sự của Công ty;
Xét năng lực và phẩm chất của cán bộ,

QUYẾT ĐỊNH:

Điều 1. Bổ nhiệm Ông/Bà {{person.fullName}}, mã nhân viên {{person.employeeCode}}, giữ chức vụ {{person.position}} thuộc {{person.department}}.

Điều 2. Ông/Bà {{person.fullName}} có trách nhiệm bàn giao, tiếp nhận công việc và thực hiện nhiệm vụ theo phân công của Công ty.

Điều 3. Quyết định này có hiệu lực kể từ ngày ký. Các bộ phận liên quan và Ông/Bà có tên tại Điều 1 chịu trách nhiệm thi hành quyết định này.${DRAFT}`,
  },
  {
    code: "QD-THOI-VIEC",
    name: "Quyết định thôi việc",
    entityId: null,
    kind: "decision",
    tier: "personal",
    isActive: true,
    letterhead: LETTERHEAD,
    body: `QUYẾT ĐỊNH
Về việc chấm dứt hợp đồng lao động

{{company.representativeTitle}} {{company.name}}

Căn cứ Bộ luật Lao động hiện hành;
Căn cứ hợp đồng lao động đã ký giữa Công ty và người lao động;
Xét đơn xin nghỉ việc của Ông/Bà {{person.fullName}},

QUYẾT ĐỊNH:

Điều 1. Chấm dứt hợp đồng lao động với Ông/Bà {{person.fullName}}, mã nhân viên {{person.employeeCode}}, chức danh {{person.position}}, bộ phận {{person.department}}, kể từ ngày {{employment.endDate}}.

Điều 2. Công ty có trách nhiệm thanh toán đầy đủ các khoản lương, phép năm chưa nghỉ và các chế độ khác theo quy định; chốt và trả sổ bảo hiểm xã hội cho người lao động.

Điều 3. Ông/Bà {{person.fullName}} có trách nhiệm bàn giao công việc, tài liệu và tài sản của Công ty trước ngày nêu tại Điều 1.

Điều 4. Quyết định này có hiệu lực kể từ ngày ký.${DRAFT}`,
  },
  {
    code: "HD-LAO-DONG",
    name: "Hợp đồng lao động (khung)",
    entityId: null,
    kind: "contract",
    // A contract states the salary, so it too is compensation tier.
    tier: "compensation",
    isActive: true,
    letterhead: LETTERHEAD,
    body: `HỢP ĐỒNG LAO ĐỘNG
Số: {{document.number}}

Hôm nay, ngày {{document.date}}, tại {{document.place}}, chúng tôi gồm:

BÊN A — NGƯỜI SỬ DỤNG LAO ĐỘNG
Tên đơn vị: {{company.name}}
Địa chỉ: {{company.address}}
Mã số thuế: {{company.taxCode}}
Người đại diện: {{company.representative}} — Chức vụ: {{company.representativeTitle}}

BÊN B — NGƯỜI LAO ĐỘNG
Họ và tên: {{person.fullName}}
Ngày sinh: {{person.dateOfBirth}}
Mã nhân viên: {{person.employeeCode}}
Email công việc: {{person.workEmail}}

Hai bên thỏa thuận ký kết hợp đồng lao động với các điều khoản sau:

Điều 1. Công việc và địa điểm làm việc
Chức danh chuyên môn: {{person.position}}
Bộ phận: {{person.department}}
Loại hợp đồng: {{employment.type}}
Ngày bắt đầu làm việc: {{employment.startDate}}

Điều 2. Chế độ tiền lương
Lương cơ bản: {{salary.base}} đồng/tháng
Phụ cấp: {{salary.allowances}} đồng/tháng
Tổng thu nhập: {{salary.total}} đồng/tháng (bằng chữ: {{salary.totalInWords}})
Mức lương đóng bảo hiểm xã hội: {{salary.insurance}} đồng/tháng
Hình thức trả lương: chuyển khoản, một lần vào ngày 05 hằng tháng.

Điều 3. Thời giờ làm việc, nghỉ ngơi, bảo hiểm và các chế độ khác
Thực hiện theo nội quy lao động của Công ty và quy định của pháp luật hiện hành.

Điều 4. Nghĩa vụ và quyền hạn của hai bên
Thực hiện theo Bộ luật Lao động và các thỏa thuận tại hợp đồng này.

Hợp đồng được lập thành 02 bản có giá trị như nhau, mỗi bên giữ 01 bản.${DRAFT}`,
  },
];
