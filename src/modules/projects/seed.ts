// The plan half of the starter project templates (FR-PJM-15), in Vietnamese: phases, milestones,
// register lines, hours by role and the brief to start from. Days count from the same day 0 as the
// template's steps (work/seed-templates.ts). Seeded once per template by `pnpm db:seed`: a
// template that already has a plan half — perhaps edited by its team — is left alone. The fifth
// starter, "Bài đăng social (một bài)", is a task template and has no plan half.
//
// Relative imports only: the seed script runs outside the app's path aliases.
import { and, eq, inArray } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { documentTemplate } from "../documents/schema";
import { taskTemplate } from "../platform/tasks-engine/schema";
import { type ProjectBrief, projectTemplatePlan, type RoleBudget, type TemplateLine, type TemplateMilestone, type TemplatePhase } from "./schema";

type SeedPlan = { kind: "client" | "retainer" | "pitch" | "internal"; updateCadenceDays: number; phases: TemplatePhase[]; milestones: TemplateMilestone[]; deliverables: TemplateLine[]; budgetByRole: RoleBudget[]; brief: ProjectBrief };
const hours = (value: number) => value * 60;

export const PROJECT_TEMPLATE_PLAN_SEED: Record<string, SeedPlan> = {
  "Retainer social hàng tháng": {
    kind: "retainer",
    updateCadenceDays: 7,
    phases: [
      { name: "Lên kế hoạch tháng", startDay: -7, endDay: -3 },
      { name: "Sản xuất và đăng đợt 1", startDay: -2, endDay: 13 },
      { name: "Sản xuất và đăng đợt 2", startDay: 10, endDay: 30 },
      { name: "Báo cáo và nghiệm thu", startDay: 31, endDay: 35 },
    ],
    milestones: [
      { name: "Khách hàng duyệt kế hoạch nội dung tháng", day: -3, phase: 0, isClientFacing: true, isBilling: false },
      { name: "Nội dung đợt 1 được duyệt", day: 0, phase: 1, isClientFacing: true, isBilling: false },
      { name: "Nội dung đợt 2 được duyệt", day: 14, phase: 2, isClientFacing: true, isBilling: false },
      { name: "Nghiệm thu tháng", day: 35, phase: 3, isClientFacing: true, isBilling: true },
    ],
    deliverables: [
      { title: "Bài đăng Facebook", quantity: 12, format: "post", channel: "facebook", milestone: 3, day: 30 },
      { title: "Video ngắn TikTok", quantity: 4, format: "short_video", channel: "tiktok", milestone: 3, day: 30 },
      { title: "Báo cáo tháng", quantity: 1, format: "article", channel: null, milestone: 3, day: 33 },
    ],
    budgetByRole: [
      { role: "Account", minutes: hours(12) },
      { role: "Chiến lược nội dung", minutes: hours(21) },
      { role: "Copywriter", minutes: hours(20) },
      { role: "Thiết kế", minutes: hours(24) },
      { role: "Dựng video", minutes: hours(16) },
      { role: "Quản trị cộng đồng", minutes: hours(20) },
      { role: "Quảng cáo", minutes: hours(8) },
    ],
    brief: {
      objective: "Duy trì và phát triển kênh social của nhãn hàng trong tháng: tăng tương tác, giữ nhịp đăng đều và đúng giọng thương hiệu.",
      scopeIn: "Kế hoạch nội dung tháng; 12 bài đăng Facebook; 4 video ngắn TikTok; quản trị bình luận, tin nhắn trong giờ làm việc; tối ưu quảng cáo theo ngân sách khách hàng duyệt; báo cáo giữa tháng và cuối tháng.",
      scopeOut: "Ngân sách chạy quảng cáo (khách hàng trả trực tiếp cho nền tảng); quay chụp ngoài studio; xử lý khủng hoảng truyền thông.",
      successCriteria: "Đăng đúng lịch 100%; tỷ lệ tương tác trung bình không thấp hơn tháng trước; phản hồi bình luận trong 2 giờ làm việc.",
      assumptions: "Khách hàng phản hồi kế hoạch và nội dung trong 2 ngày làm việc; tài nguyên thương hiệu (logo, font, hình sản phẩm) được cung cấp trước ngày 0.",
    },
  },
  "Sản xuất video / TVC": {
    kind: "client",
    updateCadenceDays: 7,
    phases: [
      { name: "Tiền kỳ", startDay: 0, endDay: 12 },
      { name: "Sản xuất (quay)", startDay: 13, endDay: 15 },
      { name: "Hậu kỳ", startDay: 16, endDay: 27 },
      { name: "Bàn giao", startDay: 28, endDay: 30 },
    ],
    milestones: [
      { name: "Khách hàng duyệt kịch bản và storyboard", day: 9, phase: 0, isClientFacing: true, isBilling: false },
      { name: "Họp PPM", day: 12, phase: 0, isClientFacing: true, isBilling: false },
      { name: "Ngày quay", day: 15, phase: 1, isClientFacing: false, isBilling: false },
      { name: "Khách hàng duyệt bản hoàn thiện", day: 27, phase: 2, isClientFacing: true, isBilling: false },
      { name: "Bàn giao bản master và nghiệm thu", day: 30, phase: 3, isClientFacing: true, isBilling: true },
    ],
    deliverables: [
      { title: "TVC 30 giây (bản master)", quantity: 1, format: "tvc", channel: null, milestone: 4, day: 30 },
      { title: "Bản cắt ngắn 15 giây / 6 giây", quantity: 3, format: "short_video", channel: null, milestone: 4, day: 30 },
      { title: "Phiên bản theo nền tảng (9:16, 1:1)", quantity: 2, format: "short_video", channel: "facebook", milestone: 4, day: 30 },
    ],
    budgetByRole: [
      { role: "Account", minutes: hours(7) },
      { role: "Copywriter", minutes: hours(16) },
      { role: "Đạo diễn", minutes: hours(26) },
      { role: "Sản xuất", minutes: hours(22) },
      { role: "Dựng phim", minutes: hours(36) },
    ],
    brief: {
      objective: "Sản xuất video/TVC truyền tải thông điệp chính của chiến dịch, đúng nhận diện thương hiệu và sẵn sàng phát sóng trên các nền tảng đã thống nhất.",
      scopeIn: "Ý tưởng và kịch bản; storyboard/shot list; tổ chức một ngày quay; dựng, chỉnh màu, âm thanh, đồ họa; hai vòng chỉnh sửa với khách hàng; xuất bản master và các phiên bản theo nền tảng.",
      scopeOut: "Mua bản quyền nhạc thương mại ngoài thư viện; thuê diễn viên nổi tiếng; chi phí phát sóng; vòng chỉnh sửa thứ ba trở đi (tính phát sinh).",
      successCriteria: "Khách hàng duyệt bản hoàn thiện trong tối đa hai vòng; bàn giao đúng hạn, đủ định dạng và thời lượng đã cam kết.",
      assumptions: "Khách hàng duyệt kịch bản trước ngày 9; ngày quay không đổi sau buổi PPM.",
    },
  },
  "Chiến dịch KOL / KOC": {
    kind: "client",
    updateCadenceDays: 7,
    phases: [
      { name: "Lên kế hoạch và chọn KOL", startDay: -21, endDay: -14 },
      { name: "Booking và sản xuất nội dung", startDay: -13, endDay: -1 },
      { name: "Lên sóng và khuếch đại", startDay: 0, endDay: 13 },
      { name: "Báo cáo và nghiệm thu", startDay: 14, endDay: 21 },
    ],
    milestones: [
      { name: "Khách hàng duyệt danh sách KOL", day: -14, phase: 0, isClientFacing: true, isBilling: false },
      { name: "Hợp đồng KOL đã ký", day: -10, phase: 1, isClientFacing: false, isBilling: false },
      { name: "Nội dung KOL được duyệt", day: -3, phase: 1, isClientFacing: true, isBilling: false },
      { name: "Bài đăng đầu tiên lên sóng", day: 0, phase: 2, isClientFacing: true, isBilling: false },
      { name: "Báo cáo chiến dịch và nghiệm thu", day: 21, phase: 3, isClientFacing: true, isBilling: true },
    ],
    deliverables: [
      { title: "Bài đăng của KOL", quantity: 5, format: "post", channel: "facebook", milestone: 3, day: 0 },
      { title: "Video ngắn của KOC", quantity: 10, format: "short_video", channel: "tiktok", milestone: 3, day: 7 },
      { title: "Báo cáo chiến dịch", quantity: 1, format: "article", channel: null, milestone: 4, day: 18 },
    ],
    budgetByRole: [
      { role: "Account", minutes: hours(13) },
      { role: "Chiến lược", minutes: hours(22) },
      { role: "Booking", minutes: hours(16) },
      { role: "Copywriter", minutes: hours(8) },
      { role: "Quản trị cộng đồng", minutes: hours(6) },
      { role: "Quảng cáo", minutes: hours(6) },
    ],
    brief: {
      objective: "Tăng độ nhận biết và lượt thảo luận về sản phẩm thông qua KOL/KOC phù hợp với tệp khách hàng mục tiêu.",
      scopeIn: "Đề xuất danh sách KOL kèm số liệu; đàm phán và booking; brief nội dung; duyệt nội dung nháp; theo dõi lịch đăng; khuếch đại bằng quảng cáo; báo cáo chiến dịch.",
      scopeOut: "Phí KOL (thanh toán theo hợp đồng riêng); sản xuất TVC; xử lý khủng hoảng liên quan đến cá nhân KOL.",
      successCriteria: "100% bài đăng đúng lịch và đúng thông điệp; đạt KPI lượt tiếp cận và tương tác đã thống nhất.",
      assumptions: "Khách hàng duyệt danh sách KOL trước ngày -14; sản phẩm mẫu được giao cho KOL trước ngày -7.",
    },
  },
  "Sự kiện": {
    kind: "client",
    updateCadenceDays: 7,
    phases: [
      { name: "Concept và đề xuất", startDay: -45, endDay: -33 },
      { name: "Chuẩn bị", startDay: -32, endDay: -1 },
      { name: "Ngày sự kiện", startDay: 0, endDay: 0 },
      { name: "Hậu sự kiện", startDay: 1, endDay: 14 },
    ],
    milestones: [
      { name: "Khách hàng duyệt concept và ngân sách", day: -33, phase: 0, isClientFacing: true, isBilling: true },
      { name: "Chốt địa điểm và giấy phép", day: -30, phase: 1, isClientFacing: false, isBilling: false },
      { name: "Chốt nhà cung cấp", day: -14, phase: 1, isClientFacing: false, isBilling: false },
      { name: "Tổng duyệt", day: -1, phase: 1, isClientFacing: true, isBilling: false },
      { name: "Diễn ra sự kiện", day: 0, phase: 2, isClientFacing: true, isBilling: false },
      { name: "Báo cáo và nghiệm thu", day: 14, phase: 3, isClientFacing: true, isBilling: true },
    ],
    deliverables: [
      { title: "Key visual, backdrop và ấn phẩm", quantity: 1, format: "key_visual", channel: "offline", milestone: 3, day: -5 },
      { title: "Sự kiện diễn ra theo kịch bản", quantity: 1, format: "other", channel: "offline", milestone: 4, day: 0 },
      { title: "Video recap", quantity: 1, format: "short_video", channel: null, milestone: 5, day: 5 },
      { title: "Album ảnh sự kiện", quantity: 1, format: "photo_album", channel: null, milestone: 5, day: 5 },
      { title: "Báo cáo sau sự kiện", quantity: 1, format: "article", channel: null, milestone: 5, day: 7 },
    ],
    budgetByRole: [
      { role: "Account", minutes: hours(14) },
      { role: "Chiến lược", minutes: hours(16) },
      { role: "Sản xuất", minutes: hours(36) },
      { role: "Thiết kế", minutes: hours(30) },
      { role: "Booking", minutes: hours(10) },
      { role: "Quản trị cộng đồng", minutes: hours(12) },
      { role: "Dựng phim", minutes: hours(16) },
    ],
    brief: {
      objective: "Tổ chức sự kiện đúng concept, an toàn, đúng ngân sách và tạo nội dung truyền thông sau sự kiện.",
      scopeIn: "Concept và kịch bản chương trình; đề xuất và đặt địa điểm; thiết kế ấn phẩm; booking MC, khách mời, tiết mục; điều phối nhà cung cấp; điều phối tại chỗ; quay chụp và video recap; báo cáo sau sự kiện.",
      scopeOut: "Chi phí địa điểm, ăn uống và quà tặng (theo dự toán khách hàng duyệt riêng); bảo hiểm sự kiện.",
      successCriteria: "Sự kiện diễn ra đúng kịch bản, không sự cố an toàn; đạt số khách tham dự mục tiêu; bàn giao recap trong 5 ngày.",
      assumptions: "Khách hàng duyệt concept và ngân sách trước ngày -33; danh sách khách mời được chốt trước ngày -10.",
    },
  },
};

