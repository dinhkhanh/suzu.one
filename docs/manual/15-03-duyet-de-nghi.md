# Duyệt đề nghị

Trang này dành cho **người duyệt đề nghị**: quản lý trực tiếp, trưởng bộ phận, kế toán, Nhân sự, Ban điều hành. Đề nghị dùng chung bộ máy phê duyệt với nghỉ phép, chấm công… nên cách mở hộp duyệt, ủy quyền hay chuyển cho người khác được mô tả ở chương **Phê duyệt** (các trang **Duyệt yêu cầu** và **Ủy quyền phê duyệt**). Ở đây là những điều riêng của đề nghị.

## Bạn được hỏi khi nào

Bạn chỉ được hỏi khi **đến lượt bạn** trong luồng duyệt của đề nghị. Khi đó bạn nhận một thông báo, và đề nghị xuất hiện trong [Phê duyệt](/approvals) → **Đang chờ tôi**. Người ở các bước sau chỉ được hỏi khi bước trước đã duyệt.

Bạn không bao giờ duyệt đề nghị của chính mình.

## Luồng duyệt có sẵn

Khi hệ thống được cài đặt, mỗi loại đề nghị có sẵn một luồng duyệt như dưới đây. Quản trị viên có thể đổi bất cứ lúc nào (xem **Thiết kế loại đề nghị**), nên hãy coi bảng này là ví dụ; luồng thực tế của một đề nghị luôn hiện trong phần **Lịch sử** của nó.

| Loại đề nghị | Các bước duyệt |
| --- | --- |
| **Đề nghị mua sắm** | Quản lý trực tiếp → Tài chính – Kế toán → Ban điều hành (chỉ khi số tiền vượt ngưỡng) |
| **Đề nghị thanh toán** | Quản lý trực tiếp → Tài chính – Kế toán → Ban điều hành (chỉ khi vượt ngưỡng) |
| **Đề nghị thanh toán chi phí** | Quản lý trực tiếp → Tài chính – Kế toán → Ban điều hành (chỉ khi vượt ngưỡng) |
| **Đề nghị tạm ứng** | Quản lý trực tiếp → Tài chính – Kế toán → Ban điều hành (chỉ khi vượt ngưỡng) |
| **Đề nghị đi công tác** | Quản lý trực tiếp → Trưởng phòng → Tài chính – Kế toán (chỉ khi chi phí dự kiến vượt ngưỡng) |
| **Đề nghị cấp giấy xác nhận** | Nhân sự → Ban điều hành (chỉ khi xin giấy xác nhận thu nhập có ghi số lương) |

Ngưỡng tiền của từng bước là cấu hình của công ty, đặt trong luồng duyệt chứ không cố định trong phần mềm.

Một bước có thể giao cho **một người bất kỳ** trong nhóm người duyệt (ai trả lời trước thì bước đó xong) hoặc **tất cả người duyệt** (mọi người đều phải duyệt). Ví dụ bước Tài chính – Kế toán thường hỏi tất cả những người giữ quyền chi trả của pháp nhân, và chỉ cần một người duyệt.

## Đọc và quyết định một đề nghị

1. Mở đề nghị từ **Đang chờ tôi** hoặc từ thông báo.
2. Đọc các câu trả lời trong biểu mẫu. Tệp đính kèm (báo giá, hóa đơn…) mở được ngay trên trang.
3. Với **Đề nghị thanh toán chi phí**, xem bảng **Các khoản chi**: từng khoản, nhóm chi phí, hóa đơn kèm theo và tổng theo nhóm.
4. Nếu đề nghị được lập **kèm theo** một đề nghị khác (ví dụ tạm ứng cho một chuyến công tác), phía trên có khung **Lập kèm theo** dẫn về đề nghị gốc — hãy mở xem chuyến đi đó là gì.
5. Ở khung **Quyết định của bạn**, nhập **Ý kiến** nếu cần, rồi bấm:
   - **Duyệt** — chuyển sang bước tiếp theo, hoặc kết thúc là **Đã duyệt** nếu đây là bước cuối;
   - **Trả lại để chỉnh sửa** — người gửi sửa và gửi lại;
   - **Từ chối** — đề nghị kết thúc.

