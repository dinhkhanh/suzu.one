// The demo handbook: policies and SOPs written in Markdown and turned into pages by the same
// importer people use (`markdownToDoc`). SAMPLES — realistic enough to try search, acknowledgement
// and review on, and for HR to replace with the company's real text. Figures are either what the
// Labour Code 2019 says or deliberately left as "theo quy định hiện hành".
export type HandbookPage = { key: string; space: string; parent?: string; title: string; owner: string; reviewBy?: string; on: string; by: string; note?: string; major?: boolean; markdown: string };

const MAI = "Lê Thị Mai";
const BAO = "Phạm Quốc Bảo";
const TUAN = "Võ Minh Tuấn";
const LONG = "Đặng Hoàng Long";

const SAMPLE = "> [!NOTE]\n> Văn bản mẫu để dùng thử Suzu One. Phòng Hành chính – Nhân sự sẽ thay bằng văn bản chính thức của công ty.\n\n";

export const HANDBOOK_PAGES: HandbookPage[] = [
  {
    key: "rules", space: "so-tay", title: "Nội quy lao động", owner: MAI, reviewBy: "2027-03-31", on: "2026-08-24", by: MAI, note: "Ban hành nội quy 2026", major: true,
    markdown: `${SAMPLE}## 1. Phạm vi áp dụng

Nội quy áp dụng cho toàn bộ người lao động của Suzu Group, Suzu Media và Suzu Creative, kể cả thử việc, thực tập và bán thời gian.

## 2. Thời giờ làm việc, nghỉ ngơi

- Giờ làm việc: thứ Hai đến thứ Sáu, 8:30 – 17:30, nghỉ trưa 12:00 – 13:00.
- Chấm công bằng ứng dụng Suzu One hoặc máy chấm công tại văn phòng.
- Chi tiết xem trang **Giờ làm việc và chấm công**.

## 3. Trật tự nơi làm việc

1. Đeo thẻ nhân viên khi ở văn phòng và khi đi gặp khách hàng.
2. Không hút thuốc trong văn phòng, phim trường và khu vực kho thiết bị.
3. Khách đến làm việc phải đăng ký tại lễ tân.

## 4. An toàn lao động tại phim trường

- Chỉ người được phân công mới vận hành thiết bị ánh sáng, cẩu, flycam.
- Kiểm tra dây điện, chân đèn trước mỗi ca quay; báo ngay cho trưởng nhóm khi có sự cố.

> [!WARNING]
> Tai nạn lao động, dù nhẹ, phải báo cho quản lý trực tiếp và phòng Nhân sự trong ngày.

## 5. Bảo vệ tài sản, bí mật kinh doanh

Xem trang **Bảo mật thông tin và thiết bị**. Tài liệu, footage, dữ liệu khách hàng là tài sản của công ty và của khách hàng.

## 6. Hành vi vi phạm và hình thức xử lý

| Mức độ | Ví dụ | Hình thức |
|---|---|---|
| Nhẹ | Đi muộn nhiều lần, không chấm công | Nhắc nhở, khiển trách |
| Nặng | Tự ý bỏ việc, làm lộ thông tin khách hàng | Kéo dài thời hạn nâng lương, cách chức |
| Đặc biệt nghiêm trọng | Trộm cắp, tham ô, tiết lộ bí mật kinh doanh gây thiệt hại | Sa thải theo Bộ luật Lao động |

Việc xử lý kỷ luật tuân theo trình tự của Bộ luật Lao động 2019: có biên bản, có sự tham gia của người lao động và tổ chức đại diện.
`,
  },
  {
    key: "hours", space: "so-tay", title: "Giờ làm việc và chấm công", owner: BAO, on: "2026-08-25", by: MAI,
    markdown: `${SAMPLE}## Giờ làm việc

| Nhóm | Giờ làm | Ghi chú |
|---|---|---|
| Văn phòng | 8:30 – 17:30 | Linh hoạt ±30 phút, đủ 8 giờ |
| Sản xuất video | Theo lịch quay | Phân ca trên Suzu One |
| Bán thời gian | Theo hợp đồng | Tối thiểu 4 giờ / ca |

## Chấm công

1. Mở **Chấm công** trên Suzu One khi đến và khi về. Ứng dụng ghi vị trí trong phạm vi văn phòng.
2. Đi gặp khách hoặc quay ngoại cảnh: tạo đơn **Làm việc ngoài văn phòng** trước ngày đi.
3. Quên chấm công: tạo đơn **Bổ sung công** trong 3 ngày làm việc. Mỗi tháng tối đa 3 lần.

> [!TIP]
> Cuối tháng, kiểm tra và xác nhận bảng công của mình trước ngày 3 tháng sau để kịp kỳ lương.

## Đi muộn, về sớm

Đi muộn quá 15 phút được ghi nhận trên bảng công. Từ lần thứ tư trong tháng, quản lý trực tiếp sẽ trao đổi với bạn.
`,
  },
  {
    key: "overtime", space: "so-tay", title: "Làm thêm giờ", owner: BAO, on: "2026-08-25", by: MAI,
    markdown: `${SAMPLE}## Nguyên tắc

Làm thêm giờ phải được **quản lý trực tiếp duyệt trước** trên Suzu One (đơn *Làm thêm giờ*). Giờ làm thêm không có đơn được duyệt sẽ không được tính.

## Giới hạn

- Không quá 40 giờ mỗi tháng và 200 giờ mỗi năm, theo Bộ luật Lao động 2019.
- Không bố trí làm thêm cho lao động nữ mang thai từ tháng thứ 7 hoặc đang nuôi con dưới 12 tháng tuổi.

## Tiền lương làm thêm giờ

| Thời điểm | Mức trả tối thiểu |
|---|---|
| Ngày thường | 150% |
| Ngày nghỉ hằng tuần | 200% |
| Ngày lễ, tết, ngày nghỉ có hưởng lương | 300%, chưa kể lương ngày lễ |
| Làm việc ban đêm (22:00 – 6:00) | Thêm ít nhất 30% |

## Nghỉ bù

Bạn có thể chọn **nghỉ bù** thay cho nhận tiền khi tạo đơn. Giờ nghỉ bù được cộng vào số dư nghỉ khi bảng công tháng được khoá.
`,
  },
  {
    key: "pay", space: "so-tay", title: "Lương và ngày trả lương", owner: MAI, on: "2026-08-26", by: MAI,
    markdown: `${SAMPLE}## Kỳ lương

- Kỳ tính lương: từ ngày 1 đến ngày cuối tháng.
- Ngày trả lương: **ngày 5** của tháng kế tiếp, chuyển khoản vào tài khoản bạn đã đăng ký. Nếu trùng ngày nghỉ, lương được trả vào ngày làm việc liền trước.

## Cấu phần thu nhập

| Khoản | Ghi chú |
|---|---|
| Lương cơ bản | Theo hợp đồng lao động |
| Phụ cấp | Ăn trưa, điện thoại, xăng xe — theo chính sách từng công ty |
| Lương làm thêm giờ | Theo đơn đã duyệt và bảng công đã khoá |
| Thưởng | Theo kết quả KPI và quy chế thưởng hằng năm |

## Các khoản khấu trừ

- Bảo hiểm xã hội, y tế, thất nghiệp phần người lao động: theo tỷ lệ của quy định hiện hành.
- Thuế thu nhập cá nhân: tạm khấu trừ hằng tháng theo biểu luỹ tiến, quyết toán cuối năm.
- Tạm ứng chưa hoàn, nếu có.

> [!IMPORTANT]
> Thông tin lương là **bảo mật**. Không trao đổi mức lương của mình hay của người khác với đồng nghiệp. Thắc mắc về phiếu lương: liên hệ phòng Nhân sự trong 5 ngày làm việc kể từ ngày nhận lương.
`,
  },
  {
    key: "insurance", space: "so-tay", title: "Bảo hiểm xã hội, y tế và thất nghiệp", owner: BAO, on: "2026-08-26", by: MAI,
    markdown: `${SAMPLE}## Ai được tham gia

Người lao động có hợp đồng lao động từ đủ 1 tháng trở lên được công ty đăng ký tham gia BHXH, BHYT, BHTN kể từ tháng bắt đầu hợp đồng chính thức.

## Mức đóng

Tỷ lệ đóng của người lao động và của công ty theo **quy định hiện hành**, tính trên tiền lương tháng đóng bảo hiểm ghi trong hợp đồng. Mức trần và tỷ lệ cụ thể được phòng Nhân sự cập nhật trong hệ thống khi Nhà nước điều chỉnh.

## Quyền lợi chính

- **Ốm đau:** nộp giấy ra viện hoặc giấy chứng nhận nghỉ việc hưởng BHXH cho phòng Nhân sự trong 45 ngày.
- **Thai sản:** nghỉ 6 tháng với lao động nữ sinh con; lao động nam nghỉ từ 5 ngày làm việc khi vợ sinh.
- **Khám chữa bệnh:** dùng thẻ BHYT hoặc ứng dụng VssID tại nơi đăng ký khám chữa bệnh ban đầu.
- **Thất nghiệp:** nhận sổ / xác nhận quá trình đóng khi nghỉ việc để làm thủ tục hưởng trợ cấp.

## Thủ tục thường gặp

1. Thay đổi nơi khám chữa bệnh ban đầu: gửi yêu cầu cho phòng Nhân sự trước ngày 20 của tháng cuối quý.
2. Gộp sổ BHXH: cung cấp các số sổ cũ khi nhận việc.
`,
  },
  {
    key: "contract", space: "so-tay", title: "Thử việc và hợp đồng lao động", owner: MAI, on: "2026-08-27", by: MAI,
    markdown: `${SAMPLE}## Thử việc

| Vị trí | Thời gian thử việc tối đa |
|---|---|
| Quản lý doanh nghiệp | 180 ngày |
| Công việc cần trình độ cao đẳng trở lên | 60 ngày |
| Công việc cần trình độ trung cấp, kỹ thuật | 30 ngày |
| Công việc khác | 6 ngày làm việc |

- Lương thử việc ít nhất bằng **85%** lương chính thức của vị trí.
- Trước khi hết thử việc 5 ngày, quản lý trực tiếp đánh giá trên Suzu One. Đạt → ký hợp đồng lao động.

## Loại hợp đồng

1. Hợp đồng xác định thời hạn: tối đa 36 tháng, được ký tối đa 2 lần liên tiếp.
2. Hợp đồng không xác định thời hạn.

Suzu One nhắc phòng Nhân sự và quản lý **45 ngày** trước khi hợp đồng hết hạn.

## Chấm dứt hợp đồng

Người lao động báo trước 30 ngày (hợp đồng xác định thời hạn) hoặc 45 ngày (không xác định thời hạn) bằng **Đơn xin nghỉ việc** trên Suzu One. Xem thêm trang **Quy trình nghỉ việc và bàn giao**.
`,
  },
  {
    key: "conduct", space: "so-tay", title: "Quy tắc ứng xử", owner: MAI, on: "2026-08-27", by: MAI,
    markdown: `${SAMPLE}## Với đồng nghiệp

- Tôn trọng, không phân biệt đối xử vì giới tính, tuổi, vùng miền, tôn giáo.
- Góp ý thẳng thắn, đúng lúc, về việc chứ không về người.
- **Không khoan nhượng với quấy rối** dưới mọi hình thức, kể cả lời nói, tin nhắn, hình ảnh.

## Với khách hàng và đối tác

- Giữ lời hứa về thời hạn; nếu trễ, báo sớm.
- Không nhận quà, tiền hoặc lợi ích có giá trị từ nhà cung cấp. Quà lễ tết giá trị nhỏ phải báo cho quản lý.
- Không phát ngôn thay công ty trên báo chí, mạng xã hội khi chưa được giao.

## Xung đột lợi ích

Báo cho phòng Nhân sự khi bạn hoặc người thân có lợi ích tại khách hàng, nhà cung cấp hoặc đối thủ của công ty; khi nhận việc làm thêm cùng ngành.

## Khi thấy điều không đúng

> [!TIP]
> Trao đổi với quản lý trực tiếp, phòng Nhân sự, hoặc gửi thư cho Ban giám đốc. Người báo cáo thiện chí được bảo vệ khỏi mọi hình thức trả đũa.
`,
  },
  {
    key: "remote", space: "so-tay", title: "Làm việc từ xa", owner: BAO, on: "2026-08-28", by: MAI,
    markdown: `${SAMPLE}## Ai được làm việc từ xa

Nhân viên chính thức, công việc không đòi hỏi có mặt tại văn phòng hoặc phim trường, được quản lý trực tiếp đồng ý.

## Cách đăng ký

1. Tạo đơn **Làm việc từ xa** trên Suzu One trước ít nhất 1 ngày làm việc.
2. Tối đa 2 ngày mỗi tuần; nhiều hơn cần trưởng phòng duyệt.
3. Chấm công trên ứng dụng như bình thường; ứng dụng ghi nhận ngày làm việc từ xa theo đơn đã duyệt.

## Trong ngày làm việc từ xa

- Có mặt trực tuyến trong giờ làm việc, trả lời tin nhắn trong 30 phút.
- Họp bật camera khi có khách hàng.
- Tuân thủ trang **Bảo mật thông tin và thiết bị**: không dùng wifi công cộng không mật khẩu, khoá màn hình khi rời máy.
`,
  },
  {
    key: "expenses", space: "quy-trinh-tai-chinh", title: "Công tác phí và thanh toán chi phí", owner: TUAN, on: "2026-08-20", by: TUAN,
    markdown: `${SAMPLE}## Định mức công tác phí

| Khoản | Định mức | Chứng từ |
|---|---|---|
| Vé máy bay, tàu xe | Hạng phổ thông, theo thực tế | Hoá đơn, thẻ lên máy bay |
| Khách sạn | Theo thực tế trong hạn mức từng địa bàn | Hoá đơn giá trị gia tăng |
| Phụ cấp lưu trú | Khoán theo ngày | Quyết định cử đi công tác |
| Taxi, xe công nghệ | Theo thực tế | Hoá đơn điện tử |

## Quy trình

1. Lập **đề nghị công tác** có kế hoạch và dự toán; trưởng phòng duyệt.
2. Cần tiền trước: làm **tạm ứng** (xem trang *Quy trình tạm ứng và hoàn ứng*).
3. Sau chuyến đi, nộp **bảng kê thanh toán** kèm chứng từ trong 7 ngày.
4. Kế toán kiểm tra, chuyển khoản trong 5 ngày làm việc.

> [!WARNING]
> Hoá đơn phải ghi đúng tên và mã số thuế của công ty chi trả. Hoá đơn sai thông tin không được thanh toán.
`,
  },
  {
    key: "onboarding", space: "chinh-sach-nhan-su", title: "Quy trình tiếp nhận nhân viên mới", owner: BAO, on: "2026-08-21", by: MAI,
    markdown: `${SAMPLE}## Trước ngày nhận việc

| Việc | Người phụ trách | Hạn |
|---|---|---|
| Tạo hồ sơ trên Suzu One, gửi thư mời nhận việc | Nhân sự | 5 ngày trước |
| Chuẩn bị máy tính, tài khoản email, quyền truy cập | IT / Hành chính | 2 ngày trước |
| Phân công người đồng hành (buddy) | Quản lý trực tiếp | 2 ngày trước |

## Ngày đầu tiên

1. Nhân sự đón, giới thiệu văn phòng, ký hợp đồng thử việc.
2. Nhân viên mới hoàn thành **danh sách hội nhập** trong mục *Việc của tôi*.
3. Đọc và xác nhận các trang bắt buộc: **Nội quy lao động**, **Bảo mật thông tin và thiết bị**.

## 30 – 60 – 90 ngày

- Ngày 30: quản lý trao đổi về mức độ hoà nhập.
- Ngày 55: đánh giá thử việc trên Suzu One.
- Ngày 90: thống nhất mục tiêu cá nhân (OKR / KPI).
`,
  },
  {
    key: "offboarding", space: "chinh-sach-nhan-su", title: "Quy trình nghỉ việc và bàn giao", owner: BAO, on: "2026-08-21", by: MAI,
    markdown: `${SAMPLE}## Các bước

1. Nhân viên gửi **Đơn xin nghỉ việc** trên Suzu One; quản lý trực tiếp duyệt.
2. Nhân sự xác nhận ngày làm việc cuối và tạo **danh sách bàn giao**.
3. Bàn giao công việc, tài liệu, tài khoản cho người nhận; quản lý xác nhận.
4. Trả thiết bị, thẻ nhân viên; IT thu hồi quyền truy cập vào ngày làm việc cuối.
5. Thanh toán lương, phép năm chưa nghỉ trong 14 ngày làm việc; chốt sổ BHXH.

## Danh sách bàn giao tối thiểu

- [ ] Công việc đang làm và hạn của từng việc
- [ ] Thư mục Drive, tài khoản công cụ, mật khẩu dùng chung (đổi sau khi bàn giao)
- [ ] Thiết bị: máy tính, máy quay, ống kính, thẻ nhớ
- [ ] Đầu mối khách hàng và các cam kết đang có

> [!IMPORTANT]
> Nghĩa vụ bảo mật thông tin tiếp tục có hiệu lực sau khi nghỉ việc, theo cam kết đã ký.
`,
  },
  {
    key: "client-review", space: "san-xuat-video", parent: "video-sop", title: "SOP: duyệt nội dung với khách hàng", owner: LONG, on: "2026-08-18", by: LONG,
    markdown: `## Mục đích

Giảm số vòng sửa và tránh tranh cãi về phạm vi bằng cách duyệt theo từng mốc, có ghi nhận.

## Các mốc duyệt

| Mốc | Khách hàng duyệt gì | Số vòng sửa trong gói |
|---|---|---|
| Kịch bản | Thông điệp, lời thoại, thời lượng | 2 |
| Storyboard / moodboard | Hình ảnh, bối cảnh, diễn viên | 1 |
| Bản dựng nháp (offline) | Nhịp dựng, nhạc, cấu trúc | 2 |
| Bản hoàn thiện (online) | Màu, âm thanh, đồ hoạ | 1 |

## Cách làm

1. Gửi bản duyệt qua **link Frame.io / Drive chỉ xem**, không gửi tệp gốc.
2. Gom góp ý của khách hàng vào **một** danh sách; Account xác nhận lại bằng email.
3. Ghi vòng sửa vào công việc trên Suzu One (bước *Duyệt*), đính kèm danh sách góp ý.
4. Vượt số vòng trong gói: Account báo giá phát sinh **trước khi** làm.

> [!WARNING]
> Không nhận góp ý qua tin nhắn cá nhân. Mọi thay đổi phải nằm trong danh sách đã xác nhận.
`,
  },
  {
    key: "suzu-one", space: "cong-cu", title: "Hướng dẫn dùng Suzu One", owner: BAO, on: "2026-09-01", by: BAO,
    markdown: `## Bắt đầu

1. Đăng nhập bằng tài khoản Google của công ty tại trang Suzu One.
2. Trên điện thoại: mở bằng Chrome hoặc Safari → **Thêm vào màn hình chính** để dùng như ứng dụng.
3. Bật thông báo để nhận nhắc việc và kết quả phê duyệt.

## Việc hằng ngày

| Bạn muốn | Vào đâu |
|---|---|
| Chấm công | **Chấm công** |
| Xin nghỉ phép | **Nghỉ phép** → *Tạo đơn* |
| Xin làm thêm giờ, bổ sung công | **Chấm công** → *Tạo đơn* |
| Xem việc được giao | **Việc của tôi** |
| Cập nhật mục tiêu hằng tuần | **Hiệu suất** |
| Tìm quy định, quy trình | **Tri thức** → ô tìm kiếm (gõ không dấu cũng được) |

## Mẹo

- Trang nào cần đọc và xác nhận sẽ hiện ở **Tri thức → Xác nhận của tôi**.
- Không thấy một mục trong menu? Bạn chưa được cấp quyền — hỏi phòng Nhân sự.
`,
  },
];