/**
 * Writes the plan half of each starter template that has none yet. Templates are found by name
 * (as the work seed makes them); a name that does not exist is skipped.
 */
export async function seedProjectTemplatePlans(db: PostgresJsDatabase): Promise<{ seeded: number }> {
  const names = Object.keys(PROJECT_TEMPLATE_PLAN_SEED);
  const templates = await db.select({ id: taskTemplate.id, name: taskTemplate.name }).from(taskTemplate).where(and(eq(taskTemplate.purpose, "work_project"), inArray(taskTemplate.name, names)));
  if (templates.length === 0) return { seeded: 0 };
  const rows = templates.map((template) => ({ templateId: template.id, ...PROJECT_TEMPLATE_PLAN_SEED[template.name] }));
  const inserted = await db.insert(projectTemplatePlan).values(rows).onConflictDoNothing({ target: projectTemplatePlan.templateId }).returning({ templateId: projectTemplatePlan.templateId });
  return { seeded: inserted.length };
}

// ── The biên bản nghiệm thu (FR-PJM-55) ─────────────────────────────────────────────────────
//
// The owner accepted this wording on 2026-09-23 ("ok with current template, may edit later"), so
// it goes to clients as it stands — which is why it no longer carries a "draft" line: a paper a
// client signs may not describe itself as unreviewed. It is still ordinary Vietnamese business
// wording rather than legal advice, and D27 now makes it the door every client invoice passes
// through, so counsel is worth one reading. It lives in the document template library, so HR edits
// its wording and letterhead on Admin → Document templates; the project layer fills it with its own context
// (`acceptance.ts`), the way recruitment fills an offer letter. It prints no money: the amount is
// finance's business, on the billing item, not on the paper the lead hands the client.

