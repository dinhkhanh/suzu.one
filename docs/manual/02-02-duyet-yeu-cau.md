# Duyệt yêu cầu

Trang này dành cho **người duyệt**: quản lý trực tiếp, trưởng bộ phận, Nhân sự, ban điều hành, tài chính, kinh doanh, tuyển dụng… — bất kỳ ai được một luồng phê duyệt hỏi ý kiến. Bạn không cần vào từng phân hệ: mọi yêu cầu đến lượt bạn đều gom về một hộp duyệt.

## Biết khi nào có việc cần duyệt

- Thanh bên, mục **Hôm nay** → **Phê duyệt** hiện số yêu cầu đang chờ bạn.
- Bạn nhận thông báo "{Người gửi} gửi yêu cầu: {loại yêu cầu}" trong ứng dụng, qua email và thông báo đẩy (tuỳ **Cài đặt thông báo** của bạn, nhóm **Phê duyệt**). Bấm vào thông báo để mở thẳng yêu cầu.
- Trang [Việc của tôi](/tasks) có mục **Yêu cầu chờ bạn phê duyệt (n)**, mỗi dòng gắn nhãn **Cần phê duyệt**, và nút **Mở hộp phê duyệt**.
- [Trang chủ](/home) nhắc "… yêu cầu chờ bạn duyệt" trong khung **Việc đang chờ bạn**.

## Hộp duyệt

Mở [Phê duyệt](/approvals). Mục **Đang chờ tôi (n)** liệt kê các yêu cầu đến lượt bạn, **cũ nhất ở trên cùng** — nên xử lý từ trên xuống. Mỗi dòng có:

- Tên loại yêu cầu (bấm để mở),
- Tóm tắt nội dung,
- Người gửi và thời điểm gửi,
- Ô chọn để duyệt hàng loạt, hoặc nhãn **Mở để quyết định** nếu loại đó phải mở ra đọc trước.

Một yêu cầu chỉ nằm trong hộp của bạn khi **bước có tên bạn đang mở** và bạn chưa trả lời. Nếu luồng có nhiều bước, bạn chỉ thấy yêu cầu khi các bước trước đã duyệt xong.

## Quyết định một yêu cầu

1. Bấm vào yêu cầu để mở trang chi tiết.
2. Đọc kỹ nội dung. Mỗi loại trang đưa sẵn thông tin để quyết định, ví dụ:
   - **Nghỉ phép**: các ngày được tính, số ngày phép, **Số dư hiện tại**, đồng nghiệp **Cũng nghỉ trong những ngày này** và cảnh báo nếu nhóm thiếu người.
   - Đơn **Chấm công**: giờ vào/ra đề nghị, giờ thực tế trong ngày, tệp minh chứng (nếu có).
   - **Thay đổi thông tin cá nhân**: bảng **Đang lưu** → **Yêu cầu đổi thành**.
   - **Duyệt xuất bản trang tri thức**: phần thay đổi so với phiên bản đang xuất bản.
3. Ở khung **Quyết định của bạn**, nhập **Ý kiến** nếu cần, rồi bấm một trong ba nút:

| Nút | Điều xảy ra |
| --- | --- |
| **Duyệt** | Phần của bạn xong. Nếu bước chỉ cần một người, bước đó hoàn tất; nếu bước cần tất cả, yêu cầu chờ những người còn lại. Khi mọi bước xong, yêu cầu thành **Đã duyệt** và thay đổi được áp dụng ngay (trừ ngày phép, cập nhật hồ sơ…). Nếu còn bước sau, người duyệt bước sau được thông báo. |
| **Trả lại để chỉnh sửa** | Yêu cầu quay về người gửi để sửa. Khi họ gửi lại, luồng chạy lại từ bước đầu tiên. |
| **Từ chối** | Yêu cầu kết thúc với trạng thái **Từ chối**. |

> [!IMPORTANT]
> **Ý kiến là bắt buộc khi trả lại hoặc từ chối.** Nếu để trống, hệ thống báo "Vui lòng nêu lý do trong phần ý kiến." Người gửi sẽ đọc lời nhắn này trong phần **Lịch sử**.

