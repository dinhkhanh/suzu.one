# Cơ hội bán hàng

Một **cơ hội** (deal) là một thương vụ cụ thể với một khách hàng: một chiến dịch Tết, một gói quản lý fanpage theo tháng, một TVC. Cơ hội đi qua các **giai đoạn** cho tới khi **Chốt thành công** hoặc **Không thành công**. Trang này hướng dẫn tạo, theo dõi và di chuyển cơ hội.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem cơ hội (giai đoạn, dịch vụ, ngày) | Người phụ trách cơ hội, nhóm phụ trách khách hàng, người bán hàng và quản lý kinh doanh trong pháp nhân của cơ hội. |
| Xem **giá trị** cơ hội và báo giá | Người phụ trách cơ hội, người phụ trách khách hàng, người bán hàng, quản lý kinh doanh, và **Tài chính – Kế toán** trong pháp nhân đó. Trưởng dự án sắp nhận việc thấy giai đoạn, dịch vụ, ngày, giờ công — nhưng không thấy giá. |
| Tạo cơ hội | Người phụ trách khách hàng (dù không làm kinh doanh), người bán hàng và quản lý kinh doanh trong pháp nhân ký. |
| Sửa cơ hội đang mở, chuyển giai đoạn | Người phụ trách cơ hội, người phụ trách khách hàng, quản lý kinh doanh. |
| Giao cơ hội cho người khác | Người phụ trách cơ hội (chuyển cơ hội của mình), quản lý kinh doanh. |
| Mở lại cơ hội đã chốt / không thành công | Chỉ quản lý kinh doanh, và chỉ khi cơ hội chưa thành dự án. |

## Giai đoạn và điều kiện

Mỗi giai đoạn có **xác suất** mặc định (dùng để tính giá trị có trọng số) và có thể có **điều kiện** — những gì cơ hội phải có mới được vào giai đoạn đó: một đầu mối phía khách, ngày dự kiến chốt, giá trị, báo giá được chấp nhận, hợp đồng đã ký, hoặc dự án pitch.

Bộ giai đoạn ban đầu của hệ thống:

| Giai đoạn | Xác suất | Cần có |
| --- | --- | --- |
| **Đã xác định nhu cầu** | 10% | — |
| **Tìm hiểu & brief** | 25% | một đầu mối phía khách |
| **Đề xuất / pitch** | 50% | đầu mối, ngày dự kiến chốt |
| **Thương lượng** | 75% | đầu mối, ngày dự kiến chốt, giá trị |
| **Chốt thành công** | 100% | giá trị |
| **Không thành công** | 0% | lý do |

Quản lý kinh doanh có thể đổi tên, thêm, sắp xếp lại giai đoạn và điều kiện ở tab **Cài đặt** — xem trang **Báo cáo & cài đặt kinh doanh**. Khi cơ hội chưa đủ điều kiện, hệ thống báo "Giai đoạn này cần: …".

## Tạo một cơ hội

Cơ hội được tạo từ trang khách hàng (hoặc khi **chuyển khách tiềm năng thành cơ hội** — xem trang **Khách tiềm năng**).

1. Mở trang khách hàng → mục **Cơ hội** → **Cơ hội mới**.
2. Điền:
   - **Tên cơ hội**, **Thương hiệu** (nếu khách có nhiều thương hiệu).
   - **Dịch vụ**: Mạng xã hội, Video, KOL / KOC, Sự kiện, Mua quảng cáo, Thiết kế, Khác (chọn nhiều).
   - **Giá trị một lần (VNĐ)** và/hoặc **Giá trị hằng tháng (VNĐ)** × **Số tháng**.
   - **Xác suất %** — để trống thì theo giai đoạn.
   - **Dự kiến chốt**, **Đội thực hiện**, **Pháp nhân ký** (mặc định theo khách hàng), **Nguồn**, **Đối thủ**, **Bước tiếp theo**.
   - **Giai đoạn** bắt đầu, **Phụ trách** và **Đầu mối** phía khách.
3. Bấm **Tạo cơ hội**.

Nếu bạn đặt người khác làm phụ trách, họ nhận thông báo **Có cơ hội giao cho bạn**.

## Danh sách cơ hội: Bảng, Danh sách, Dự báo

Mở [Cơ hội](/crm/deals). Chọn **Cách xem**:

### Bảng

Mỗi cột là một giai đoạn, đầu cột ghi tổng giá trị và giá trị có trọng số của các cơ hội bạn được xem giá ("x/y có giá trị" nếu có cơ hội bạn không được xem giá). Mỗi thẻ có mã, tên, khách hàng, người phụ trách, ngày dự kiến chốt, giá trị (nếu được xem), và nhãn **Đứng yên** nếu lâu không có hoạt động.

