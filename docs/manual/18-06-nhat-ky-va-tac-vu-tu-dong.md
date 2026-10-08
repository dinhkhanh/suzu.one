# Nhật ký hệ thống & tác vụ tự động

Hai màn hình giúp quản trị viên và kiểm toán viên trả lời câu hỏi "chuyện gì đã xảy ra":

- **Nhật ký hệ thống** — mọi thay đổi dữ liệu, mọi lần ai đó bị từ chối, và mọi tác vụ tự động. Nhật ký **chỉ ghi thêm**: không ai sửa hay xoá được, kể cả chủ sở hữu.
- **Tác vụ tự động** — lịch sử các lần chạy của những việc hệ thống tự làm theo lịch (cộng phép, nhắc hạn, gửi email…), để biết việc nào chạy lỗi.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Đọc nhật ký hệ thống | **Quản trị nhân sự**, **Kiểm toán (chỉ xem)**, **Chủ sở hữu**. Người được giao một pháp nhân chỉ thấy các bản ghi của pháp nhân đó. |
| Xem tác vụ tự động | Như trên nhưng phải có phạm vi **toàn tập đoàn**. |
| Bấm **Chạy ngay** một tác vụ | **Chủ sở hữu**. |
| Nhận cảnh báo khi một tác vụ lỗi hoặc bị dừng giữa chừng | **Chủ sở hữu**. |

## Phần 1 — Nhật ký hệ thống

Mở **Quản trị** → [Nhật ký hệ thống](/admin/audit).

### Nhật ký ghi những gì

- **Mọi thay đổi** được thực hiện qua ứng dụng: tạo, sửa, duyệt, từ chối, cấp quyền, thu hồi, xuất dữ liệu…, kèm giá trị **Trước** và **Sau** khi có.
- **Mọi lần bị từ chối**: khi ai đó cố làm một việc họ không có quyền.
- **Mọi lần chạy tác vụ tự động**.
- Những thao tác thực hiện khi đang **xem với tư cách người khác** được ghi dưới **tài khoản thật** của người thao tác.

Để bảo vệ thông tin, nhật ký chỉ ghi phần tóm tắt cần thiết: ví dụ email gửi ứng viên chỉ ghi tiêu đề, thư mời nhận việc chỉ ghi số thư mời — không ghi mức lương hay địa chỉ liên hệ.

### Lọc nhật ký

Phía trên là bộ lọc:

- **Hành động** — gõ một phần mã hành động, ví dụ `person.` (mọi thao tác về hồ sơ nhân sự) hoặc `.denied` (mọi lần bị từ chối).
- **Email người thực hiện**.
- **Loại đối tượng** — hoặc **Mọi loại đối tượng**.
- **Pháp nhân** — hoặc **Mọi pháp nhân** (chỉ các pháp nhân bạn được xem).
- **Từ ngày**, **Đến ngày**.

Bấm **Lọc** để áp dụng, **Xóa lọc** để bỏ. Dòng đầu cho biết số bản ghi khớp bộ lọc. Dùng **Trước** / **Sau** để chuyển trang.

### Đọc một bản ghi

Mỗi bản ghi có:

- Thời điểm.
- **Mã hành động** — tô đỏ nếu là lần bị từ chối, bị bác hoặc lỗi.
- Email người thực hiện, hoặc **Hệ thống** nếu do tác vụ tự động; kèm tóm tắt.
- Phần chi tiết: **Đối tượng** (loại và mã của bản ghi bị thay đổi — bấm vào để xem **toàn bộ lịch sử** của đúng đối tượng đó), **Pháp nhân**, **Địa chỉ IP**, **Trình duyệt**, và giá trị **Trước** / **Sau**.

> [!TIP]
> Muốn biết ai đã sửa hồ sơ của một người? Tìm một bản ghi về người đó, bấm vào **Đối tượng** — nhật ký lọc ra mọi thay đổi trên hồ sơ ấy theo thời gian.

Nhân viên có thể tự xem ai đã xem hồ sơ của mình — xem trang **Ai xem được thông tin nào**.

## Phần 2 — Tác vụ tự động

Mở **Quản trị** → [Tác vụ tự động](/admin/jobs).

Hàng ô số liệu phía trên cho biết: số **Tác vụ**, số lần **Lỗi** trong 24 giờ qua, số lần **Gửi tin thất bại** trong 7 ngày qua (email, thông báo đẩy, Chat, Messenger, Telegram — những tin hệ thống đã thử gửi nhiều lần rồi bỏ cuộc), **Thời gian chạy trung vị** và **Lần chạy tiếp**.

