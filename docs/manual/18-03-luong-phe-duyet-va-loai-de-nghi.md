# Luồng phê duyệt & loại đề nghị

Mọi yêu cầu cần người khác đồng ý trong SuZu One — nghỉ phép, làm thêm giờ, đổi thông tin, báo giá, đề nghị tuyển dụng, thư mời nhận việc, các loại đề nghị tự thiết kế… — đi qua một bộ máy phê duyệt chung. Mỗi loại yêu cầu có sẵn một **luồng mặc định**. Trang này hướng dẫn quản trị viên **thay luồng mặc định** cho cả tập đoàn hoặc cho từng pháp nhân, và giới thiệu màn hình **Loại đề nghị**.

Cách một yêu cầu chạy qua luồng (không tự duyệt, bỏ qua bước không áp dụng, người dự phòng, ủy quyền…) và bảng luồng mặc định của từng loại được mô tả ở trang **Luồng phê duyệt hoạt động thế nào**.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem và sửa luồng của một pháp nhân | **Quản trị nhân sự** có phạm vi bao trùm pháp nhân đó, **Chủ sở hữu**. |
| Xem và sửa luồng áp dụng cho **Cả tập đoàn** | **Quản trị nhân sự** phạm vi toàn tập đoàn, **Chủ sở hữu**. |
| Thiết kế loại đề nghị | Như trên. |

## Trang Luồng phê duyệt

Mở **Quản trị** → [Luồng phê duyệt](/admin/approval-flows). Trang có ba phần:

1. **Mặc định** — luồng có sẵn của từng loại yêu cầu, viết gọn dạng "Quản lý trực tiếp → Trưởng phòng (days > 3)". Ký hiệu **→** là bước sau, **‖** là bước mở cùng lúc với bước trước, **+** là nhiều quy tắc người duyệt trong cùng một bước.
2. **Luồng đã cấu hình** — các luồng đã thay, mỗi luồng có nhãn **Cả tập đoàn** hoặc tên pháp nhân, nhãn **Tắt** nếu đang tắt. Bấm vào một luồng để sửa. Nếu chưa có luồng nào: "Chưa có luồng cấu hình: mọi loại yêu cầu theo mặc định."
3. **Thêm hoặc thay luồng** — biểu mẫu tạo luồng mới.

Khi một yêu cầu được gửi, hệ thống chọn luồng theo thứ tự: luồng **của pháp nhân** đó → luồng **cả tập đoàn** → luồng **mặc định**. Yêu cầu đã gửi giữ nguyên luồng lúc gửi; sửa luồng chỉ ảnh hưởng tới yêu cầu mới.

Hai trường hợp đặc biệt:

- **Điều chuyển**, **Thăng chức / bổ nhiệm**, **Chấm dứt hợp đồng**: chỉ đi qua phê duyệt **khi bạn đã lưu một luồng** cho loại đó (cả tập đoàn hoặc một pháp nhân). Chưa có luồng thì thay đổi của Nhân sự có hiệu lực ngay như trước. Có luồng thì việc lưu của Nhân sự thành đề xuất, và người duyệt cuối đồng ý là thay đổi được thực hiện.
- **Thay đổi quy định nghỉ phép**, **Thay đổi quy định chấm công**: luồng **cố định** — luôn tới **Chủ sở hữu**; một luồng cấu hình cho hai loại này bị bỏ qua. Chủ sở hữu mở đề xuất trong hộp duyệt (trang **Đề xuất thay đổi quy định**), xem từng trường so với quy định đang áp dụng rồi duyệt hoặc từ chối; không có "trả lại".

## Soạn một luồng

1. Chọn **Loại yêu cầu**.
2. Chọn **Áp dụng cho**: **Cả tập đoàn** hoặc một pháp nhân.
3. Tick **Đang dùng**.
4. Với mỗi bước (**Thêm bước** để thêm):
   - **Bước … — mã**: một mã ngắn viết thường, không trùng giữa các bước (ví dụ `manager`, `finance`).
   - **Ai phải trả lời**: **Một người duyệt bất kỳ** (một người duyệt là đủ) hoặc **Tất cả người duyệt**.
   - **Mở cùng lúc với bước trước** — cho hai bước chạy song song (không dùng được cho bước đầu tiên).
   - **Người duyệt** — một hoặc nhiều quy tắc (**Thêm người duyệt**), xem bảng quy tắc bên dưới.
   - **Chỉ khi** — tick để bước chỉ áp dụng khi điều kiện đúng: chọn trường (ví dụ số ngày nghỉ, số tiền, số lượng cần tuyển — tuỳ loại yêu cầu), phép so sánh (=, ≠, >, ≥, <, ≤, thuộc) và giá trị.
   - **Xóa bước** nếu không cần.