- **Kéo thẻ** sang cột khác để chuyển giai đoạn. Nếu thiếu điều kiện, hệ thống báo "Giai đoạn này cần: …" và không chuyển.
- Kéo vào cột **Không thành công** sẽ mở trang cơ hội để bạn nhập lý do.
- Trên điện thoại, bấm thẻ để mở cơ hội và chuyển giai đoạn ở đó.

### Danh sách

Bảng có tìm kiếm theo tên, mã, khách hàng; lọc **Trạng thái** (Đang mở, Đã chốt, Không thành công, Tất cả).

### Dự báo

Tổng hợp cơ hội đang mở theo **Tháng chốt**: số cơ hội, giá trị và giá trị có trọng số. Cơ hội chưa có ngày hoặc đã quá ngày dự kiến được gom vào dòng "Chưa có ngày, hoặc đã quá ngày" — đó là những cơ hội cần cập nhật.

Cả ba cách xem đều lọc được theo **Đội thực hiện**, **Dịch vụ** và **Chỉ của tôi**.

## Trang một cơ hội

Phần đầu: người phụ trách, đội thực hiện, pháp nhân, dịch vụ; giá trị ("Giá trị … · trọng số … ở …%"), giá trị hằng tháng; ngày dự kiến chốt và bước tiếp theo. Cảnh báo đỏ nếu khách đang tạm ngưng tín dụng.

Các mục:

- **Chuyển** giai đoạn — xem bên dưới.
- **Triển khai** (khi đã chốt), **Báo giá**, **Kiểm tra nguồn lực**, **Pitch** — xem các trang **Báo giá & bảng giá** và **Chốt cơ hội & bàn giao triển khai**.
- **Lịch sử** — mọi lần chuyển giai đoạn: từ đâu sang đâu, ai, khi nào.
- **Hoạt động** và **Việc cần theo dõi**.
- **Người phía khách** — các đầu mối của cơ hội và vai trò của họ trong cơ hội; **Đổi người phía khách** để sửa.
- **Chi tiết** — **Sửa cơ hội**; **Giao cho** để đổi người phụ trách.

### Chuyển giai đoạn

1. Ở khung chuyển giai đoạn, chọn **Giai đoạn** mới.
2. Nếu là giai đoạn **Không thành công**, chọn **Lý do không thành công** (Giá, Phạm vi, Thời điểm, Đối thủ, Khách chưa quyết, Khác) — bắt buộc — và ghi **Ghi chú** giải thích thêm.
3. Bấm **Chuyển**.

Khi cơ hội **Chốt thành công**: người phụ trách khách hàng, người phụ trách kinh doanh, người phụ trách cơ hội nhận thông báo **Đã chốt thành công**; nếu cơ hội có dự án pitch, dự án pitch được đóng lại. Tiếp theo là bước **Thiết lập triển khai** (xem trang **Chốt cơ hội & bàn giao triển khai**).

Cơ hội đã chốt hoặc không thành công không sửa được nữa. Nếu cần (nhập nhầm, khách quay lại), quản lý kinh doanh dùng **Mở lại** và chọn giai đoạn để mở lại — chỉ khi cơ hội chưa tạo dự án.

### Giao cơ hội cho người khác

Ở mục **Chi tiết**, chọn người ở **Giao cho** rồi xác nhận. Người nhận phải là người được phép giữ cơ hội ở pháp nhân đó. Họ nhận thông báo **Có cơ hội giao cho bạn**.

## Cơ hội gia hạn

Khi một hợp đồng sắp hết hạn (theo số ngày quy định), hệ thống **tự mở một cơ hội gia hạn** cho người phụ trách khách hàng, kèm một việc theo dõi trong ngày, và gửi thông báo **Có hợp đồng cần gia hạn**. Mỗi hợp đồng chỉ được mở cơ hội gia hạn một lần.

## Mẹo

- Cập nhật **Dự kiến chốt** và **Bước tiếp theo** sau mỗi lần làm việc với khách — dự báo chỉ tốt bằng dữ liệu bạn nhập.
- Cơ hội **Đứng yên** là cơ hội đang chết dần: hoặc ghi một hoạt động, hoặc chuyển sang **Không thành công** với lý do trung thực.
- Lý do không thành công được thống kê trong báo cáo; chọn đúng lý do giúp cả đội học được điều gì đó.
