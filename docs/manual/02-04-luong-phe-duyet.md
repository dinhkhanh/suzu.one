# Luồng phê duyệt hoạt động thế nào

Trang này giải thích **ai được hỏi, theo thứ tự nào** khi một yêu cầu được gửi, và những quy tắc tự động đứng sau. Người gửi và người duyệt không cần cấu hình gì — nhưng hiểu cách luồng chạy giúp bạn biết yêu cầu của mình đang ở đâu và vì sao một người cụ thể được hỏi.

## Luồng gồm những gì

Mỗi loại yêu cầu có một **luồng phê duyệt**: danh sách tối đa tám **bước**, chạy lần lượt từ trên xuống. Mỗi bước có:

- **Người duyệt** — không ghi tên cứng, mà ghi theo **quy tắc** (xem bảng dưới), để hệ thống tự tìm đúng người cho từng người gửi.
- **Ai phải trả lời**:
  - **Một người duyệt bất kỳ** — người đầu tiên duyệt là bước xong (lịch sử ghi "một người duyệt là đủ").
  - **Tất cả người duyệt** — mọi người trong bước đều phải duyệt (lịch sử ghi "tất cả phải duyệt").
- **Chỉ khi** (không bắt buộc) — điều kiện để bước có hiệu lực, ví dụ "số ngày nghỉ > 3". Khi điều kiện không đúng, bước được bỏ qua.
- **Mở cùng lúc với bước trước** (không bắt buộc) — hai bước được hỏi song song; yêu cầu chỉ đi tiếp khi cả nhóm bước đó xong.

### Các quy tắc chọn người duyệt

| Quy tắc | Ai được hỏi |
| --- | --- |
| **Quản lý trực tiếp** | Quản lý trực tiếp ghi trong hồ sơ của người mà yêu cầu nói tới. |
| **Trưởng phòng** | Những người giữ vai trò **Trưởng bộ phận** có phạm vi bao gồm người đó. |
| **Quản lý cấp trên N bậc** | Đi ngược chuỗi quản lý N bậc (1 = quản lý trực tiếp, 2 = quản lý của quản lý…, tối đa 6). |
| **Người có quyền** | Những người có một quyền nhất định trên người đó (ví dụ quyền quản lý hồ sơ nhân sự). |
| **Người giữ vai trò** | Những người giữ một vai trò (ví dụ **Tài chính – Kế toán**) có phạm vi phù hợp. |
| **Một người cụ thể** | Đúng một người được chỉ định. |

## Những quy tắc tự động

Khi bạn gửi yêu cầu, hệ thống biến các quy tắc thành tên người cụ thể và áp dụng thêm:

- **Không ai tự duyệt**: người gửi và người mà yêu cầu nói tới bị loại khỏi mọi bước. Ví dụ, trưởng bộ phận xin nghỉ thì đơn không quay lại chính họ.
- **Chỉ người đang làm việc**: người đã nghỉ việc hoặc chưa bắt đầu làm không được hỏi.
- **Không hỏi một người hai lần**: nếu quản lý trực tiếp của bạn cũng chính là trưởng phòng, và họ là người duyệt duy nhất ở cả hai bước, họ chỉ được hỏi một lần; bước sau được bỏ qua.
- **Có người dự phòng**: nếu quy tắc của một bước không tìm được ai, yêu cầu được chuyển tới **Chủ sở hữu**. Nếu vẫn không có ai, yêu cầu không gửi được và bạn thấy thông báo "Không có ai để duyệt yêu cầu này. Vui lòng liên hệ Nhân sự."
- **Ủy quyền đang hiệu lực** được áp dụng: người duyệt thay được hỏi thay cho người vắng mặt (xem trang **Ủy quyền phê duyệt**).
- **Bỏ qua bước không áp dụng**: bước có điều kiện không đúng bị bỏ qua và không hiện trong lịch sử. Nếu mọi bước đều bị bỏ qua, yêu cầu được duyệt ngay.
- **Luồng được "chốt" lúc gửi**: yêu cầu đi theo luồng có hiệu lực vào lúc gửi. Quản trị viên sửa luồng sau đó chỉ ảnh hưởng đến yêu cầu mới.

## Yêu cầu đi qua các bước ra sao

1. Bước đầu tiên (hoặc nhóm bước song song đầu tiên) được mở; người duyệt của bước đó được thông báo.
2. Khi bước xong (một người hoặc tất cả đã duyệt, tuỳ bước), bước tiếp theo được mở và người duyệt của nó được thông báo.
3. Khi bước cuối xong, yêu cầu thành **Đã duyệt**, thay đổi được áp dụng và người gửi được thông báo.
4. Bất cứ lúc nào, chỉ một người **Từ chối** là yêu cầu kết thúc; chỉ một người **Trả lại để chỉnh sửa** là yêu cầu về lại người gửi. Khi người gửi **Gửi lại**, luồng chạy lại từ bước đầu tiên và mọi người duyệt được hỏi lại.

## Luồng mặc định của từng loại yêu cầu

Đây là luồng đi kèm phần mềm. Công ty có thể thay luồng của bất kỳ loại nào, cho cả tập đoàn hoặc riêng một pháp nhân — vì vậy luồng thực tế ở công ty bạn có thể khác.