Ý kiến là **bắt buộc khi trả lại hoặc từ chối**, để người gửi biết cần sửa gì hoặc vì sao không được.

Người gửi nhận thông báo về quyết định. Nếu bạn chỉ muốn hỏi thêm mà chưa quyết định, dùng **Thêm ý kiến** — những người liên quan đến đề nghị đều được báo.

> [!NOTE]
> Đề nghị không duyệt hàng loạt được trong hộp duyệt: mỗi đề nghị phải được mở và đọc trước khi quyết định. Thông báo nhắc hạn cũng không có nút duyệt nhanh vì lý do này.

## Những đề nghị có hệ quả khi duyệt xong

- **Đề nghị thanh toán chi phí**: khi được duyệt ở bước cuối, khoản tiền tự động được đưa vào kỳ lương đang mở của pháp nhân người đề nghị (hoặc chờ đến kỳ lương sau). Xem trang **Đề nghị thanh toán chi phí**.
- **Đề nghị cấp giấy xác nhận**: duyệt xong, Nhân sự cấp giấy từ mẫu văn bản trên hồ sơ của nhân viên. Xem trang **Mẫu văn bản & cấp văn bản**.
- **Đề nghị đi công tác**: duyệt xong, người gửi mới lập được đề nghị tạm ứng và đề nghị quyết toán kèm theo chuyến đi.
- Các loại còn lại: duyệt xong là một sự đồng ý được ghi nhận; việc mua, chi tiền… vẫn do bộ phận liên quan thực hiện bên ngoài hệ thống.

## Nhắc hạn và leo thang

Mỗi loại đề nghị có thể được cài hai mốc, tính từ lúc bước của bạn bắt đầu chờ:

- **Nhắc sau (ngày)** — nếu bạn chưa trả lời sau số ngày này, bạn nhận một thông báo **Đề nghị đang chờ bạn duyệt**.
- **Leo thang sau (ngày)** — nếu vẫn chưa ai trả lời, hệ thống gửi thông báo **Đề nghị quá hạn duyệt** cho người được chỉ định trong cấu hình của loại đề nghị — ví dụ cấp trên của người duyệt, trưởng phòng, hoặc Ban điều hành. Thông báo leo thang không kèm nút duyệt: mục đích là để người đó hỏi vì sao đề nghị bị treo, không phải duyệt thay.

Việc kiểm tra chạy tự động mỗi sáng. Mỗi lượt chờ chỉ bị nhắc một lần và leo thang một lần. Ví dụ với cấu hình ban đầu, **Đề nghị tạm ứng** và **Đề nghị đi công tác** nhắc sau 1 ngày và leo thang sau 3 ngày; **Đề nghị mua sắm** nhắc sau 2 ngày và leo thang sau 5 ngày.

> [!TIP]
> Sắp nghỉ phép hoặc đi công tác dài? Hãy thiết lập **Ủy quyền phê duyệt** để đề nghị không bị treo và không bị leo thang trong lúc bạn vắng mặt.

## Kế toán: theo dõi tiền phải trả

Ngoài hộp duyệt, người giữ vai trò **Tài chính – Kế toán** có màn hình [Đề nghị thanh toán chi phí](/requests/claims) để xem mọi đề nghị hoàn tiền, khoản nào đã duyệt nhưng chưa vào kỳ lương. Xem trang **Đề nghị thanh toán chi phí**, phần 2.

## Quản trị viên: theo dõi theo loại

Người thiết kế loại đề nghị thấy mục **Theo dõi theo loại** ở cuối trang [Đề nghị](/requests): mỗi loại có **… đang chờ**, **… đã xử lý** và **trung vị … giờ** để trả lời. Một loại có thời gian trả lời trung vị cao là dấu hiệu luồng duyệt cần xem lại.