/** Code of the acceptance template; the project layer looks it up by this. */
export const ACCEPTANCE_TEMPLATE_CODE = "TM-NGHIEM-THU";

/** The placeholders the project layer fills, beside the letterhead and document ones every template has. */
export const ACCEPTANCE_PLACEHOLDERS = ["project.name", "project.jobNumber", "client.name", "acceptance.scope", "acceptance.items", "acceptance.totals"] as const;

export const ACCEPTANCE_TEMPLATE_BODY = `Hôm nay, ngày {{document.date}}, tại {{document.place}}, chúng tôi gồm có:

BÊN A (BÊN NHẬN BÀN GIAO): {{client.name}}
Đại diện: ........................................ Chức vụ: ..............................

BÊN B (BÊN THỰC HIỆN): {{company.name}}
Địa chỉ: {{company.address}}
Mã số thuế: {{company.taxCode}}
Đại diện: {{company.representative}} Chức vụ: {{company.representativeTitle}}

Hai bên cùng tiến hành nghiệm thu các hạng mục thuộc dự án {{project.name}} (mã dự án {{project.jobNumber}}), phạm vi nghiệm thu: {{acceptance.scope}}, cụ thể như sau:

{{acceptance.items}}

Tổng hợp: {{acceptance.totals}}

Kết luận: Bên A xác nhận Bên B đã thực hiện và bàn giao các hạng mục nêu trên với số lượng Bên A đã duyệt như ghi tại cột "đã duyệt". Các hạng mục chưa được duyệt (nếu có) sẽ được hai bên thống nhất xử lý bằng văn bản riêng. Biên bản này là căn cứ để hai bên thực hiện thanh toán theo hợp đồng hoặc đơn đặt hàng đã ký.

Biên bản được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản.

ĐẠI DIỆN BÊN A                                        ĐẠI DIỆN BÊN B
(Ký, ghi rõ họ tên và đóng dấu nếu có)                (Ký, ghi rõ họ tên và đóng dấu)`;

