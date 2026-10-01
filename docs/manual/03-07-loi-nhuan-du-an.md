# Lợi nhuận dự án

Báo cáo **Lợi nhuận dự án** so sánh doanh thu với chi phí nhân sự của từng dự án và từng khách hàng, để thấy dự án nào đang lời, dự án nào đang lỗ.

Mở báo cáo: [Báo cáo → Tổng quan](/reports), bấm liên kết **Lợi nhuận dự án** ở đầu trang. Hoặc vào thẳng [Lợi nhuận dự án](/reports/profitability).

## Ai xem được

Chỉ những vai trò được xem chi phí dự án: **Ban điều hành**, **Tài chính – Kế toán** và **Chủ sở hữu**. Trong đó, một dự án chỉ hiện nếu bạn được xem cả *chi phí* lẫn *doanh thu* của pháp nhân sở hữu dự án — có chi phí mà không có doanh thu thì không thành lợi nhuận.

Quản lý trực tiếp, trưởng nhóm, trưởng bộ phận và giám đốc pháp nhân **không** xem được báo cáo này, vì chi phí được tính từ lương. Người không có quyền mở đường dẫn sẽ gặp trang "Không tìm thấy trang".

> [!IMPORTANT]
> Vì số liệu dựa trên lương, mỗi lần mở trang bạn phải **xác thực lại** trong 15 phút gần nhất. Nếu chưa, hệ thống chuyển bạn tới trang **Xác thực lại** — bấm **Đăng nhập lại bằng Google**, xong sẽ quay về báo cáo. Mỗi lần xem được ghi vào nhật ký hệ thống.

## Chọn kỳ và khách hàng

- **Từ ngày** – **Đến ngày**: mặc định là ba tháng trọn trước đó cộng tháng hiện tại tính đến hôm nay (lợi nhuận cần nhìn qua vài tháng mới có ý nghĩa).
- **Khách hàng**: chọn một khách hàng hoặc **Tất cả khách hàng**.

Bấm **Xem** để cập nhật.

## Cách tính

| Khái niệm | Cách tính |
|---|---|
| **Doanh thu** | Lấy từ nguồn tốt nhất có được, theo thứ tự: tiền **Đã xuất hoá đơn** trong kỳ → **Phí duy trì × số tháng** (với hợp đồng duy trì) → **Phí dự án**. Không có nguồn nào thì ghi **Chưa có phí** |
| **Chi phí** | Giờ đã ghi trên dự án × đơn giá chi phí tháng của từng người |
| **Đơn giá chi phí** | (Tổng lương + các khoản doanh nghiệp đóng) của bảng lương đã duyệt ÷ số giờ làm chuẩn của tháng |
| **Lợi nhuận** | Doanh thu − Chi phí |
| **Biên lợi nhuận** | Lợi nhuận ÷ Doanh thu |

Cột **Cơ sở doanh thu** cho biết doanh thu của dòng đó lấy từ nguồn nào. Lợi nhuận âm hiện màu đỏ.

> [!NOTE]
> **Ước tính**: nếu có tháng chưa có bảng lương được duyệt, hệ thống dùng đơn giá của tháng gần nhất đã duyệt, và dự án được gắn nhãn **Ước tính**. Con số sẽ chính xác hơn khi bảng lương tháng đó được duyệt.

## Đọc báo cáo

### Tổng

Hàng đầu trang cho tổng **Doanh thu**, **Chi phí**, **Lợi nhuận**, **Biên lợi nhuận** của các dự án trong bộ lọc.

### Theo dự án

Mỗi dòng là một dự án (kèm số job và khách hàng), với cơ sở doanh thu, giờ, doanh thu, chi phí, lợi nhuận và biên lợi nhuận. Bấm vào tên dự án để mở rộng:

- **Chi phí theo nhóm** và **Chi phí theo vị trí** — chi phí chia theo nhóm làm việc và theo vị trí.
- Nếu có giờ của người chưa có đơn giá: *… giờ chưa có đơn giá chi phí nên chưa tính vào chi phí.* Giờ này vẫn được đếm nhưng chưa thành tiền.

Dòng **… dự án riêng tư (không hiện tên)** gộp các dự án riêng tư mà bạn không phải thành viên: bạn thấy tổng lợi nhuận của chúng nhưng không thấy tên, khách hàng.

### Theo khách hàng

Gộp các dự án theo khách hàng. Dự án không gắn khách hàng nằm ở dòng **Không có khách hàng**.

## Bảo vệ thông tin cá nhân

Báo cáo không bao giờ hiện đơn giá hay chi phí của **một người**:

- Chi phí chỉ hiện ở mức dự án, khách hàng, nhóm hoặc vị trí.
- Nhóm hoặc vị trí chỉ có một người được gộp vào **Khác (gộp các nhóm nhỏ)**, để không suy ra được lương của cá nhân.
- Giờ không gắn với nhóm hoặc vị trí nằm ở dòng **Không gắn với nhóm / vị trí**.

## Xuất dữ liệu

Bấm **Xuất CSV** để tải số liệu của kỳ và khách hàng đang chọn. Việc xuất cũng cần bạn đã xác thực lại gần đây, và được ghi vào nhật ký hệ thống. Hãy lưu tệp ở nơi an toàn — đó là dữ liệu tài chính nội bộ.

> [!CAUTION]
> Báo cáo này **không** gửi qua email theo lịch được (không có trong danh sách **Báo cáo định kỳ**), vì số liệu dựa trên lương chỉ được đọc sau khi xác thực lại.

## Mẹo

- Dự án có biên lợi nhuận thấp: mở rộng dòng dự án, xem **Chi phí theo vị trí** để biết phần giờ nào tốn nhất, rồi đối chiếu với **Tình hình giao việc** (vòng sửa của khách, giờ so với ngân sách).
- Nhiều dự án **Chưa có phí**: nhắc người phụ trách cập nhật phí dự án hoặc xuất hoá đơn — xem chương **Dự án** và **Khách hàng & kinh doanh**.
