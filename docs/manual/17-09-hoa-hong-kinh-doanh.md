# Hoa hồng kinh doanh

SuZu One tính **hoa hồng kinh doanh** trên **tiền đã thu** (chưa gồm thuế GTGT), theo **quy chế** do chủ doanh nghiệp duyệt. Mỗi tháng, mỗi người có một **bảng kê** kèm đầy đủ căn cứ: khoản thu nào, của hoá đơn nào, khách hàng nào, với vai trò gì. Sau khi bộ phận C&B xác nhận, bảng kê được đưa vào kỳ lương của người đó.

> [!IMPORTANT]
> Hoa hồng **không bao giờ tự động**: không có quy chế được duyệt thì không tính gì, và không có gì vào lương khi chưa có người xác nhận. Hoa hồng là dữ liệu **lương thưởng** — quản lý trực tiếp không xem được.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem bảng kê hoa hồng của chính mình | Người bán hàng, người phụ trách khách hàng có bảng kê. |
| Tính hoa hồng tháng, xem và xác nhận bảng kê | **C&B / Tiền lương** (và **Quản trị nhân sự**) phụ trách pháp nhân nơi người đó làm việc. |
| Đề xuất quy chế hoa hồng | Quản lý kinh doanh phạm vi toàn tập đoàn, hoặc người được đề xuất tham số (**Quản trị nhân sự**, **C&B / Tiền lương**). |
| Duyệt / từ chối quy chế | Chỉ **Chủ sở hữu**. |
| Xem bảng kê của tất cả | **Chủ sở hữu**. |

Trang hoa hồng yêu cầu **xác thực lại** danh tính: nếu lần đăng nhập xác thực của bạn đã quá vài phút, bạn được đưa sang trang **Xác thực lại** rồi quay về. Xem trang **Đăng nhập & bảo mật**.

## Mở trang Hoa hồng

Tab [Hoa hồng](/crm/commission) trong phân hệ **Khách hàng & kinh doanh**. Nếu chưa có quy chế nào được duyệt, trang ghi: "Chưa có quy chế hoa hồng nào được duyệt nên chưa tính gì."

## Quy chế hoa hồng

Mục **Quy chế** (dành cho người đề xuất, C&B và chủ sở hữu) liệt kê các quy chế: tên, phạm vi (một pháp nhân hoặc **Toàn tập đoàn**), thời gian hiệu lực, người hưởng, cách chia, các bậc tỷ lệ, và trạng thái (**Đề xuất**, **Đã duyệt**, **Từ chối**).

### Đề xuất một quy chế

1. Mở **Đề xuất quy chế**.
2. Điền:
   - **Tên**, **Pháp nhân** (hoặc toàn tập đoàn), **Từ ngày**.
   - **Người hưởng**: **Người phụ trách cơ hội**, **Quản lý khách hàng**, hoặc **Chia cho cả hai**. Khi chia, nhập **Phần của người phụ trách cơ hội (%) khi chia** — phần còn lại thuộc người quản lý khách hàng.
   - **Các bậc**: mỗi bậc có mức **Từ (VND)** và **Tỷ lệ (%)**. Mỗi bậc tính trên phần cơ sở của tháng vượt mức bắt đầu của bậc — giống cách tính thuế lũy tiến. Tỷ lệ tối đa 30%, các mức bắt đầu không được trùng.
3. Bấm **Gửi chủ doanh nghiệp duyệt**.

Chủ sở hữu thấy quy chế đang **Đề xuất** với hai nút **Duyệt** và **Từ chối**.

## Bảng kê hằng tháng

### Tính hoa hồng (C&B)

1. Chọn **Tháng** bằng ô chọn tháng.
2. Bấm **Tính hoa hồng tháng**. Hệ thống lập bảng kê ở trạng thái **Nháp** cho từng người hưởng, dựa trên các khoản thanh toán đã ghi nhận trong tháng và quy chế đang hiệu lực.

Dòng "Các tháng có bảng kê: …" cho biết những tháng đã có số liệu.

### Đọc một bảng kê

Mỗi bảng kê ghi người hưởng, trạng thái và **Cơ sở** tính. Mở ra để xem căn cứ:

- **Quy chế** áp dụng.
- Từng khoản thu: **Ngày thu**, **Hóa đơn**, **Khách hàng**, **Vai trò** (người phụ trách cơ hội / quản lý khách hàng), **Tiền thu chưa VAT**, **Tỷ lệ hưởng**, **Cơ sở**.
- Từng bậc: khoảng cơ sở, "cơ sở × tỷ lệ = số tiền".

### Xác nhận và đưa vào lương (C&B)

1. Kiểm tra bảng kê.
2. Bấm **Xác nhận và đưa vào lương**, xác nhận câu hỏi "Xác nhận bảng kê này? …".
3. Bảng kê được chốt cho tháng và đưa vào kỳ lương của người đó như một khoản thu nhập hoa hồng.

Người hưởng nhận thông báo **Bảng hoa hồng** ("Bảng hoa hồng tháng … của bạn đã sẵn sàng") — thông báo chỉ ghi tháng, không ghi số tiền.

| Trạng thái bảng kê | Nghĩa là |
| --- | --- |
| **Nháp** | Vừa tính, chưa xác nhận. Có thể tính lại. |
| **Đã xác nhận** | C&B đã xác nhận. |
| **Đã vào kỳ lương** | Đã nằm trong một kỳ lương. |

## Mẹo

- Hoa hồng phụ thuộc vào **thanh toán đã ghi nhận** ở tab **Công nợ**: thanh toán ghi sai tháng sẽ làm sai bảng kê.
- Người phụ trách cơ hội và người phụ trách khách hàng trên hệ thống chính là người được hưởng — hãy cập nhật khi bàn giao khách hàng hoặc cơ hội.
- Thắc mắc về bảng kê của mình, hãy hỏi bộ phận C&B kèm tháng và số hoá đơn liên quan.
