# Hoá đơn & công nợ

Tab **Công nợ** theo dõi tiền sau khi đã làm xong việc: các **hoá đơn** đã xuất cho khách, **thanh toán** đã nhận, số **còn phải thu** và **tuổi nợ**. Hệ thống nhắc người phụ trách khách hàng và kế toán khi hoá đơn quá hạn.

> [!NOTE]
> Hoá đơn điện tử hợp lệ vẫn được phát hành trên **phần mềm kế toán**. SuZu One chỉ **ghi nhận** hoá đơn đã xuất (số, ngày, số tiền) để theo dõi thu tiền — không phát hành hoá đơn.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Ghi nhận hoá đơn, thanh toán, xoá thanh toán, xoá nợ | **Tài chính – Kế toán** (và **Ban điều hành**, **Giám đốc pháp nhân**, **Chủ sở hữu**) trong pháp nhân của hoá đơn. |
| Xem công nợ | Tài chính, quản lý kinh doanh, và **người phụ trách khách hàng** (với khách của mình). |

Mục **Công nợ** trên thanh bên (phần **Quản lý**) hiện với tài chính và quản lý kinh doanh. Người phụ trách khách hàng mở công nợ từ tab **Công nợ** trong phân hệ, hoặc mục **Hoá đơn** trên trang khách hàng.

## Trang Công nợ

Mở [Công nợ](/crm/invoices).

### Tuổi nợ

Phía trên là các ô tổng số tiền còn phải thu theo nhóm tuổi nợ: **Chưa đến hạn**, **1–30 ngày**, **31–60 ngày**, **61–90 ngày**, **Trên 90 ngày** (nhóm quá hạn có số tiền được tô đỏ), và tổng **Còn phải thu (… hoá đơn)**.

### Danh sách hoá đơn

Chọn nhóm: **Còn phải thu** (mặc định), **Quá hạn**, **Đã thu**, **Đã xoá nợ**, **Tất cả**. Mỗi dòng có **Hoá đơn**, **Khách hàng**, **Ngày xuất**, **Hạn thu** (kèm "trễ … ngày" nếu quá hạn), **Tình trạng**, **Tổng**, **Còn phải thu**.

| Tình trạng | Nghĩa là |
| --- | --- |
| **Chưa thu** | Chưa nhận đồng nào. |
| **Thu một phần** | Đã nhận một phần. |
| **Đã thu đủ** | Đã nhận đủ tổng tiền. |
| **Đã xoá nợ** | Kế toán quyết định không thu nữa, có lý do. |
| **Bản nháp** | Đã giữ các khoản nhưng chưa xuất; chưa phải thu. |
| **Đã huỷ** | Hoá đơn đã xuất rồi bị huỷ, có lý do; giữ số, không còn phải thu. |

## Ghi nhận hoá đơn (kế toán)

Các khoản cần xuất hoá đơn đến từ dự án: khi trưởng dự án đánh dấu một khoản sẵn sàng xuất hoá đơn, nó vào hàng **Chờ xuất hoá đơn** (xem trang **Chờ xuất hoá đơn**). Trên trang Công nợ, mục **Ghi nhận hoá đơn** liệt kê các khoản này, gom theo **khách hàng** và **pháp nhân**.

1. Trong một nhóm, tick các khoản thuộc hoá đơn bạn vừa xuất trên phần mềm kế toán. Mỗi hoá đơn chỉ cho **một khách hàng** và **một pháp nhân**.
2. Với khoản chưa có số tiền, nhập **Số tiền**.
3. Điền **Số hoá đơn**, **Ngày xuất**, chọn **Thuế GTGT** (trong các thuế suất được phép theo tham số đang hiệu lực), **Ghi chú**.
4. Bấm **Ghi nhận hoá đơn**. Nếu chưa có số hoá đơn, tick **Lưu thành bản nháp — chưa xuất, có thể chưa có số hoá đơn** rồi **Lưu bản nháp**: bản nháp giữ các khoản (không hoá đơn nào khác lấy được), và trên trang hoá đơn bạn **Sửa bản nháp**, **Xuất hoá đơn** (nhập số và ngày theo hệ thống kế toán; mọi khoản phải có số tiền) hoặc **Xoá bản nháp** (các khoản trở lại danh sách chờ xuất hoá đơn).

