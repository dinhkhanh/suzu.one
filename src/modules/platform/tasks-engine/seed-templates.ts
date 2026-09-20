// Starter checklists (FR-CHR-10/11), group-wide, in Vietnamese. Seeded once per purpose by
// `pnpm db:seed`; HR edits them afterwards on Admin → Checklist templates. Plain data: no I/O.
type SeedItem = { title: string; assigneeRule: string; dueOffsetDays: number; description?: string };

const hr = "permission:person:manage";

export const TEMPLATE_SEED: { purpose: string; name: string; items: SeedItem[] }[] = [
  {
    purpose: "onboarding",
    name: "Tiếp nhận nhân sự mới (mặc định)",
    // Anchor = the first working day.
    items: [
      { title: "Tạo tài khoản Google Workspace và cấp quyền hệ thống", assigneeRule: hr, dueOffsetDays: -3 },
      { title: "Chuẩn bị máy tính, thiết bị và chỗ ngồi", assigneeRule: hr, dueOffsetDays: -2 },
      { title: "Ký hợp đồng / thỏa thuận thử việc và thu hồ sơ cá nhân", assigneeRule: hr, dueOffsetDays: 0 },
      { title: "Lập kế hoạch tuần đầu tiên và giới thiệu với nhóm", assigneeRule: "line_manager", dueOffsetDays: 0 },
      { title: "Kiểm tra và bổ sung thông tin cá nhân trên SuZu One", assigneeRule: "subject", dueOffsetDays: 2, description: "Mở Hồ sơ của tôi, gửi yêu cầu chỉnh sửa nếu có thông tin sai hoặc thiếu." },
      { title: "Đọc và xác nhận nội quy lao động, quy định bảo mật", assigneeRule: "subject", dueOffsetDays: 5 },
      { title: "Đăng ký tham gia bảo hiểm xã hội (nếu thuộc diện)", assigneeRule: hr, dueOffsetDays: 25 },
      { title: "Trao đổi sau 30 ngày: mục tiêu và phản hồi", assigneeRule: "line_manager", dueOffsetDays: 30 },
    ],
  },
  {
    purpose: "offboarding",
    name: "Thôi việc (mặc định)",
    // Anchor = the last working day.
    items: [
      { title: "Bàn giao công việc, tài liệu và tài khoản dự án", assigneeRule: "subject", dueOffsetDays: -3 },
      { title: "Xác nhận đã nhận bàn giao", assigneeRule: "line_manager", dueOffsetDays: -1 },
      { title: "Thu hồi thiết bị và tài sản công ty", assigneeRule: hr, dueOffsetDays: 0 },
      { title: "Phỏng vấn thôi việc", assigneeRule: hr, dueOffsetDays: 0 },
      { title: "Thu hồi tài khoản Google Workspace và quyền truy cập các hệ thống khác", assigneeRule: hr, dueOffsetDays: 1, description: "Quyền truy cập SuZu One tự khóa sau ngày làm việc cuối cùng." },
      { title: "Quyết toán lương, phép năm còn lại và các khoản khác", assigneeRule: hr, dueOffsetDays: 5 },
      { title: "Báo giảm bảo hiểm và chốt sổ BHXH", assigneeRule: hr, dueOffsetDays: 14 },
      { title: "Ban hành quyết định thôi việc và trả hồ sơ", assigneeRule: hr, dueOffsetDays: 14 },
    ],
  },
];