// Pages with more than one story to tell: written apart so the seed can stage their history.
export const SECURITY_V1 = `${SAMPLE}## Tài khoản và mật khẩu

- Mỗi người một tài khoản; không dùng chung, không cho mượn.
- Mật khẩu tối thiểu 12 ký tự; bật xác thực hai lớp cho tài khoản Google.

## Thiết bị

- Khoá màn hình khi rời chỗ. Mã hoá ổ đĩa máy tính xách tay.
- Mất thiết bị: báo IT và quản lý **trong vòng 2 giờ**.

## Dữ liệu khách hàng

Footage, kịch bản, số liệu chiến dịch của khách hàng chỉ lưu trên Drive của công ty và NAS nội bộ. Không tải về máy cá nhân, không gửi qua ứng dụng nhắn tin cá nhân.
`;

export const SECURITY_V2 = `${SECURITY_V1}
## Công cụ AI

> [!WARNING]
> Không đưa dữ liệu khách hàng, thông tin nhân sự hoặc số liệu tài chính vào các công cụ AI công cộng.

- Chỉ dùng các công cụ AI đã được công ty phê duyệt, bằng tài khoản công ty.
- Nội dung do AI tạo ra phải được người phụ trách kiểm tra trước khi gửi khách hàng.

## Xử lý sự cố

1. Nghi ngờ lộ mật khẩu hoặc nhấp vào liên kết lạ: đổi mật khẩu ngay, báo IT.
2. IT khoá phiên đăng nhập, kiểm tra nhật ký truy cập.
3. Sự cố liên quan dữ liệu khách hàng: Ban giám đốc quyết định việc thông báo cho khách hàng.
`;

export const REMOTE_DRAFT = `${SAMPLE}## Ai được làm việc từ xa

Nhân viên chính thức, công việc không đòi hỏi có mặt tại văn phòng hoặc phim trường, được quản lý trực tiếp đồng ý.

## Cách đăng ký

1. Tạo đơn **Làm việc từ xa** trên Suzu One trước ít nhất 1 ngày làm việc.
2. Tối đa **3 ngày** mỗi tuần; nhiều hơn cần trưởng phòng duyệt.
3. Chấm công trên ứng dụng như bình thường; ứng dụng ghi nhận ngày làm việc từ xa theo đơn đã duyệt.

## Trong ngày làm việc từ xa

- Có mặt trực tuyến trong giờ làm việc, trả lời tin nhắn trong 30 phút.
- Họp bật camera khi có khách hàng.
- Tuân thủ trang **Bảo mật thông tin và thiết bị**: không dùng wifi công cộng không mật khẩu, khoá màn hình khi rời máy.

## Làm việc từ xa dài ngày

Từ 5 ngày liên tục (về quê, chăm người thân): thoả thuận bằng văn bản với quản lý và phòng Nhân sự, tối đa 20 ngày mỗi năm.
`;