Hệ thống:

- Tính tiền dịch vụ, thuế GTGT và tổng cộng.
- Tính **hạn thu** = ngày xuất + hạn thanh toán — lấy theo **hợp đồng** của dự án nếu có, nếu không thì theo **khách hàng**, nếu không nữa thì theo mặc định của công ty.
- Đánh dấu các khoản đã chọn là đã xuất hoá đơn.

Số hoá đơn không được trùng với hoá đơn đã ghi nhận.

## Trang một hoá đơn

Phần đầu: pháp nhân, ngày xuất, hạn thu, số ngày trễ; dòng số liệu "tiền dịch vụ + thuế GTGT (x%) = tổng · đã thu · còn". Bên dưới là **Các khoản trong hoá đơn** và **Thanh toán**.

### Ghi nhận thanh toán

1. Ở khung **Ghi nhận thanh toán**, nhập **Ngày nhận**, **Số tiền (VNĐ)** (lớn hơn 0), **Hình thức** (Chuyển khoản, Tiền mặt, Cấn trừ, Khác), **Tham chiếu** (số giao dịch ngân hàng…).
2. Bấm **Ghi nhận thanh toán**.

Số tiền không được lớn hơn số còn phải thu của hoá đơn. Hoá đơn tự chuyển **Thu một phần** hoặc **Đã thu đủ**. Ghi nhầm thì bấm **Huỷ khoản thu** ở khoản thanh toán đó và ghi **Lý do huỷ**: khoản thanh toán vẫn nằm trong danh sách, gạch ngang kèm lý do, và không còn được tính vào số đã thu, công nợ hay hoa hồng.

### Huỷ hoá đơn

Hoá đơn đã xuất không bị xoá. Nếu hoá đơn sai, huỷ nó trên phần mềm kế toán rồi bấm **Huỷ hoá đơn** ở đây, ghi **Lý do huỷ hoá đơn**: hoá đơn giữ số của nó, chuyển **Đã huỷ**, không còn phải thu, và các khoản trở lại hàng **Chờ xuất hoá đơn** để ghi vào hoá đơn thay thế. Hãy huỷ các khoản thanh toán của hoá đơn trước; hoá đơn đã xoá nợ không huỷ được.

### Xoá nợ

Khi công ty quyết định không thu phần còn lại: mở **Xoá nợ**, nhập **Lý do** (bắt buộc), xác nhận. Hoá đơn chuyển **Đã xoá nợ** và trang ghi "Đã xoá nợ: …". Hoá đơn đã thu đủ hoặc đã xoá nợ không ghi nhận thêm được.

## Nhắc công nợ

- Sau hạn thu, vào các mốc ngày quá hạn do công ty quy định, **người phụ trách khách hàng** và **kế toán** của pháp nhân nhận thông báo **Hoá đơn quá hạn** ("Hoá đơn … của … đã quá hạn … ngày").
- Trang khách hàng hiện số **Phải thu** và **Quá hạn**; danh sách khách hàng có cột **Quá hạn**.
- Khách hàng đang **Tạm ngưng tín dụng** được cảnh báo trên trang cơ hội của khách. Quản lý kinh doanh hoặc kế toán đặt tạm ngưng tín dụng ở mục **Hạn thanh toán và tín dụng** của trang khách hàng.

Các mốc nhắc và hạn thanh toán mặc định là quy định của công ty, xem ở tab **Cài đặt**.

## Mẹo

- Ghi nhận hoá đơn **ngay** khi xuất trên phần mềm kế toán, để hạn thu và nhắc nợ chạy đúng.
- Ghi **Tham chiếu** cho mỗi thanh toán để đối chiếu sao kê dễ dàng.
- Hoa hồng kinh doanh được tính trên **tiền đã thu** — ghi nhận thanh toán đúng ngày giúp bảng kê hoa hồng chính xác (xem trang **Hoa hồng kinh doanh**).
