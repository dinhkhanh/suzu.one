# Phân loại, chu kỳ & tự động hóa

Trang này dành cho **trưởng nhóm**: cách nhận việc từ bên ngoài nhóm một cách có kiểm soát (biểu mẫu yêu cầu và hàng chờ phân loại), cách chia thời gian thành các chu kỳ cố định, và cách để hệ thống tự làm những bước lặp lại. Thành viên nhóm xem được hàng chờ, chu kỳ và quy tắc tự động, nhưng chỉ trưởng nhóm quyết định và chỉnh sửa.

## Biểu mẫu yêu cầu của nhóm

Biểu mẫu yêu cầu là "cửa trước" của nhóm: người ngoài nhóm điền form, yêu cầu vào hàng chờ của nhóm thay vì nhắn tin riêng.

Thiết lập ở mục **Biểu mẫu yêu cầu** cuối trang nhóm:

1. Bấm **Biểu mẫu mới**, đặt **Tên biểu mẫu** và **Hướng dẫn hiển thị phía trên biểu mẫu**.
2. Chọn **Yêu cầu được đưa vào**: một dự án đang chạy của nhóm, hoặc **Danh sách chờ của nhóm (không thuộc dự án)**.
3. Chọn **Ai được gửi yêu cầu**: **Nhân sự trong pháp nhân của nhóm** hoặc **Mọi người trong tập đoàn**. Cộng tác viên bên ngoài không gửi được; thành viên nhóm luôn gửi được.
4. Thêm **Câu hỏi** (tối đa 12): nội dung câu hỏi, **Kiểu trả lời** (**Văn bản ngắn**, **Văn bản dài**, **Chọn trong danh sách**, **Ngày**, **Đường dẫn (https)**), tích **Bắt buộc** nếu cần. Câu hỏi dạng danh sách cần ít nhất hai lựa chọn, mỗi dòng một lựa chọn.
5. Chọn **Checklist mọi yêu cầu đều có** nếu muốn mỗi yêu cầu mang sẵn checklist.
6. Bấm **Tạo biểu mẫu** (hoặc **Lưu biểu mẫu** khi sửa). Bỏ **Đang nhận yêu cầu** để đóng biểu mẫu (**Đã đóng**).

Mỗi biểu mẫu hiện số yêu cầu đã nhận. Cách người khác gửi yêu cầu: xem trang **Yêu cầu, mẫu & khách hàng**.

## Hàng chờ phân loại

Việc từ bên ngoài nhóm — gửi qua biểu mẫu, bàn giao từ nhóm khác — nằm ở **Hàng chờ phân loại** cho đến khi trưởng nhóm nhận, từ chối, gộp hoặc tạm hoãn. Mở từ liên kết **Hàng chờ phân loại (…)** trên trang nhóm, từ mục **Việc mới chờ bạn phân loại** trong **Việc của tôi**, hoặc từ thông báo *Việc mới chờ phân loại*.

Trang có hai phần **Chờ phân loại** và **Tạm hoãn**. Mỗi thẻ cho biết nguồn (**Biểu mẫu**, **Bàn giao**, **Yêu cầu**), ai gửi, khi nào, qua biểu mẫu nào, và những gì quy tắc đã **điền sẵn**. Với mỗi thẻ, trưởng nhóm chọn một trong bốn cách:

| Nút | Kết quả |
| --- | --- |
| **Nhận việc** | Chọn người phụ trách, dự án, hạn, ưu tiên rồi xác nhận — việc vào quy trình bình thường của nhóm |
| **Từ chối** | Ghi **Lý do (người yêu cầu sẽ đọc được)**; việc chuyển sang trạng thái hủy của nhóm |
| **Gộp vào việc khác** | Chọn việc có sẵn ở **Gộp vào** — dùng khi yêu cầu trùng |
| **Tạm hoãn** | Chọn **Đến ngày** (sau hôm nay); đến ngày đó, lúc nửa đêm việc tự trở lại hàng chờ |

Người yêu cầu theo dõi được kết quả trong **Biểu mẫu yêu cầu** → **Yêu cầu của tôi** và nhận thông báo khi trạng thái đổi.

> [!NOTE]
> Trong lúc chờ phân loại, việc chưa thuộc về ai: nó không hiện trong **Góc nhìn trưởng nhóm**, và trang công việc có dải thông báo *Việc này đang chờ trưởng nhóm phân loại*. Danh sách công việc ẩn việc chờ phân loại, trừ khi bạn tích **Hiện việc chờ phân loại**. Muốn từ chối, quy trình của nhóm cần có một trạng thái thuộc nhóm **Đã hủy**.

### Quy tắc phân loại

Phần **Quy tắc phân loại** (chỉ trưởng nhóm thấy) điền sẵn người phụ trách, dự án, nhãn hoặc ưu tiên khi việc vừa đến:

1. Bấm **Thêm quy tắc**, đặt **Tên quy tắc**.
2. **Khi**: chọn **Nguồn** (hoặc **Mọi nguồn**), **Biểu mẫu** (hoặc **Mọi biểu mẫu**), và **Từ khóa (cách nhau bởi dấu phẩy)**.
3. **Thì điền**: **Người phụ trách**, **Dự án**, **Nhãn**, **Ưu tiên** — ít nhất một thứ.
4. Đặt **Thứ tự**, tích **Đang dùng**, bấm **Lưu quy tắc**.

