// The starter page templates (FR-KB-09), seeded by `pnpm db:seed`. Written in Markdown and turned
// into documents by the same importer people use. Re-seeding only adds keys that do not exist yet,
// so a template HR rewrote or switched off never comes back.
import { markdownToDoc } from "./engine/markdown";

type TemplateSeed = { key: string; name: string; description: string; markdown: string };

const TEMPLATES: TemplateSeed[] = [
  {
    key: "sop",
    name: "Quy trình (SOP)",
    description: "Quy trình thao tác chuẩn: mục đích, phạm vi, các bước, biểu mẫu.",
    markdown: `## Mục đích

_Quy trình này giúp ai làm được việc gì, tránh được rủi ro nào._

## Phạm vi áp dụng

- Đơn vị / phòng ban áp dụng:
- Trường hợp không áp dụng:

## Vai trò và trách nhiệm

| Vai trò | Trách nhiệm |
|---|---|
| Người thực hiện | |
| Người duyệt | |
| Người được thông báo | |

## Các bước thực hiện

1. **Bước 1 — …** Ai làm, làm gì, trên công cụ nào, trong bao lâu.
2. **Bước 2 — …**
3. **Bước 3 — …**

> [!WARNING]
> Những lỗi thường gặp và cách tránh.

## Biểu mẫu và tài liệu liên quan

- …

## Lịch sử thay đổi

Ghi chú thay đổi được lưu tự động trong **Lịch sử phiên bản** của trang.
`,
  },
  {
    key: "policy",
    name: "Chính sách / quy định",
    description: "Chính sách nội bộ có hiệu lực áp dụng, dùng cho không gian có kiểm soát.",
    markdown: `> [!NOTE]
> Hiệu lực từ ngày: … · Đơn vị ban hành: … · Người phụ trách: …

## 1. Mục đích

## 2. Đối tượng và phạm vi áp dụng

## 3. Nội dung quy định

### 3.1. …

### 3.2. …

## 4. Trách nhiệm thực hiện

| Đối tượng | Trách nhiệm |
|---|---|
| Nhân viên | |
| Quản lý trực tiếp | |
| Phòng Nhân sự | |

## 5. Xử lý vi phạm

## 6. Căn cứ pháp lý và tài liệu liên quan

- Bộ luật Lao động 2019 và các văn bản hướng dẫn hiện hành
- …
`,
  },
  {
    key: "meeting_notes",
    name: "Biên bản họp",
    description: "Thành phần, nội dung trao đổi, quyết định và việc cần làm sau họp.",
    markdown: `**Thời gian:** … · **Địa điểm / link:** … · **Người ghi:** …

## Thành phần tham dự

- …

## Nội dung trao đổi

1. …
2. …

## Quyết định

- …

## Việc cần làm

| Việc | Người phụ trách | Hạn |
|---|---|---|
| | | |

> [!TIP]
> Tạo các việc này trong module **Công việc** để theo dõi đến khi xong.
`,
  },
  {
    key: "campaign_post_mortem",
    name: "Tổng kết chiến dịch (post-mortem)",
    description: "Mục tiêu, kết quả, điều làm tốt, điều cần cải thiện, bài học.",
    markdown: `**Khách hàng / thương hiệu:** … · **Thời gian chạy:** … · **Nhóm thực hiện:** …

## Mục tiêu và kết quả

| Chỉ số | Mục tiêu | Thực tế | Ghi chú |
|---|---:|---:|---|
| Reach | | | |
| Tương tác | | | |
| Chuyển đổi / doanh thu | | | |
| Ngân sách | | | |

## Điều làm tốt

- …

## Điều chưa tốt

- …

## Nguyên nhân gốc

_Hỏi “vì sao” đến khi ra nguyên nhân có thể sửa._

## Bài học và hành động

| Hành động | Người phụ trách | Hạn |
|---|---|---|
| | | |

## Tư liệu

Đính kèm báo cáo số liệu, link thư mục Drive, ấn phẩm tiêu biểu.
`,
  },
  {
    key: "client_playbook",
    name: "Cẩm nang khách hàng (client playbook)",
    description: "Những điều cả nhóm cần biết khi phục vụ một khách hàng.",
    markdown: `## Tổng quan khách hàng

- Ngành hàng, sản phẩm chính:
- Hợp đồng / phạm vi dịch vụ:
- Thời hạn hợp đồng:

## Đầu mối liên hệ

| Họ tên | Vai trò | Kênh liên lạc ưa dùng | Ghi chú |
|---|---|---|---|
| | | | |

## Giọng điệu thương hiệu và những điều cần tránh

- Nên:
- Không nên:

## Quy trình duyệt của khách hàng

1. …
2. …

> [!WARNING]
> Thời gian phản hồi cam kết (SLA) và các mốc không được trễ.

## Tài nguyên

- Bộ nhận diện thương hiệu:
- Thư mục Drive:
- Tài khoản quảng cáo / công cụ:

## Lịch sử và bài học

Liên kết tới các trang tổng kết chiến dịch của khách hàng này.
`,
  },
  {
    key: "onboarding_guide",
    name: "Hướng dẫn hội nhập",
    description: "Lộ trình 30 – 60 – 90 ngày cho người mới của một vị trí hoặc phòng ban.",
    markdown: `## Chào mừng

_Vài dòng về nhóm, cách làm việc, ai là người đồng hành (buddy)._

## Tuần đầu tiên

- [ ] Nhận thiết bị, tài khoản, quyền truy cập
- [ ] Đọc và xác nhận các chính sách bắt buộc trong **Tri thức**
- [ ] Gặp quản lý trực tiếp để thống nhất mục tiêu
- [ ] Làm quen các công cụ: Suzu One, Google Workspace, …

## 30 ngày đầu

| Mục tiêu | Cách đo | Người hỗ trợ |
|---|---|---|
| | | |

## 60 ngày

- …

## 90 ngày — đánh giá thử việc

- Tiêu chí đánh giá:
- Buổi trao đổi cuối thử việc:

## Tài liệu nên đọc

- …
`,
  },
];

export const kbTemplateSeedRows = () => TEMPLATES.map((template, index) => ({ key: template.key, name: template.name, description: template.description, content: markdownToDoc(template.markdown, { liftTitle: false }).doc, isSystem: true, sortOrder: (index + 1) * 10 }));
