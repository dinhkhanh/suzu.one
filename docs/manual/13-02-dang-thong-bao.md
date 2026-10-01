# Đăng và quản lý thông báo

Trang này dành cho người được giao quyền đăng thông báo: trưởng bộ phận, HR (**Quản trị nhân sự**, **Chuyên viên nhân sự**), **Giám đốc pháp nhân**, **Ban điều hành** và **Chủ sở hữu**. Bạn sẽ biết cách soạn thông báo, chọn đúng người nhận, hẹn giờ, đặt hạn hiển thị, yêu cầu xác nhận đã đọc và theo dõi ai đã đọc.

## Ai được đăng, gửi cho ai

Bạn chỉ gửi được thông báo tới những người nằm trong phạm vi vai trò của bạn. Ô chọn người nhận chỉ đưa ra những lựa chọn bạn được phép gửi:

| Vai trò và phạm vi | Thường gửi được tới |
|---|---|
| **Trưởng bộ phận** của một phòng ban | Phòng ban đó, các đơn vị bên dưới và từng người trong đó |
| HR, **Giám đốc pháp nhân** có phạm vi một pháp nhân | Pháp nhân đó, các đơn vị, chi nhánh và nhân viên của pháp nhân |
| Vai trò có phạm vi toàn tập đoàn | Thêm lựa chọn **Toàn bộ nhân viên** |

Nếu bạn chọn nhiều nhóm người nhận, bạn phải có quyền với **tất cả** các nhóm đó; chỉ cần một nhóm nằm ngoài phạm vi, SuZu One sẽ báo **Bạn không có quyền gửi tới nhóm người nhận này.**

> [!NOTE]
> Quyền đăng thông báo do quản trị viên cấp qua vai trò (xem trang **Phân quyền & vai trò**). Nếu bạn cần gửi thông báo cho một nhóm ngoài phạm vi của mình, hãy nhờ HR hoặc người có phạm vi rộng hơn đăng giúp.

## Mở màn hình Quản lý thông báo

1. Vào **Công ty › Thông báo** ([mở trang](/announcements)).
2. Bấm **Quản lý thông báo** ở góc trên bên phải (chỉ hiện khi bạn có quyền đăng). Hoặc mở thẳng [Quản lý thông báo](/announcements/manage).

Bảng **Quản lý thông báo** liệt kê những thông báo bạn được quản lý: những thông báo có toàn bộ người nhận nằm trong phạm vi của bạn, và những thông báo do chính bạn đăng. Các cột gồm **Tiêu đề** (kèm nhãn **Ghim** nếu có), **Trạng thái**, **Gửi tới**, **Thời điểm hiển thị** và **Người đăng**. Thông báo sửa gần nhất nằm trên cùng.

### Các trạng thái của thông báo

| Trạng thái | Ý nghĩa |
|---|---|
| **Bản nháp** | Đã lưu nhưng chưa đăng. Chưa ai thấy |
| **Đã hẹn giờ** | Đã bấm đăng với thời điểm hiển thị trong tương lai. Sẽ tự hiện đúng giờ |
| **Đang hiển thị** | Người nhận đang thấy thông báo |
| **Hết hạn** | Đã qua thời điểm **Hết hạn lúc**. Người nhận không còn thấy |
| **Đã lưu trữ** | Đã bị lưu trữ. Người nhận không còn thấy, không sửa được nữa |

## Soạn và đăng một thông báo