Quy tắc xếp trên được ưu tiên; nhãn thì cộng dồn từ mọi quy tắc khớp. Quy tắc chỉ *điền sẵn* — trưởng nhóm vẫn quyết định khi bấm **Nhận việc**.

## Chu kỳ

Chu kỳ là các khoảng thời gian cố định của nhóm (1–4 tuần). Việc chưa xong tự chuyển sang chu kỳ sau, kèm số lần đã chuyển.

**Bật chu kỳ**: trong **Quy định báo cáo ngày** cuối trang nhóm, chọn **Chu kỳ làm việc** (1, 2, 3 hoặc 4 tuần) và **Chu kỳ bắt đầu từ (thứ Hai)**, rồi **Lưu**. Chọn **Không dùng chu kỳ** để tắt.

Sau khi bật:

- Mỗi đêm hệ thống tạo chu kỳ hiện tại và chu kỳ kế tiếp, đóng chu kỳ vừa kết thúc và chuyển việc dở sang chu kỳ mới.
- Trên trang công việc, ô **Chu kỳ** cho phép xếp việc vào một chu kỳ đang mở; danh sách và dạng bảng lọc / sửa hàng loạt được theo chu kỳ.
- Trang **Chu kỳ** (liên kết trên trang nhóm) cho thấy **Chu kỳ #…** hiện tại với tiến độ *x/y xong*, số việc chuyển từ chu kỳ trước, số việc đã lên kế hoạch cho chu kỳ tới, và **Các chu kỳ đã qua** với số kế hoạch / xong / chuyển tiếp.

Chu kỳ đã đóng thì không thêm việc vào được nữa.

## Tự động hóa

Quy tắc "khi … thì …" chạy ngay khi công việc thay đổi, để đội không phải nhớ các bước lặp lại. Mỗi lần chạy được ghi vào lịch sử của công việc (người thực hiện ghi là **Tự động**).

Mở trang **Tự động hóa** từ liên kết trên trang nhóm (quy tắc chung của nhóm), hoặc mục **Tự động hóa** trong **Thành viên và thiết lập** của dự án (quy tắc riêng của dự án, chạy cùng quy tắc của nhóm). Chỉ trưởng nhóm được thêm và sửa; thành viên nhóm xem được quy tắc và các lần chạy.

### Quy tắc mẫu

Phần **Quy tắc mẫu** có sẵn ba quy tắc, bấm **Thêm** để dùng:

- **Gửi khách duyệt: hẹn 2 ngày làm việc** — khi việc vào bước khách duyệt, hạn được đặt 2 ngày làm việc kể từ hôm đó.
- **Khách yêu cầu sửa: mở lại và báo người làm** — việc quay lại bước làm và người được giao nhận thông báo.
- **Quá hạn 1 ngày: báo trưởng nhóm** — trưởng nhóm (và trưởng dự án) nhận thông báo.

Hai quy tắc đầu chỉ dùng được khi quy trình của nhóm có bước duyệt.

### Tự viết quy tắc

1. Bấm **Thêm quy tắc**, đặt **Tên quy tắc**.
2. **Khi** — chọn điều kiện kích hoạt: **Công việc vào trạng thái**, **Một trường thay đổi**, **Đến hạn chót** (hoặc quá hạn một số ngày), **Mọi việc con đã xong**, **Sản phẩm được duyệt**, **Có yêu cầu chỉnh sửa**, **Khách hàng ra quyết định** (có thể chọn một quyết định cụ thể), **Bàn giao được nhận**, **Bàn giao bị trả lại**, **Hạn mức retainer chạm mốc**.
3. **Chỉ khi (không bắt buộc)** — thêm điều kiện theo trường (độ ưu tiên, người được giao, nhãn, kênh, định dạng nội dung, hạn chót, người duyệt, chu kỳ) với phép so sánh **là**, **không là**, **đã có**, **còn trống**.
4. **Thì** — thêm một hoặc nhiều hành động: **Chuyển trạng thái**, **Giao cho**, **Gắn nhãn**, **Thêm người theo dõi**, **Đặt hạn chót** (số ngày làm việc kể từ hôm nay, 0–90), **Tạo công việc từ mẫu**, **Yêu cầu duyệt**, **Gửi thông báo**, **Viết bình luận**. Người nhận có thể chọn **Theo vai trò** (người được giao, người yêu cầu, người làm việc cha, trưởng nhóm và trưởng dự án, người duyệt của công việc) hoặc **Người cụ thể**.
5. Bấm **Lưu quy tắc**. Quy tắc hiện thành một câu dễ đọc, ví dụ *Khi công việc vào "Khách duyệt", thì đặt hạn sau 2 ngày làm việc*.

> [!NOTE]
> Quy tắc **Hạn mức retainer chạm mốc** gắn với dự án, không với công việc nào: nó chỉ gửi thông báo cho trưởng dự án / trưởng nhóm hoặc tạo công việc từ mẫu.

Dùng **Tắt** / **Bật** để tạm dừng một quy tắc; **Xóa** sẽ xóa cả lịch sử chạy của nó. Phần **Lần chạy gần đây** cho biết kết quả từng lần: **Đã chạy**, **Không cần làm gì** hoặc **Lỗi** (kèm mô tả lỗi).