Chỉ cần **một người** trả lại hoặc từ chối là đủ: yêu cầu dừng ngay, những người khác trong bước không phải trả lời nữa. Người gửi nhận thông báo kết quả kèm tên bạn.

### Trường hợp riêng cần chú ý

- **Đổi tài khoản ngân hàng nhận lương**: khi duyệt, bạn phải tick ô "Tôi đã xác nhận tài khoản ngân hàng này với nhân viên qua kênh thứ hai (gọi điện hoặc gặp trực tiếp), không qua ứng dụng này hay email." Nếu không tick, hệ thống không cho duyệt. Lịch sử ghi nhãn **Đã xác minh qua kênh thứ hai**.
- **Thông tin hạn chế** (CCCD, mã số thuế, số sổ BHXH, tài khoản ngân hàng) được che; bấm **Hiện giá trị** để xem. Mỗi lần xem đều được ghi vào nhật ký kiểm tra.
- **Nghỉ phép**: nếu số dư phép không còn đủ vào lúc duyệt, hệ thống báo "Số ngày phép còn lại không còn đủ cho đơn này…" — hãy trả lại để người gửi sửa đơn, hoặc nhờ Nhân sự điều chỉnh số dư.
- Nếu bạn có tên ở hai bước được mở cùng lúc, một lần bấm **Duyệt** tính cho cả hai.

### Các thông báo lỗi thường gặp

| Thông báo | Ý nghĩa |
| --- | --- |
| "Yêu cầu này không còn chờ trả lời." | Đã có người khác trong bước quyết định trước bạn, hoặc người gửi đã rút. |
| "Yêu cầu này không chờ bạn trả lời." | Chưa đến lượt bạn, hoặc lượt của bạn đã được chuyển cho người khác. |
| "Bạn không thể tự duyệt yêu cầu của mình." | Bạn là người gửi hoặc là người mà yêu cầu nói tới. |

## Duyệt hàng loạt

Với các yêu cầu đơn giản, bạn có thể duyệt nhiều yêu cầu một lúc ngay trong hộp duyệt mà không cần mở từng cái.

**Những loại được chọn để duyệt hàng loạt:**

- **Nghỉ phép**
- **Làm việc từ xa / ngoài văn phòng**, **Làm thêm giờ**, **Làm việc ngày nghỉ, ngày lễ**
- **Bổ sung công** không kèm tệp minh chứng
- **Thay đổi thông tin cá nhân** chỉ gồm thông tin liên hệ (không có giấy tờ tùy thân, thuế, BHXH hay tài khoản ngân hàng)

Mọi loại khác (đề nghị, báo giá, brief và thay đổi dự án, điều chỉnh lương, tuyển dụng, trang tri thức…) phải mở ra đọc trước: ô chọn bị khóa và dòng đó có nhãn **Mở để quyết định**.

**Cách làm:**

1. Tick từng yêu cầu, hoặc bấm **Chọn tất cả (n)** (bấm lại thành **Bỏ chọn**).
2. Bấm **Duyệt mục đã chọn (n)** và xác nhận "Duyệt n yêu cầu?".
3. Mỗi yêu cầu được xử lý riêng, đúng như khi bạn mở ra bấm **Duyệt**. Dòng nào thành công hiện nhãn **Đã duyệt**; dòng nào không được (ví dụ người gửi vừa rút, hoặc thiếu số dư phép) hiện lý do màu đỏ ngay dưới dòng đó — các dòng khác vẫn được duyệt bình thường.

> [!NOTE]
> Duyệt hàng loạt chỉ để **duyệt**. Muốn trả lại hoặc từ chối, hãy mở từng yêu cầu. Mỗi lần duyệt tối đa 50 yêu cầu.

## Duyệt nhanh từ thông báo

Với những loại được phép duyệt hàng loạt, thông báo gửi tới bạn có thể kèm nút **Duyệt** dẫn tới trang **Duyệt nhanh** (ví dụ thẻ thông báo trong không gian Google Chat của công ty, khi kênh này được bật). Trang này:

