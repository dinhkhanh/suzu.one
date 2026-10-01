# Báo cáo định kỳ

**Báo cáo định kỳ** gửi một báo cáo qua email theo lịch: mỗi ngày, mỗi tuần hoặc mỗi tháng. Ví dụ: trưởng bộ phận nhận báo cáo nhân sự đầu mỗi tháng, trưởng nhóm nhận **Tình hình giao việc** mỗi sáng thứ hai.

Mở trang: [Báo cáo → Tổng quan](/reports), bấm liên kết **Báo cáo định kỳ** ở đầu trang. Hoặc vào thẳng [Báo cáo định kỳ](/reports/schedules).

## Ai dùng được

- **Tạo lịch gửi**: người có quyền xem báo cáo nhân sự, quyền về nghĩa vụ tuân thủ, hoặc quyền quản trị cấu hình — tức **Ban điều hành**, **Giám đốc pháp nhân**, **Quản trị nhân sự**, **Chuyên viên nhân sự**, **C&B / Tiền lương**, **Tài chính – Kế toán**, **Trưởng bộ phận**, **Kiểm toán**, **Chủ sở hữu**.
- **Chọn báo cáo**: bạn chỉ chọn được báo cáo mà chính bạn đang được xem.
- **Xem, sửa, tạm dừng, xoá một lịch**: người tạo lịch đó, và **Quản trị nhân sự** / **Chủ sở hữu** (thấy mọi lịch).

## Những báo cáo gửi được

Danh sách trong ô **Báo cáo** tuỳ theo quyền của bạn:

| Báo cáo | Nội dung email |
|---|---|
| **Báo cáo nhân sự** | Quân số, người vào, người nghỉ trong kỳ |
| **Báo cáo công việc** | Số việc hoàn thành, tỷ lệ đúng hạn, việc quá hạn theo nhóm và khách hàng |
| **Nghĩa vụ quá hạn** | Danh sách nghĩa vụ tuân thủ đang quá hạn, pháp nhân, hạn, người phụ trách |
| **Phễu tuyển dụng** | Số hồ sơ theo từng bước, vị trí đang tuyển |
| **Tình hình giao việc** | Số dự án, tỷ lệ đúng hạn, dự án quá hạn cập nhật, tuân thủ báo cáo cuối ngày, theo nhóm |
| **Giai đoạn hoặc tháng** | Pipeline kinh doanh: cơ hội theo giai đoạn, theo tháng dự kiến chốt, cơ hội đã thắng |
| **Hóa đơn hoặc nhóm tuổi nợ** | Công nợ: tổng phải thu theo tuổi nợ và các hoá đơn quá hạn |

> [!NOTE]
> **Chi phí lương** và **Lợi nhuận dự án** *không* gửi qua email được, vì đó là số liệu dựa trên lương, chỉ được xem sau khi xác thực lại.

## Tạo lịch gửi

1. Trên trang **Báo cáo định kỳ**, bấm **Tạo lịch gửi**.
2. Điền các ô:
   - **Tên** — tên lịch, cũng là tiêu đề email. Mặc định là tên báo cáo; nên đặt rõ hơn, ví dụ "Nhân sự phòng Sáng tạo — hằng tháng".
   - **Báo cáo** — chọn báo cáo cần gửi.
   - **Tần suất** — **Hằng ngày**, **Hằng tuần** hoặc **Hằng tháng**.
   - **Thứ** (khi chọn hằng tuần) — từ **Thứ hai** đến **Chủ nhật**.
   - **Ngày trong tháng** (khi chọn hằng tháng) — từ 1 đến 31. *Tháng ngắn hơn sẽ tự lùi về ngày cuối tháng.*
   - **Ngôn ngữ email** — Tiếng Việt hoặc English.
   - **Người nhận** — mặc định có bạn. Để thêm người, chọn tên trong danh sách rồi bấm **+**; bấm **×** cạnh tên để bỏ. Tối đa 50 người.
3. Bấm **Lưu**. Bạn quay về danh sách và lịch mới ở trạng thái **Đang chạy**.

> [!IMPORTANT]
> *Được nêu tên ở đây không cho thêm quyền gì: ai không được xem báo cáo thì không nhận, và điều đó được ghi lại.* Mỗi lần gửi, báo cáo được dựng lại **riêng cho từng người nhận theo quyền của chính họ**. Trưởng bộ phận A nhận số của bộ phận A, trưởng bộ phận B nhận số của bộ phận B — dù cùng một lịch. Muốn ai đó nhận một báo cáo, người đó phải có quyền xem báo cáo ấy.

