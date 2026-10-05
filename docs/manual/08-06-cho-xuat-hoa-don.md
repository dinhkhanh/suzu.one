# Chờ xuất hoá đơn

**Chờ xuất hoá đơn** là hàng chờ của **Tài chính – Kế toán**: những khoản tiền từ dự án đã đủ điều kiện xuất hoá đơn. SuZu One không tự xuất hoá đơn — kế toán xuất ở hệ thống kế toán, rồi ghi lại số và ngày hoá đơn ở đây (hoặc ghi nhận không thu kèm lý do).

## Ai dùng

Người có quyền thương mại của dự án: **Tài chính – Kế toán**, **Ban điều hành**, **Giám đốc pháp nhân** — mỗi người chỉ thấy khoản của những pháp nhân mình phụ trách (quyền cấp tập đoàn thấy cả khoản của dự án cấp tập đoàn). Mục **Chờ xuất hoá đơn** nằm ở nhóm **Quản lý** trên thanh bên và chỉ hiện với những người này.

## Khoản tiền đến từ đâu

| Nguồn | Khi nào khoản được tạo |
| --- | --- |
| **Mốc thanh toán** | Khi mốc được đánh dấu xong — với dự án có khách hàng, chỉ sau khi khách ký biên bản nghiệm thu của mốc |
| **Phí retainer tháng** | Khi tháng retainer kết thúc — với dự án có khách hàng, chỉ sau khi khách ký biên bản của tháng |
| **Biên bản nghiệm thu** | Khi biên bản toàn dự án được ký: phần phí chưa xuất theo mốc và tháng |
| **Nhập tay** | Khi người có quyền thêm một khoản thủ công |

Mỗi nguồn tự động chỉ tạo đúng một khoản (một mốc, một tháng, một biên bản), kể cả khi hai người cùng bấm hay tác vụ tự động chạy lại. Khi có khoản mới, kế toán của pháp nhân nhận thông báo *Có khoản chờ xuất hoá đơn*.

## Xem hàng chờ

1. Mở [Chờ xuất hoá đơn](/projects/billing).
2. Lọc theo **Pháp nhân** (nếu bạn phụ trách nhiều pháp nhân) và **Trạng thái**: **Chờ xuất hoá đơn** (mặc định), **Đã xuất hoá đơn**, **Không thu** hoặc **Tất cả**; bấm **Lọc**.
3. Với trạng thái chờ, dòng đầu cho biết *… khoản chờ xuất, tổng …*.

Mỗi khoản hiện: mã dự án và tên dự án (bấm được nếu bạn mở được dự án), nguồn, số tiền (hoặc **Chưa có số tiền**), khách hàng, pháp nhân, số hợp đồng / PO (*HĐ/PO …*), ngày tạo, và biên bản nghiệm thu kèm theo (nếu có).

## Xử lý một khoản

Mỗi khoản đang chờ có hai nút **Xuất hoá đơn** và **Không thu**.

### Sửa số tiền

Khoản chưa xuất hoá đơn mà sai số tiền: mở **Sửa số tiền**, nhập **Số tiền đúng (VND)** (để trống nếu chưa thoả thuận) và **Lý do sửa**, bấm **Lưu số tiền**. Khoản ghi lại số trước, số sau, người sửa và lý do.

### Khoản của khách hàng

Với khoản có khách hàng, nút **Xuất hoá đơn** dẫn sang mục **Công nợ** (*Ghi nhận hoá đơn ở mục Công nợ — khoản này sẽ được đánh dấu đã xuất hoá đơn và công nợ của khách được theo dõi*). Ghi hoá đơn ở đó để số phải thu của khách được theo dõi — xem chương **Khách hàng & kinh doanh**.

### Khoản nội bộ

1. Chọn **Xuất hoá đơn**.
2. Điền **Số hoá đơn**, **Ngày hoá đơn** và — nếu khoản chưa có — **Số tiền (VND)**.
3. Bấm **Ghi nhận đã xuất**. Khoản chuyển **Đã xuất hoá đơn** (*Hoá đơn … ngày …* kèm tên người ghi).

### Không thu

Chọn **Không thu**, ghi **Lý do không thu**, bấm **Xác nhận không thu**. Khoản chuyển **Không thu** kèm lý do.

Khi khoản được xuất hoá đơn, account phụ trách dự án nhận thông báo *Đã xuất hoá đơn*.

## Thêm khoản thủ công

Mở **Thêm khoản thủ công** cuối trang (hoặc cuối tab **Nghiệm thu** của một dự án):

1. Nhập **Mã dự án** (khi thêm từ hàng chờ chung).
2. Nhập **Nội dung**, **Số hợp đồng / PO** (không bắt buộc) và **Số tiền (VND)**.
3. Lưu. Khoản mới vào hàng chờ với nguồn **Nhập tay**.

> [!NOTE]
> Trên tab **Kế hoạch**, mỗi mốc thanh toán cho biết vì sao chưa có khoản: *Chưa chuyển kế toán: chờ khách ký biên bản nghiệm thu*, *mốc chưa được đánh dấu hoàn thành*, hay *biên bản nghiệm thu toàn dự án đã tính phần phí này*. Mốc đang có biên bản nghiệm thu hoặc đã có khoản chuyển kế toán thì không xoá được.

> [!TIP]
> Trên tab **Nghiệm thu** của mỗi dự án, phần **Các khoản chuyển kế toán** cho account và trưởng dự án thấy khoản nào đã chuyển kế toán và đang ở trạng thái nào — người không có quyền thương mại sẽ không thấy số tiền.