const ACCEPTANCE_LETTERHEAD = {
  companyName: "CÔNG TY TNHH SUZU MEDIA",
  address: "123 Nguyễn Văn Trỗi, Phường 8, Quận Phú Nhuận, TP. Hồ Chí Minh",
  taxCode: "0312345678",
  phone: "028 1234 5678",
  representative: "Nguyễn Thu Hà",
  representativeTitle: "Tổng Giám đốc",
  place: "TP. Hồ Chí Minh",
};

/**
 * Writes the acceptance template once (an existing code is left as HR edited it). Group-wide: the
 * project's entity supplies its own name, address and tax code when the paper is made.
 *
 * Wiring: `scripts/seed.ts` calls it after the document templates and logs `seeded`.
 * It is inserted here rather than through `saveTemplate` (a seed has no actor); its project,
 * client and acceptance placeholders are in the documents catalogue at public_internal, so it is
 * edited on Admin → Document templates like any other (`acceptance-template.test.ts` holds it there).
 */
export async function seedAcceptanceTemplate(db: PostgresJsDatabase): Promise<{ seeded: number }> {
  const inserted = await db
    .insert(documentTemplate)
    .values({ code: ACCEPTANCE_TEMPLATE_CODE, name: "Biên bản nghiệm thu", entityId: null, kind: "other", tier: "public_internal", body: ACCEPTANCE_TEMPLATE_BODY, letterhead: ACCEPTANCE_LETTERHEAD, isActive: true })
    .onConflictDoNothing({ target: documentTemplate.code })
    .returning({ id: documentTemplate.id });
  return { seeded: inserted.length };
}