## Khi nào email được gửi và gửi gì

- Hệ thống gửi báo cáo mỗi sáng (khoảng 7 giờ, giờ Việt Nam) vào ngày đến lịch.
- Nếu một ngày bị lỡ (ví dụ hệ thống gặp sự cố), báo cáo được gửi bù **một lần** vào sáng hôm sau, không gửi dồn nhiều bản.
- Lịch tạo đúng vào ngày đến hạn sẽ được gửi ở lượt buổi sáng gần nhất chưa chạy.

Kỳ số liệu trong email:

| Tần suất | Email nói về |
|---|---|
| **Hằng ngày** | Ngày hôm qua |
| **Hằng tuần** | 7 ngày gần nhất, đến hôm qua |
| **Hằng tháng** | Trọn tháng trước, dù gửi vào ngày nào trong tháng |

Email gửi tới **email công ty** của người nhận, tiêu đề dạng *Tên lịch — ngày bắt đầu → ngày kết thúc*. Nội dung là văn bản thuần: tên báo cáo, kỳ, một câu tóm tắt (ví dụ *Quân số 120; vào 3, nghỉ 1 trong kỳ.*), bảng số liệu, và đường dẫn mở màn hình báo cáo trên SuZu One.

## Danh sách lịch gửi

Bảng trên trang **Báo cáo định kỳ** có các cột: **Tên**, **Báo cáo**, **Tần suất** (kèm thứ hoặc ngày), **Người nhận**, **Lần gửi tới**, **Lần gửi gần nhất**, **Trạng thái**.

Ở cột **Trạng thái**:

- **Đang chạy** hoặc **Tạm dừng**.
- Kết quả lần gửi gần nhất: **Đã gửi …** người, và nếu có, **Không gửi … (không đủ quyền)**.

Bấm tên lịch để mở trang chi tiết: sửa các ô như lúc tạo, và xem kết quả lần gửi gần nhất với một trong các trạng thái:

| Trạng thái | Nghĩa là |
|---|---|
| **Thành công** | Mọi người nhận đều nhận được |
| **Một phần** | Có người không nhận: không đủ quyền xem báo cáo, chưa có email công ty, hoặc gửi lỗi |
| **Thất bại** | Không gửi được cho ai |

## Tạm dừng, chạy lại, xoá

Ở cuối mỗi dòng trong danh sách:

- **Tạm dừng** — ngừng gửi cho tới khi bạn bấm **Chạy lại**.
- **Chạy lại** — gửi tiếp theo lịch.
- **Xóa** — hệ thống hỏi *Xóa lịch gửi này?*; xác nhận để xoá lịch. Lịch đã xoá không gửi nữa và biến mất khỏi danh sách.

> [!TIP]
> Khi có người nhận chuyển vị trí hoặc nghỉ việc, hãy xem lại danh sách người nhận. Người không còn quyền sẽ tự động không nhận nữa (và lần gửi ghi **Một phần**), nhưng bỏ tên họ khỏi lịch giúp danh sách gọn và trạng thái trở lại **Thành công**.

## Câu hỏi thường gặp

**Tôi không thấy liên kết Báo cáo định kỳ.**
Vai trò của bạn không có quyền tạo lịch gửi. Hãy nhờ người có quyền (ví dụ HR hoặc trưởng bộ phận) thêm bạn làm người nhận một lịch có sẵn — miễn là bạn được xem báo cáo đó.

**Người nhận báo không nhận được email.**
Mở trang chi tiết lịch, xem trạng thái lần gửi gần nhất. Nếu là **Một phần**, người đó có thể chưa có email công ty trong hồ sơ hoặc không đủ quyền xem báo cáo. Nhờ HR kiểm tra hồ sơ và vai trò.

**Trang báo "Chưa cấu hình dịch vụ email…".**
Dịch vụ gửi email chưa được bật; thư được ghi nhận nhưng không gửi đi. Hãy báo quản trị viên hệ thống.

**Báo cáo đã bị đổi quyền sau khi tôi tạo lịch thì sao?**
Khi bạn lưu lại lịch, hệ thống kiểm tra lại bạn có còn được xem báo cáo đó không. Nếu không, hệ thống báo *Bạn không được xem báo cáo này.*