- **Danh sách tác vụ** — mọi tác vụ hệ thống biết, kèm **Lịch** (giờ chạy hằng ngày, hoặc **Chạy khi cần**), **Lần chạy cuối** và **Trạng thái**. Chủ sở hữu thấy thêm nút **Chạy ngay** ở mỗi dòng: tác vụ chạy ngay lúc đó, đúng như khi chạy theo lịch, và được ghi vào bảng bên dưới. Nếu tác vụ đang chạy dở, nút báo **Đang chạy rồi**.
- **Lần chạy gần đây** — 100 lần chạy gần nhất: **Bắt đầu**, **Tác vụ** (mã), **Trạng thái** (**Đang chạy**, **Thành công**, **Lỗi**), **Thời gian** chạy, và **Kết quả** (số việc đã làm, hoặc thông báo lỗi).

Khi một tác vụ **Lỗi**, chủ sở hữu nhận thông báo **Tác vụ tự động thất bại: …** kèm nội dung lỗi. Các tác vụ được thiết kế để chạy lại an toàn: lần chạy sau làm tiếp phần còn thiếu, không làm trùng.

### Ba khung giờ và việc "chuyền tiếp"

Các tác vụ theo lịch chạy theo ba khung giờ mỗi ngày (giờ Việt Nam): **nửa đêm** (00:05), **buổi sáng** (07:00) và **buổi tối** (18:00). Trong một khung, các tác vụ chạy lần lượt theo thứ tự cố định. Nếu cả khung chạy quá khoảng bốn phút, phần còn lại được **chuyền sang một lượt chạy mới** thay vì bị bỏ dở — vì vậy các tác vụ dọn dẹp xếp cuối khung nửa đêm vẫn chạy.

Một tác vụ vẫn ở trạng thái **Đang chạy** sau 15 phút được coi là đã bị máy chủ dừng: nó được đánh dấu **Lỗi** và chủ sở hữu nhận thông báo **Tác vụ tự động bị dừng giữa chừng: …**. Khi đó hãy mở trang này và bấm **Chạy ngay** cho tác vụ đó.

### Các tác vụ chính

