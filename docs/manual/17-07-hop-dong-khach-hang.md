# Hợp đồng khách hàng

SuZu One lưu hồ sơ các **hợp đồng với khách hàng** — hợp đồng dịch vụ, hợp đồng nguyên tắc và phụ lục — cùng bản scan đã ký, thời hạn, hạn thanh toán và các dự án thực hiện theo từng hợp đồng. Hệ thống nhắc gia hạn trước khi hợp đồng hết hạn, và dùng hạn thanh toán của hợp đồng để tính hạn thu tiền của hoá đơn.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem hợp đồng (số, loại, thời hạn, dự án) | Nhóm phụ trách khách hàng và người bán hàng / quản lý kinh doanh trong pháp nhân của khách. |
| Xem **giá trị** hợp đồng | Người phụ trách khách hàng, người phụ trách kinh doanh, người bán hàng, quản lý kinh doanh, **Tài chính – Kế toán**. |
| Ghi nhận, sửa, đánh dấu đã ký, chấm dứt, gắn dự án | Người phụ trách khách hàng và người bán hàng / quản lý kinh doanh trong pháp nhân của khách. |

## Danh sách hợp đồng

Mở [Hợp đồng](/crm/contracts). Chọn nhóm cần xem:

- **Hiện hành** (mặc định) — bản nháp, chưa bắt đầu và đang hiệu lực.
- **Đang hiệu lực**, **Bản nháp**, **Hết hạn**, **Đã chấm dứt**, **Tất cả**.

Mỗi dòng có **Số**, **Khách hàng**, **Loại**, **Tình trạng**, **Thời hạn**, **Giá trị** (nếu bạn được xem). Hợp đồng đã có cơ hội gia hạn có liên kết **Cơ hội gia hạn**.

## Ghi nhận một hợp đồng

1. Mở trang khách hàng → mục **Hợp đồng** → **Ghi nhận hợp đồng**.
2. Điền:
   - **Số hợp đồng** (không trùng trong cùng pháp nhân), **Tên**.
   - **Loại**: **Hợp đồng dịch vụ**, **Hợp đồng nguyên tắc**, **Phụ lục**. Với phụ lục, chọn **Phụ lục của** — hợp đồng gốc của cùng khách hàng.
   - **Bên ký** — pháp nhân của công ty ký hợp đồng.
   - **Cơ hội** mà hợp đồng sinh ra (nếu có).
   - **Bắt đầu**, **Kết thúc** (ngày kết thúc không được trước ngày bắt đầu).
   - **Hạn thanh toán (ngày)** — số ngày khách phải trả sau khi nhận hoá đơn.
   - **Báo trước (ngày)**, **Tự động gia hạn**.
   - **Giá trị (VNĐ)** — chỉ hiện nếu bạn được xem tiền.
   - **Ghi chú**.
3. Bấm **Ghi nhận**. Hợp đồng ở trạng thái **Bản nháp**.

## Trang một hợp đồng

Phần đầu cho biết loại, bên ký, thời hạn, hạn thanh toán, giá trị (nếu được xem), ngày ký và liên kết tải bản scan đã ký.

### Đánh dấu đã ký

1. Ở khung **Đánh dấu đã ký**, chọn **Ngày ký**.
2. Tải lên **Bản scan đã ký** (bắt buộc — hệ thống yêu cầu tải lên trước khi xác nhận).
3. Bấm **Đánh dấu đã ký**.

Từ đây hợp đồng được tính là đã ký: điều kiện "hợp đồng đã ký" của giai đoạn cơ hội được đáp ứng, và hợp đồng chuyển **Chưa bắt đầu** / **Đang hiệu lực** / **Hết hạn** theo ngày.

### Gắn dự án

Mục **Dự án thực hiện theo hợp đồng** liệt kê các dự án gắn với hợp đồng. Dùng **Gắn dự án** để chọn một dự án của khách, **Gỡ** để bỏ. Dự án bạn không được mở hiện là "Một dự án bạn không được mở".

Số hợp đồng sẽ đi theo các khoản chờ xuất hoá đơn của dự án làm tham chiếu, và hạn thanh toán của hợp đồng được dùng để tính hạn thu của hoá đơn.

### Sửa và chấm dứt

- **Sửa** — chỉnh thông tin (không sửa được hợp đồng đã chấm dứt).
- **Chấm dứt hợp đồng trước hạn** — chỉ với hợp đồng đã ký; nhập **Chấm dứt ngày** và **Lý do** (bắt buộc).

### Các tình trạng

| Tình trạng | Nghĩa là |
| --- | --- |
| **Bản nháp** | Đã ghi nhận, chưa ký. |
| **Chưa bắt đầu** | Đã ký, chưa tới ngày bắt đầu. |
| **Đang hiệu lực** | Đã ký, trong thời hạn. |
| **Hết hạn** | Đã qua ngày kết thúc. |
| **Đã chấm dứt** | Chấm dứt trước hạn. |

## Gia hạn

- Trang khách hàng và tab **Việc bán hàng của tôi** hiện các **hợp đồng hết hạn trong 90 ngày tới**.
- Khi một hợp đồng đã ký (hoặc một retainer của dự án) còn số ngày quy định trước khi kết thúc, hệ thống **tự mở một cơ hội gia hạn** cho người phụ trách khách hàng, kèm một việc theo dõi "Gia hạn" trong ngày và thông báo **Có hợp đồng cần gia hạn**. Mỗi hợp đồng chỉ mở cơ hội gia hạn một lần.
- Số ngày báo trước để mở gia hạn là quy định của công ty, xem ở tab **Cài đặt**.

## Mẹo

- Luôn tải bản scan đã ký: đó là bản gốc duy nhất mà mọi người trong nhóm tìm được khi cần.
- Ghi đúng **Hạn thanh toán** trên hợp đồng; nếu để trống, hoá đơn dùng hạn thanh toán của khách hàng hoặc mặc định của công ty.
- Dùng **Phụ lục** cho các phần mở rộng phạm vi, để lịch sử của hợp đồng gốc luôn rõ ràng.