1. Yêu cầu bạn đang đăng nhập bằng chính tài khoản của mình.
2. Hiện loại yêu cầu và tóm tắt để bạn đọc lại.
3. Có nút **Duyệt** và liên kết **Mở đề nghị để xem đầy đủ**. Liên kết chỉ là lối tắt: hệ thống vẫn kiểm tra bạn là người được hỏi và ghi nhật ký như khi duyệt trên trang đề nghị.

Mỗi liên kết duyệt nhanh:

- **Chỉ dành cho bạn** — người khác mở sẽ thấy "Liên kết không hợp lệ hoặc không dành cho bạn."
- **Dùng một lần** — lần sau sẽ báo "Liên kết này đã được dùng rồi."
- **Hết hạn sau 72 giờ** — khi đó trang báo "Liên kết đã hết hạn. Vui lòng mở đề nghị từ hộp phê duyệt."
- **Mất hiệu lực ngay** khi yêu cầu có diễn biến mới (người khác đã duyệt, người gửi rút, lượt của bạn được chuyển đi…).

Khi liên kết không dùng được, bấm **Mở hộp phê duyệt** để xử lý như thường. Muốn trả lại hoặc từ chối, hãy mở đề nghị đầy đủ.

> [!TIP]
> Email thông báo luôn có đường dẫn tới trang yêu cầu. Bấm vào đó, đọc nội dung, rồi quyết định ngay trên trang.

## Hỏi thêm trước khi quyết định

Chưa đủ thông tin? Đừng vội trả lại — hãy hỏi:

1. Mở yêu cầu.
2. Gõ câu hỏi vào ô **Thêm ý kiến** (gợi ý: "Câu hỏi hoặc ghi chú, chưa quyết định").
3. Bấm **Gửi**.

Người gửi nhận thông báo "… góp ý về yêu cầu: …" và có thể trả lời bằng ý kiến của họ. Yêu cầu vẫn nằm trong hộp của bạn.

## Chuyển một yêu cầu cho người khác

Khi bạn không phải người phù hợp để quyết định (hoặc sắp vắng), bạn có thể chuyển **lượt của mình trên một yêu cầu** cho người khác:

1. Mở yêu cầu (chỉ làm được khi đang đến lượt bạn).
2. Mở mục **Chuyển yêu cầu này cho người khác**.
3. Chọn người ở ô **Chuyển cho**, thêm **Ghi chú** nếu cần.
4. Bấm **Chuyển**.

Người được chọn nhận thông báo như một yêu cầu mới và trả lời thay bạn. Lịch sử ghi sự kiện **Ủy quyền** kèm tên người nhận, và ở bước duyệt hiện "{tên} thay {tên bạn}". Bạn vẫn mở và góp ý được, nhưng không còn quyết định yêu cầu đó.

Lưu ý:

- Không chuyển được cho người gửi, người mà yêu cầu nói tới, hay người đã có tên trong bước đó.
- Người nhận phải là nhân viên đang làm việc (không phải cộng tác viên).
- Các điều kiện riêng của loại yêu cầu vẫn áp dụng với người nhận — ví dụ một yêu cầu cần quyền nhân sự thì người nhận cũng phải có quyền đó mới quyết định được.

Muốn chuyển **tất cả** yêu cầu trong một khoảng thời gian (khi đi phép, công tác), hãy dùng **Ủy quyền phê duyệt** — xem trang cùng tên.

## Nhắc hạn và leo thang

Một số loại **Đề nghị** được quản trị viên đặt thời hạn duyệt. Khi bạn để yêu cầu chờ quá số ngày quy định:

- Bạn nhận lời nhắc "Đề nghị đang chờ bạn duyệt — … đã chờ n ngày." (một lần cho mỗi lượt).
- Nếu vẫn chưa ai trả lời sau mốc leo thang, người được chỉ định (ví dụ quản lý của bạn) nhận thông báo "Đề nghị quá hạn duyệt — … đã chờ {bạn} duyệt n ngày."

Việc nhắc chạy tự động mỗi ngày. Cách tốt nhất để tránh bị leo thang là xử lý hộp duyệt đều đặn, hoặc đặt **Ủy quyền phê duyệt** trước khi vắng mặt.