1. Trên màn hình **Quản lý thông báo**, bấm **Soạn thông báo**.
2. Điền **Tiêu đề** (tối đa 200 ký tự).
3. Viết **Nội dung** (tối đa 10.000 ký tự). Ô soạn thảo có thanh công cụ định dạng: **Đậm**, **Nghiêng**, **Gạch ngang**, **Danh sách**, **Danh sách đánh số**, **Danh sách việc cần làm**, **Trích dẫn**… Bạn cũng gõ được kiểu Markdown, ví dụ `**chữ đậm**` hay `- ` để mở danh sách. Bộ đếm ký tự nằm dưới ô.
4. Nếu muốn dẫn người đọc tới một trang trong kho tri thức (ví dụ quy chế đầy đủ), dán đường dẫn của trang đó vào ô **Trang tri thức đính kèm (dán đường dẫn, không bắt buộc)**. Xem mẹo lấy đường dẫn ở phần dưới.
5. Chọn người nhận ở mục **Gửi tới**:
   1. Ở ô đầu tiên, chọn loại người nhận: **Toàn bộ nhân viên**, **Pháp nhân**, **Đơn vị (gồm các đơn vị bên dưới)**, **Chỉ riêng đơn vị đó**, **Chi nhánh / địa điểm** hoặc **Cá nhân**.
   2. Ở ô thứ hai, chọn tên cụ thể (không cần với **Toàn bộ nhân viên**).
   3. Bấm **Thêm**. Dòng người nhận hiện trong danh sách phía trên.
   4. Lặp lại để thêm nhóm khác (tối đa 50 dòng). Bấm **Bỏ** cạnh một dòng để xoá dòng đó.
6. Chọn các tuỳ chọn nếu cần:
   - **Ghim lên đầu**: thông báo luôn nằm trên cùng danh sách của người đọc.
   - **Yêu cầu xác nhận đã đọc**: người nhận phải bấm **Tôi đã đọc**; thông báo xuất hiện trong khối **Việc đang chờ bạn** trên Trang chủ của họ cho tới khi họ xác nhận.
7. Đặt thời gian (giờ Việt Nam):
   - **Thời điểm hiển thị**: để trống để đăng ngay; chọn một thời điểm sắp tới để hẹn giờ.
   - **Hết hạn lúc**: không bắt buộc. Sau thời điểm này thông báo tự biến khỏi danh sách người đọc. Thời điểm hết hạn phải sau thời điểm hiển thị.
8. Bấm **Đăng** để đăng (hoặc hẹn giờ), hoặc **Lưu nháp** để lưu lại và đăng sau.

Sau khi lưu, bạn được đưa tới trang quản lý của chính thông báo đó.

### Chuyện gì xảy ra khi bạn bấm Đăng

- **Đăng ngay** (để trống thời điểm hiển thị hoặc chọn thời điểm đã qua): thông báo hiện ngay với người nhận, và mỗi người nhận (trừ chính bạn) nhận một tin **Thông báo mới: …** hoặc **Cần xác nhận: …** trong **Thông báo của tôi**.
- **Hẹn giờ**: trạng thái là **Đã hẹn giờ**. Thông báo tự hiện đúng thời điểm đã chọn; tin báo được gửi trong lần chạy tác vụ tự động kế tiếp sau thời điểm đó (khoảng 0 giờ và 7 giờ sáng). Nếu thông báo đã hết hạn trước khi tác vụ chạy, sẽ không có tin báo nào được gửi.

> [!TIP]
> Muốn mọi người nhận được tin báo ngay khi thông báo hiện lên, hãy hẹn giờ vào khoảng 7 giờ sáng hoặc đăng ngay.

### Người nhận được tính thế nào

Người nhận được xác định theo cơ cấu tổ chức tại thời điểm đọc: người mới vào phòng ban sau khi bạn đăng vẫn thấy thông báo còn đang hiển thị (nhưng không nhận tin báo). Người đã nghỉ việc không được tính. Cộng tác viên chỉ nhận thông báo khi bạn chọn đích danh họ ở loại **Cá nhân**.

Chọn **Đơn vị (gồm các đơn vị bên dưới)** để gửi cho cả cây đơn vị; chọn **Chỉ riêng đơn vị đó** khi chỉ muốn gửi cho những người xếp trực tiếp vào đơn vị, không gồm các nhóm con.

### Mẹo: lấy đường dẫn trang tri thức

Ô **Trang tri thức đính kèm** nhận đường dẫn có dạng `/kb/pages/…` (dán cả địa chỉ đầy đủ cũng được). Cách lấy nhanh:

- Mở trang tri thức, bấm **Lịch sử phiên bản** (hoặc **Sửa**), rồi sao chép địa chỉ trên thanh trình duyệt; hoặc
- Trong kết quả tìm kiếm của kho tri thức, nhấp chuột phải vào tên trang và chọn sao chép liên kết.

