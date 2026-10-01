# Duyệt đơn nghỉ

Trang này dành cho người duyệt đơn nghỉ: quản lý trực tiếp, trưởng bộ phận, người được ủy quyền, và nhân sự khi cần can thiệp vào đơn của người khác.

## Ai duyệt đơn nghỉ

Theo luồng mặc định:

1. **Bước 1 — Quản lý trực tiếp** của người xin nghỉ. Một người duyệt là đủ.
2. **Bước 2 — Trưởng bộ phận**: chỉ áp dụng khi đơn **trên 3 ngày**. Người được hỏi là người giữ vai trò **Trưởng bộ phận** phụ trách đơn vị của người xin nghỉ; một người duyệt là đủ.

Một số quy tắc chung:

- Quản trị viên có thể thay luồng này cho từng pháp nhân hoặc cả tập đoàn ở [Luồng phê duyệt](/admin/approval-flows) (menu **Quản trị → Luồng phê duyệt**). Đơn đã gửi giữ nguyên luồng tại thời điểm gửi.
- Không ai duyệt đơn của chính mình. Nếu một bước không có người phù hợp (người xin nghỉ chưa có quản lý, hoặc quản lý đã nghỉ việc), bước đó được chuyển cho **Chủ sở hữu** hệ thống.
- Nếu bạn đang ủy quyền phê duyệt, đơn mới đến người được ủy quyền thay bạn.

## Nhận và mở đơn

- Khi đến lượt bạn, bạn nhận thông báo "… gửi yêu cầu: Nghỉ phép". Bấm vào thông báo để mở đơn.
- Tất cả đơn đang chờ bạn nằm ở [Phê duyệt](/approvals) (menu **Hôm nay → Phê duyệt**), thẻ **Đang chờ tôi (…)**.
- Thông báo có thể kèm nút **Duyệt** để duyệt nhanh. Nút này mở trang **Duyệt nhanh**: bạn vẫn phải đăng nhập, đọc lại nội dung rồi bấm **Duyệt**. Liên kết chỉ dùng được một lần, có hạn, và chỉ dành cho đúng bạn.

## Trang đơn nghỉ: cần xem gì trước khi quyết định

Trang đơn hiện:

- **Thời gian** và **Số ngày phép** — số ngày thực tế bị tính theo lịch làm việc của người xin nghỉ.
- **Các ngày được tính** — từng ngày, có ghi chú **Buổi sáng** / **Buổi chiều** / **Theo giờ** nếu nghỉ một phần.
- **Số dư hiện tại** của loại phép đó (với loại phép có theo dõi số dư), kèm số ngày đang chờ duyệt.
- **Lý do** và **Tệp đính kèm** (bấm **Mở** để xem tệp trong cửa sổ xem trước).
- **Cũng nghỉ trong những ngày này** — đồng nghiệp cùng nhóm nghỉ trùng ngày. Người duyệt thấy cả những người có đơn **đang chờ duyệt**, không chỉ đơn đã duyệt.
- Cảnh báo quân số: "Vào …, nhóm của bạn sẽ có dưới … người đi làm." nếu nhóm có quy định **Quân số tối thiểu**. Đơn không bị chặn; bạn quyết định có duyệt hay không.
- **Kế hoạch làm thay** (nếu có): những việc rơi vào kỳ nghỉ và ai làm thay, ví dụ "3/5 việc có người làm thay".
- **Lịch sử** — các bước duyệt, ai đang chờ, ai đã trả lời, các ý kiến.

Nếu người nộp đơn không phải người nghỉ (HR nộp thay), dưới tên người nghỉ có dòng "… nộp thay".

## Ra quyết định

Trong khung **Quyết định của bạn**:

1. Nhập **Ý kiến** nếu cần. Ý kiến **bắt buộc** khi trả lại hoặc từ chối.
2. Bấm một trong ba nút:
   - **Duyệt** — chuyển đơn sang bước tiếp theo, hoặc hoàn tất nếu đây là bước cuối.
   - **Trả lại để chỉnh sửa** — người xin nghỉ thấy trạng thái **Trả lại để sửa**, đọc ý kiến của bạn và gửi lại bằng nút **Sửa**.
   - **Từ chối** — đơn kết thúc ở trạng thái **Từ chối**, không trừ ngày phép nào.

