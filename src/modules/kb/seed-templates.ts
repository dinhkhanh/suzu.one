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
- [ ] Làm quen các công cụ: SuZu One, Google Workspace, …

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
  // The starters of a project's document space (FR-PJM-31), beside "Biên bản họp" above.
  {
    key: "project_brief",
    name: "Brief dự án",
    description: "Mục tiêu, khách hàng, thông điệp, sản phẩm bàn giao và mốc thời gian của một dự án.",
    markdown: `**Khách hàng / thương hiệu:** … · **Mã dự án:** … · **Người phụ trách:** …

> [!NOTE]
> Brief chính thức để duyệt khởi động nằm ở tab **Kế hoạch** của dự án. Trang này là nơi nhóm viết chi tiết và cập nhật khi làm.

## Bối cảnh

_Vì sao có dự án này, khách hàng đang gặp vấn đề gì._

## Mục tiêu

- …

## Đối tượng mục tiêu

- …

## Thông điệp chính

1. …

## Sản phẩm bàn giao

| Hạng mục | Số lượng | Định dạng / kênh | Hạn |
|---|---:|---|---|
| | | | |

## Tư liệu từ khách hàng

- Logo, guideline, hình ảnh sản phẩm: …
- Link thư mục Drive: …

## Lưu ý và điều cần tránh

- …
`,
  },
  {
    key: "video_script",
    name: "Kịch bản video",
    description: "Kịch bản theo cảnh: hình ảnh, lời thoại / voice-over, chữ trên màn hình, thời lượng.",
    markdown: `**Tên video:** … · **Thời lượng:** … giây · **Tỷ lệ khung hình:** 9:16 / 16:9 · **Kênh:** …

## Ý tưởng chính

_Một câu: người xem nhớ gì sau khi xem._

## Kịch bản theo cảnh

| Cảnh | Hình ảnh | Lời thoại / VO | Chữ trên màn hình | Thời lượng |
|---:|---|---|---|---:|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |

## Âm nhạc và âm thanh

- …

## Kêu gọi hành động (CTA)

- …

## Góp ý và lần sửa

_Ghi lại góp ý của khách hàng theo từng vòng; phiên bản trang được lưu tự động._
`,
  },
  {
    key: "shot_list",
    name: "Danh sách cảnh quay (shot list)",
    description: "Từng cảnh quay: góc máy, bối cảnh, đạo cụ, diễn viên, thứ tự quay trong ngày.",
    markdown: `**Ngày quay:** … · **Địa điểm:** … · **Đạo diễn / quay phim:** …

## Danh sách cảnh quay

| # | Cảnh (theo kịch bản) | Cỡ cảnh / góc máy | Chuyển động máy | Bối cảnh | Đạo cụ | Diễn viên | Ghi chú |
|---:|---|---|---|---|---|---|---|
| 1 | | | | | | | |
| 2 | | | | | | | |

## Lịch quay trong ngày

| Giờ | Nội dung |
|---|---|
| | |

## Thiết bị

- [ ] Máy quay, ống kính
- [ ] Đèn
- [ ] Âm thanh
- [ ] Pin, thẻ nhớ

## Liên hệ tại hiện trường

- …
`,
  },
];

/** The templates a project's document space starts with, in the order they are made (FR-PJM-31). */
export const PROJECT_STARTER_TEMPLATES = ["project_brief", "video_script", "shot_list", "meeting_notes"] as const;

export const kbTemplateSeedRows = () => TEMPLATES.map((template, index) => ({ key: template.key, name: template.name, description: template.description, content: markdownToDoc(template.markdown, { liftTitle: false }).doc, isSystem: true, sortOrder: (index + 1) * 10 }));