Người đọc chỉ thấy dòng **Đọc thêm trong kho tri thức:** khi họ có quyền mở trang đó. Hãy chắc chắn trang đã được xuất bản và nằm trong không gian mà người nhận đọc được.

## Sửa một thông báo

1. Trên màn hình **Quản lý thông báo**, bấm vào tiêu đề thông báo. Hoặc từ trang đọc thông báo, bấm **Sửa và xem ai đã đọc**.
2. Sửa các trường như khi soạn.
3. Với bản nháp: bấm **Đăng** hoặc **Lưu nháp**. Với thông báo đã đăng hoặc đã hẹn giờ: bấm **Lưu thay đổi** (lúc này không còn nút lưu nháp).

> [!WARNING]
> Sửa một thông báo đã đăng **không** gửi lại tin báo cho ai cả, kể cả những người bạn vừa thêm vào danh sách người nhận. Nếu nội dung thay đổi quan trọng, hãy cân nhắc đăng một thông báo mới.

Thông báo đã hiển thị giữ nguyên ngày đăng ban đầu khi bạn lưu thay đổi. Với thông báo đang hẹn giờ, bạn có thể đổi **Thời điểm hiển thị** để dời lịch; nếu xoá trống ô này rồi bấm **Lưu thay đổi**, thông báo được đăng ngay và người nhận được báo ngay.

Bấm **Xem như người đọc** để xem thông báo đúng như người nhận sẽ thấy.

## Ghim, bỏ ghim và lưu trữ

Trên trang quản lý của một thông báo:

- **Ghim lên đầu** / **Bỏ ghim**: đổi ngay, không cần lưu form.
- **Lưu trữ**: SuZu One hỏi lại **Lưu trữ thông báo này? Người đọc sẽ không còn thấy nó.** Sau khi lưu trữ, thông báo biến khỏi danh sách của mọi người đọc, nhãn ghim bị bỏ, và bạn không sửa hay đăng lại được.

> [!CAUTION]
> Lưu trữ không hoàn tác được. Nếu chỉ muốn thông báo thôi hiển thị từ một thời điểm, hãy đặt **Hết hạn lúc** thay vì lưu trữ.

## Theo dõi ai đã đọc

Khi thông báo đã được đăng, trang quản lý của nó có phần **Ai đã đọc**:

- Dòng tổng: "… người đã đọc" và, nếu có yêu cầu xác nhận, "… đã xác nhận" trên tổng số người nhận.
- Bảng theo **Phòng ban**: **Số người**, **Đã đọc**, **Đã xác nhận** của từng phòng ban.
- Bảng theo **Nhân viên**: từng người nhận với thời điểm **Đã đọc** và **Đã xác nhận** (dấu "—" nghĩa là chưa).

Một người được tính "đã đọc" khi họ mở trang chi tiết của thông báo; được tính "đã xác nhận" khi họ bấm **Tôi đã đọc**. Danh sách người nhận được tính theo những người đang làm việc tại thời điểm bạn xem báo cáo.

> [!TIP]
> Với thông báo bắt buộc, hãy xem bảng theo phòng ban để biết nơi nào còn nhiều người chưa xác nhận, rồi nhắc trưởng bộ phận ở đó. SuZu One không tự gửi nhắc lại cho thông báo chưa xác nhận; nó chỉ hiện trong khối **Việc đang chờ bạn** trên Trang chủ của người nhận.

## Lỗi thường gặp

| Thông báo lỗi | Cách xử lý |
|---|---|
| **Hãy chọn ít nhất một người nhận.** | Chọn loại và tên người nhận rồi bấm **Thêm** trước khi lưu |
| **Bạn không có quyền gửi tới nhóm người nhận này.** | Bỏ nhóm nằm ngoài phạm vi vai trò của bạn |
| **Thời điểm hết hạn phải sau thời điểm hiển thị.** | Dời **Hết hạn lúc** ra sau **Thời điểm hiển thị** (hoặc sau lúc này nếu đăng ngay) |
| **Thông báo đã lưu trữ, không sửa được nữa.** | Soạn một thông báo mới |
| **Vui lòng kiểm tra lại các trường.** | Thường do đường dẫn trang tri thức không đúng dạng `/kb/pages/…`; dán lại theo mẹo ở trên |