| Mã tác vụ | Làm gì | Khi nào |
| --- | --- | --- |
| `people-roll-over` | Cập nhật trạng thái nhân sự theo ngày (người sắp vào thành đang làm, người nghỉ việc…); chuyển các lượt duyệt còn chờ của người đã nghỉ cho người khác | Nửa đêm |
| `hr-alerts` | Nhắc hết hạn hợp đồng, hết thử việc, giấy tờ hết hạn | Buổi sáng |
| `leave-accrual` | Cộng phép tháng, cấp phép năm, chuyển phép cuối năm | Nửa đêm |
| `timesheet-recompute`, `timesheet-month-ready` | Chốt ngày công hôm trước; báo bảng công tháng sẵn sàng xác nhận | Nửa đêm; sáng ngày 1 |
| `punch-review-reminders` | Báo mỗi người duyệt (quản lý trực tiếp, hoặc nhân sự phụ trách chấm công) số lượt chấm công bị gắn cờ hôm qua còn chờ xem; sáng ngày 1 thì tính cả tháng trước, vì chúng chặn việc khoá công | Buổi sáng |
| `face-leavers` | Xoá dữ liệu khuôn mặt của người đã nghỉ việc; đóng các máy kiosk quá hạn sử dụng | Nửa đêm |
| `notifications-daily` | Gửi email tổng hợp và các email còn chờ | Buổi sáng |
| `request-sla`, `approvals-oversight-digest` | Nhắc / leo thang đề nghị chờ quá lâu (chỉ nhắc người duyệt còn đang làm việc); bản tin đề nghị cho chủ sở hữu | Buổi sáng |
| `expense-claim-sweep` | Đưa các khoản đề nghị thanh toán chi phí đã duyệt vào kỳ lương đang mở, ngay trước khi kỳ lương được tính | Nửa đêm |
| `payroll-calculate` | Tính nốt các kỳ lương đang xếp hàng hoặc bị dừng giữa chừng | Nửa đêm / buổi sáng |
| `work-reminders`, `work-recurring`, `work-cycles`, `work-cover`, `work-exit-handover`, `work-triage-wake` | Nhắc việc, tạo việc định kỳ, chu kỳ làm việc, làm thay khi nghỉ phép, bàn giao khi nghỉ việc, đánh thức việc đã hoãn | Nửa đêm / buổi sáng |
| `work-preview-sweep` | Thu hồi link duyệt của khách khi dự án đã xong hoặc lưu trữ, hoặc người tạo link đã nghỉ việc; dọn bộ đếm lượt truy cập của link duyệt và bộ nhận diện thương hiệu | Nửa đêm |
| `project-plans`, `project-reminders`, `project-retainers` | Hoàn thiện kế hoạch dự án; nhắc mốc, ngân sách; tạo tháng retainer và khoản phí | Nửa đêm / buổi sáng |
| `daily-plan-reminders`, `daily-weekly-reports`, `daily-timesheet-reminders` | Nhắc lập kế hoạch ngày, báo cáo tuần, bảng giờ | Buổi sáng |
| `daily-missed-reports` | Nhắc một lần người hôm qua có lịch làm việc mà chưa nộp báo cáo cuối ngày (không nhắc ngày nghỉ phép, ngày lễ, ngày nghỉ) | Buổi sáng |
| `daily-report-reminders` | Nhắc nộp báo cáo cuối ngày | Buổi tối (18:00) |
| `performance-probation-reviews` | Đưa vào chu kỳ đánh giá thử việc những người có hợp đồng thử việc sắp kết thúc, mỗi người với hạn riêng | Buổi sáng |
| `performance-reminders` | Nhắc phiếu đánh giá sắp đến hạn hoặc quá hạn, buổi trao đổi kết quả chưa ghi, kết quả chưa được xác nhận đã xem | Buổi sáng |
| `kpi-from-work` | Đề xuất số thực tế cho các KPI lấy từ dữ liệu công việc của tháng trước, chờ người chấm xác nhận | Buổi sáng |
| `kb-ack-reminders`, `kb-embeddings` | Nhắc xác nhận đã đọc; chuẩn bị trang tri thức cho trợ lý Hỏi SuZu AI (trang mới đăng đã được chuẩn bị ngay khi đăng; tác vụ này làm nốt phần còn lại) | Buổi sáng / nửa đêm |
| `comms-announcements` | Báo cho người nhận khi thông báo hẹn giờ đến giờ đăng | Nửa đêm / buổi sáng |
| `ops-scheduler`, `ops-reminders` | Tạo nghĩa vụ tuân thủ đến hạn; nhắc và leo thang | Nửa đêm / buổi sáng |
| `crm-nightly`, `crm-reminders` | Cập nhật giai đoạn khách hàng, hết hạn báo giá; nhắc việc theo dõi, gia hạn, công nợ, cơ hội đứng yên | Nửa đêm / buổi sáng |
| `candidate-retention` | Ẩn danh hồ sơ ứng viên quá hạn lưu trữ | Nửa đêm |
| `privacy-retention` | Xoá vị trí, địa chỉ IP và thông tin thiết bị của lượt chấm công trên ứng dụng sau 90 ngày (trừ lượt còn chờ duyệt; giờ chấm công vẫn giữ); xoá hội thoại với Hỏi SuZu AI và câu hỏi chưa trả lời sau 180 ngày | Nửa đêm |
| `report-schedules` | Gửi báo cáo định kỳ | Buổi sáng |
| `files-cleanup` | Dọn tệp tải lên dở dang; xoá hẳn khỏi kho lưu trữ những tệp đã bị xoá quá 7 ngày | Buổi sáng |
| `housekeeping` | Dọn dẹp cuối đêm: link duyệt nhanh đã hết hạn, lô nhập dữ liệu chưa xác nhận (sau 1 ngày) và dữ liệu tạm của lô đã xác nhận, phiên đăng nhập hết hạn, thông báo cũ hơn 180 ngày, nhật ký gửi email / thông báo đẩy / Chat / Messenger / Telegram cũ hơn 90 ngày (không xoá tin còn đang chờ gửi), lịch sử chạy tác vụ cũ hơn 90 ngày | Nửa đêm (cuối cùng) |

Một số tác vụ bảo trì (ví dụ đổi khoá mã hoá dữ liệu nhạy cảm) không chạy theo lịch mà do đội kỹ thuật chạy khi cần; chúng vẫn xuất hiện trong bảng khi được chạy.

## Mẹo

- Xem **Tác vụ tự động** mỗi tuần một lần, hoặc ngay khi nhận cảnh báo lỗi. Nếu một tác vụ lỗi nhiều ngày liền, hãy báo đội kỹ thuật kèm nội dung cột **Kết quả**.
- Khi có thắc mắc về một con số (số dư phép, trạng thái nhân sự), hãy kiểm tra tác vụ liên quan đã chạy thành công chưa trước khi sửa tay.
- Lọc nhật ký theo `.denied` định kỳ để phát hiện người đang thiếu quyền cần thiết — hoặc đang thử những việc không nên làm.