5. Bấm **Lưu luồng**.

### Các quy tắc chọn người duyệt

| Quy tắc | Người được hỏi |
| --- | --- |
| **Quản lý trực tiếp** | Quản lý trực tiếp của người mà yêu cầu nói tới. |
| **Trưởng phòng** | Trưởng bộ phận của đơn vị người đó. |
| **Quản lý cấp trên N bậc** | Quản lý ở bậc thứ N trên chuỗi báo cáo (1–6). |
| **Người có quyền** | Những người có một quyền cụ thể, trong phạm vi bao trùm yêu cầu. |
| **Người giữ vai trò** | Những người giữ một vai trò cụ thể, trong phạm vi bao trùm yêu cầu. |
| **Một người cụ thể** | Đúng một người bạn chọn (phải còn đang làm việc). |

Để bỏ một luồng đã cấu hình và quay về mặc định, mở luồng đó và bấm **Về mặc định** (xác nhận "Xóa luồng này? Yêu cầu mới sẽ theo mặc định.").

### Quy tắc khi lưu

- Luồng cần ít nhất một bước và tối đa tám bước.
- Mỗi bước cần ít nhất một người duyệt.
- Cần **ít nhất một bước không có điều kiện**, nếu không sẽ có yêu cầu không ai duyệt.
- Bậc quản lý từ 1 đến 6.

### Một số quyền hay dùng với quy tắc "Người có quyền"

Ô chọn quyền hiển thị mã quyền. Những mã hay dùng:

| Mã quyền | Ai đang có (theo vai trò mặc định) |
| --- | --- |
| `person:manage` | Nhân sự (Quản trị nhân sự, Chuyên viên nhân sự) |
| `payroll:approve` | Ban điều hành, Chủ sở hữu — người duyệt lương |
| `payroll:pay` | Tài chính – Kế toán — người chi trả |
| `recruit:manage` | Người làm tuyển dụng |
| `crm:manage` | Quản lý kinh doanh (Ban điều hành, Giám đốc pháp nhân) |
| `pjm:commercial` | Người xem phí dự án và xuất hoá đơn (Tài chính, Ban điều hành, Giám đốc pháp nhân) |
| `asset:manage` | Quản lý tài sản |

> [!TIP]
> Dùng **Người có quyền** hoặc **Người giữ vai trò** thay cho **Một người cụ thể** khi có thể: luồng sẽ tự đúng khi nhân sự thay đổi, không cần sửa lại mỗi lần có người nghỉ việc.

### Ví dụ

- *Đề nghị tuyển dụng của pháp nhân A cần thêm Ban điều hành duyệt khi tuyển từ 3 người trở lên*: luồng cho pháp nhân A gồm bước 1 **Quản lý trực tiếp**, bước 2 **Người có quyền** `recruit:manage`, bước 3 **Người giữ vai trò** Ban điều hành, **Chỉ khi** headcount ≥ 3.
- *Nghỉ phép ở pháp nhân B do trưởng phòng duyệt luôn, không qua quản lý trực tiếp*: luồng cho pháp nhân B với một bước **Trưởng phòng**.

## Loại đề nghị

Mở **Quản trị** → [Loại đề nghị](/admin/request-types). Đây là nơi thiết kế các **đề nghị tự định nghĩa** (mua sắm, tạm ứng, thanh toán, giấy xác nhận…) mà không cần lập trình: biểu mẫu với các trường, luồng duyệt riêng, nhắc và leo thang, đề nghị kèm theo.

Danh sách cho biết tên, mã, số trường, số ngày nhắc, số đề nghị kèm theo, phạm vi (**Toàn tập đoàn** hoặc một pháp nhân), nhãn **Chỉ kèm theo** và **Đã tắt**. Bấm **Thêm loại đề nghị** để tạo mới.

Hướng dẫn chi tiết từng bước — thiết kế biểu mẫu, trường hiện theo điều kiện, luồng duyệt, nhắc và leo thang, đề nghị kèm theo, tắt và bật lại — có ở trang **Thiết kế loại đề nghị**.

## Mẹo

- Trước khi thay luồng của cả tập đoàn, hãy thử với một pháp nhân.
- Khi yêu cầu đến sai người, nguyên nhân thường là **hồ sơ thiếu quản lý trực tiếp** hoặc **vai trò cấp sai phạm vi** — kiểm tra hồ sơ nhân sự và trang **Phân quyền** trước khi sửa luồng.
- Mọi thay đổi luồng được ghi vào **Nhật ký hệ thống**.