| Loại yêu cầu | Luồng mặc định |
| --- | --- |
| **Nghỉ phép** | Quản lý trực tiếp → Trưởng phòng (chỉ khi nghỉ trên 3 ngày) |
| **Bổ sung công**, **Làm việc từ xa / ngoài văn phòng**, **Làm thêm giờ**, **Làm việc ngày nghỉ, ngày lễ** | Quản lý trực tiếp |
| **Thay đổi thông tin cá nhân** | Nhân sự phụ trách người đó (**Quản trị nhân sự**, **Chuyên viên nhân sự**) |
| **Đơn xin nghỉ việc** | Quản lý trực tiếp |
| Các loại **Đề nghị** | Theo luồng quản trị viên thiết kế cho từng loại; nếu chưa có thì quản lý trực tiếp |
| **Duyệt xuất bản trang tri thức** | Người quản lý tri thức của pháp nhân đó |
| **Điều chỉnh lương** | **Chủ sở hữu** |
| **Duyệt brief khởi động dự án** | Trưởng nhóm phụ trách dự án |
| **Yêu cầu thay đổi dự án** | Người quản lý dự án → bộ phận thương mại/tài chính (chỉ khi thay đổi phí) |
| **Báo giá** | Lãnh đạo kinh doanh của pháp nhân |
| Nhu cầu tuyển dụng | Quản lý trực tiếp → bộ phận tuyển dụng |
| Thư mời nhận việc | Trưởng bộ phận → người duyệt lương |
| **Điều chuyển**, **Thăng chức / bổ nhiệm**, **Chấm dứt hợp đồng** | Không có luồng mặc định: Nhân sự ghi nhận trực tiếp. Chỉ khi quản trị viên lưu một luồng cho loại này, việc ghi nhận mới thành yêu cầu chờ duyệt — và được thực hiện khi người duyệt cuối đồng ý. |
| **Thay đổi quy định nghỉ phép**, **Thay đổi quy định chấm công** | **Chủ sở hữu** — luồng cố định, không đổi được |

> [!TIP]
> Muốn biết chính xác ai sẽ duyệt đơn nghỉ phép hoặc đơn chấm công của bạn? Hỏi **Hỏi SuZu AI** — trợ lý tra theo luồng đang áp dụng cho bạn và trả lời bằng tên người.

## Nhắc hạn và leo thang tự động

Với các loại **Đề nghị**, người thiết kế loại đề nghị có thể đặt mục **Nhắc và leo thang**:

- **Nhắc sau (ngày)**: người duyệt để yêu cầu chờ quá số ngày này sẽ nhận lời nhắc "Đề nghị đang chờ bạn duyệt".
- **Leo thang**: nếu vẫn chưa ai trả lời sau số ngày leo thang, người được chỉ định (ví dụ quản lý của người duyệt đang im lặng) nhận thông báo "Đề nghị quá hạn duyệt".

Mỗi lượt chờ chỉ được nhắc một lần và leo thang một lần. Số ngày được tính từ khi bước đó mở; khi yêu cầu được gửi lại, đồng hồ tính lại từ đầu. Đặt 0 nghĩa là tắt. Việc kiểm tra chạy tự động mỗi ngày. Các loại yêu cầu khác (nghỉ phép, chấm công…) hiện không có nhắc hạn tự động.

## Theo dõi toàn công ty (Chủ sở hữu)

**Chủ sở hữu** có thêm trang [Tất cả đề nghị](/approvals/all), mở từ liên kết **Tất cả đề nghị** trên trang Phê duyệt. Đây là nơi xem mọi yêu cầu trong công ty, dù đang chờ ai duyệt — **chỉ để theo dõi**: bạn chỉ quyết định được khi đến lượt mình.

- Nút lọc trạng thái: **Đang mở** (đang chờ duyệt hoặc đang bị trả lại), **Đã xử lý**, **Tất cả**.
- Lọc theo **Loại đề nghị** (hoặc **Mọi loại**) và **Gửi từ ngày**, rồi bấm **Lọc**.
- Bảng có các cột **Yêu cầu**, **Người gửi**, **Gửi lúc**, **Trạng thái** và **Đang chờ** — tên những người đang được hỏi; với yêu cầu bị trả lại, đó là tên người gửi.
- Trang hiện tối đa 200 đề nghị mới nhất; nếu chạm mức này, hãy thu hẹp bộ lọc.
- Bấm vào yêu cầu để mở trang chi tiết đầy đủ.

Mỗi sáng, nếu hôm trước có đề nghị mới, chủ sở hữu nhận một thông báo tổng hợp dạng "n đề nghị mới hôm qua — … được gửi, … còn đang chờ", kèm liên kết mở danh sách từ ngày đó. Ngày không có đề nghị nào thì không có thông báo.

## Ai cấu hình luồng phê duyệt

Luồng được thiết lập ở [Luồng phê duyệt](/admin/approval-flows) (thanh bên, mục **Quản trị**), dành cho **Quản trị nhân sự** và **Chủ sở hữu**. Trên trang này:

- Phần **Mặc định** liệt kê luồng có sẵn của từng loại.
- Phần **Luồng đã cấu hình** liệt kê các luồng đã thay, áp dụng cho **Cả tập đoàn** hoặc một pháp nhân. Luồng của pháp nhân được ưu tiên hơn luồng cả tập đoàn.
- Mỗi luồng cần ít nhất một bước áp dụng cho mọi yêu cầu (không có điều kiện), để không yêu cầu nào thiếu người duyệt.
- **Về mặc định** xóa luồng đã cấu hình; yêu cầu mới lại theo luồng mặc định.

Chi tiết cách soạn luồng nằm ở chương **Quản trị hệ thống**. Nếu bạn thấy yêu cầu của mình đi tới sai người, hãy báo bộ phận Nhân sự — thường là do hồ sơ thiếu quản lý trực tiếp hoặc phân quyền chưa đúng phạm vi.