Người xin nghỉ nhận thông báo về quyết định của bạn.

### Khi đơn được duyệt ở bước cuối

- Hệ thống kiểm tra lại số dư. Nếu trong lúc chờ số dư đã giảm (ví dụ một đơn khác vừa được duyệt), bạn thấy lỗi "Không đủ số ngày phép còn lại." và đơn chưa được duyệt.
- Số ngày bị trừ khỏi số dư, bảng công những ngày đó cập nhật thành nghỉ phép.
- Với loại phép **nghỉ dài hạn**, kỳ nghỉ được ghi lên quá trình công tác của người đó.

> [!WARNING]
> Nếu một phần kỳ nghỉ nằm trong tháng đã **khoá bảng công**, đơn không duyệt được ("Một phần kỳ nghỉ nằm trong tháng đã khoá bảng công…"). Hãy trao đổi với nhân sự: họ ghi điều chỉnh bảng công cho tháng đó thay vì duyệt đơn.

## Duyệt nhiều đơn một lúc

Đơn nghỉ có thể duyệt hàng loạt mà không cần mở từng đơn:

1. Vào [Phê duyệt](/approvals) → **Đang chờ tôi (…)**.
2. Tích ô **Chọn** ở từng đơn, hoặc **Chọn tất cả (…)**.
3. Bấm **Duyệt mục đã chọn (…)** và xác nhận.

> [!TIP]
> Duyệt hàng loạt tiện cho các đơn ngắn, quen thuộc. Với đơn dài ngày hoặc có cảnh báo thiếu người, hãy mở đơn để xem lịch nhóm và kế hoạch làm thay trước.

## Hỏi lại, chuyển đơn, ủy quyền

- **Thêm ý kiến** — trên trang đơn, gửi câu hỏi hoặc ghi chú mà chưa quyết định. Người xin nghỉ nhận thông báo.
- **Chuyển yêu cầu này cho người khác** — giao riêng đơn này cho một người khác trả lời thay bạn, kèm **Ghi chú**. Người được chuyển vẫn phải đủ điều kiện duyệt loại yêu cầu này.
- **Ủy quyền phê duyệt** — khi bạn đi vắng, vào [Ủy quyền phê duyệt](/approvals/delegation), chọn **Ủy quyền cho**, **Loại yêu cầu** (một loại hoặc **Mọi loại yêu cầu**), **Từ ngày**, **Đến ngày**, **Lý do**, và tích **Chuyển luôn các yêu cầu đang chờ tôi** nếu muốn giao cả các đơn đang chờ. Bấm **Ủy quyền**. Bạn có thể **Kết thúc ngay** bất cứ lúc nào. Người được ủy quyền nhận thông báo.

## Nhân sự can thiệp vào đơn

Nhân sự có quyền quản lý nghỉ phép với một người thì xem được mọi đơn nghỉ của người đó (dù không nằm trong luồng duyệt) và có thể:

- Kết thúc một đơn đang chờ duyệt của người khác bằng nút **Rút đơn** trên trang đơn — vì bạn không phải người nộp, đơn chuyển sang **Đã huỷ**.
- **Huỷ nghỉ** một đơn đã duyệt, kể cả khi kỳ nghỉ đã bắt đầu, kèm **Lý do (không bắt buộc)**. Số ngày được cộng lại, bảng công tính lại, và nhân viên nhận thông báo "Nhân sự đã huỷ đơn nghỉ của bạn".
- **Sửa** đơn thay nhân viên — đơn cũ kết thúc và đơn mới được gửi duyệt lại.
- Nộp đơn thay nhân viên (xem **Quản lý số dư phép**).

Nhân sự **không** tự động có quyền duyệt; họ chỉ duyệt khi luồng phê duyệt đưa họ vào một bước.
