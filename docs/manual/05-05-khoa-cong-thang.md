# Khoá công tháng

Trang này dành cho **nhân sự phụ trách chấm công** (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự**, trong phạm vi pháp nhân / đơn vị được giao). Nội dung: theo dõi các mục còn mở trong tháng, nhắc nhân viên, khoá công từng pháp nhân để chuyển sang tính lương, điều chỉnh sau khi khoá và tính lại bảng công.

## Quy trình một tháng (góc nhìn nhân sự)

1. **Trong tháng**: theo dõi **Bảng bất thường chấm công**, tạo đơn thay nhân viên khi cần (ví dụ máy chấm công hỏng cả tuần), gán mã máy chấm công còn thiếu.
2. **Sáng ngày 1**: hệ thống tự gửi thông báo "Bảng công tháng … đã sẵn sàng để xác nhận" cho mọi người có ngày công trong tháng vừa qua (trừ ai đã xác nhận).
3. **Đầu tháng**: nhân viên xác nhận, quản lý duyệt. Bạn theo dõi tiến độ và nhắc người còn chậm.
4. **Khoá công**: khi không còn mục chặn, bạn khoá tháng cho từng pháp nhân.
5. **Sau khoá**: sai sót được ghi bằng **điều chỉnh**, tính vào kỳ lương kế tiếp.

## Bảng bất thường chấm công

Mở **Chấm công** → **Bảng bất thường chấm công** ([mở](/attendance/anomalies)). Trang chỉ hiện với người có quyền quản lý chấm công và chỉ gồm những người trong phạm vi của bạn. Danh sách này cũng chính là danh sách hệ thống kiểm tra trước khi khoá công.

**Lọc và xem:**

- Chọn tháng bằng mũi tên (mặc định tháng hiện tại).
- Lọc pháp nhân bằng các thẻ **Tất cả pháp nhân** và tên viết tắt từng pháp nhân.
- Lọc loại bất thường bằng các nút **Tất cả · N** và từng loại kèm số lượng.
- Bấm tên một người để chỉ xem mục của người đó; bấm **xem tất cả** để bỏ lọc.
- **Xuất CSV** tải danh sách đang lọc (tệp bị cắt nếu quá giới hạn số dòng).
- **Bảng công tháng** chuyển sang màn hình khoá công.

**Các loại mục:**

| Loại | Chặn khoá công? | Đường tắt xử lý |
| --- | --- | --- |
| **Thiếu chấm công** | Có | **Tạo đơn bổ sung công** (thay nhân viên) |
| **Chấm công gắn cờ** | Có | **Xem xét** |
| **Đơn đang chờ** | Có | **Mở đơn** |
| **Làm ngày nghỉ chưa có giờ** | Có | **Mở đơn** để xác nhận số giờ |
| **Chưa xác nhận tháng**, **Chưa duyệt tháng** | Có | **Bảng công** |
| **Vắng** | Không (cảnh báo) | **Tạo đơn bổ sung công** |
| **Đi muộn**, **Về sớm** | Không | **Tạo đơn bổ sung công** |
| **Thiếu giờ** | Không | **Mở ngày công** |
| **Làm thêm chưa duyệt** | Không (cảnh báo) | **Tạo đơn tăng ca** |
| **Làm ngày nghỉ** | Không | **Tạo đơn làm ngày nghỉ** |
| **Chấm công khi nghỉ phép** | Không | **Mở ngày công** |
| **Chưa có lịch làm việc** | Không | **Lịch làm việc** |
| **Mã máy chưa gán** | Không | **Gán mã** (mở trang máy chấm công) |

Mục chặn có nhãn màu đỏ. Bên cạnh mỗi dòng có tên người là nút **Nhắc**: nhân viên nhận thông báo "Vui lòng kiểm tra chấm công tháng …" đề nghị bổ sung lần chấm còn thiếu hoặc gửi các đơn còn mở.

> [!NOTE]
> **Vắng** và **Làm thêm chưa duyệt** không chặn khoá công: đó là sự thật của tháng (ngày không lương, giờ ngoài giờ không được trả), không phải dữ liệu bị thiếu. Nhưng bạn nên xem qua trước khi khoá.

### Tạo đơn thay nhân viên

Đường tắt **Tạo đơn bổ sung công / tăng ca / làm ngày nghỉ** mở form **Tạo đơn chấm công** cho đúng người và đúng ngày, đầu trang ghi "Tạo thay cho …". Đơn vẫn đi qua luồng duyệt như thường (quản lý trực tiếp). Đơn bổ sung công do nhân sự tạo thay không bị tính vào giới hạn số lần mỗi tháng. Xem trang **Đơn chấm công**.

## Màn hình Bảng công tháng

Mở **Chấm công** → **Bảng công tháng** ([mở](/attendance/timesheets)). Trang mặc định mở tháng vừa kết thúc. Phần trên là **Nhóm của tôi** (giống quản lý — xem trang **Chấm công cho quản lý**); phần dưới là khu vực của nhân sự cho từng pháp nhân, tiêu đề "… — tháng công".

- Nếu bạn phụ trách nhiều pháp nhân, chọn pháp nhân bằng các thẻ tên viết tắt.
- Bốn ô đếm số người theo trạng thái: **Đang mở**, **Đã xác nhận**, **Đã duyệt**, **Đã khoá**.
- Khung "**… mục chặn trên … mục còn mở**" liệt kê từng người và vấn đề (ví dụ "bảng công chưa được duyệt", "2 ngày thiếu chấm công", "1 lần chấm công gắn cờ chờ xem"). Mục cảnh báo hiện màu nhạt. Liên kết **Mở bảng bất thường** đưa bạn tới bảng bất thường đã lọc sẵn tháng và pháp nhân.

### Nhắc nhân viên xác nhận

Khi tháng đã kết thúc và còn người ở trạng thái **Đang mở**, bấm **Nhắc … người xác nhận**. Mọi người đang làm việc có tháng còn mở nhận lại thông báo "Bảng công tháng … đã sẵn sàng để xác nhận".

### Duyệt thay

Nhân sự duyệt được tháng của người trong phạm vi kể cả khi họ chưa xác nhận (ví dụ người đang nghỉ dài ngày). Chọn họ trong **Nhóm của tôi** rồi bấm **Duyệt mục đã chọn**.

## Khoá công

Khung **Khoá công tháng** chỉ hiện khi tháng đã kết thúc và có ngày công.

1. Xử lý hết các mục chặn (hoặc quyết định khoá kèm lý do).
2. **Không còn mục chặn**: khung ghi "Mọi bảng công đã duyệt. Khoá sẽ cố định ngày công, ghi nhận nghỉ bù và chuyển tháng sang tính lương." Bấm **Khoá công**.
3. **Còn mục chặn**: khung ghi "Còn mục chặn. Bạn vẫn có thể khoá kèm lý do; các mục còn mở sẽ được ghi lại." Nhập lý do vào ô **Vì sao vẫn khoá? (ít nhất 10 ký tự)** rồi bấm **Vẫn khoá**.
4. Xác nhận ở hộp hỏi lại "Khoá tháng này? Không mở lại được; thay đổi sau đó là điều chỉnh."

Khi khoá, hệ thống:

- tính lại toàn bộ ngày công của pháp nhân trong tháng cho mới nhất, rồi cố định chúng;
- chuyển tháng của mọi người sang **Đã khoá** và lưu số liệu tổng hợp cho tính lương;
- quy đổi giờ làm thêm mà nhân viên chọn **Nghỉ bù** thành ngày nghỉ bù (một đổi một theo độ dài ngày công chuẩn của từng người) và cộng vào số dư nghỉ phép;
- nếu khoá kèm lý do, ghi lại lý do và danh sách mục còn mở để kiểm toán.

Sau khi khoá, khung hiện "Đã khoá lúc …" và (nếu có) "Khoá khi còn … mục mở: …". Mọi người có bảng công trong tháng nhận thông báo "Bảng công tháng … đã khoá".

Nhân sự được khoá công của pháp nhân có thể bấm **Tải bảng công tháng (CSV)** để tải số liệu đã cố định của tháng đã khoá (tiêu đề cột theo ngôn ngữ của bạn; tối đa 5.000 dòng). Mỗi lần tải được ghi nhật ký.

> [!CAUTION]
> Khoá công **không mở lại được**. Sau khi khoá: không ai tạo, huỷ hay duyệt đơn chấm công cho ngày trong tháng đó; nhập nhật ký máy chấm công và nút **Tính lại** đều bỏ qua tháng đã khoá.

> [!WARNING]
> Nếu có người chọn **Nghỉ bù** mà công ty chưa có loại nghỉ bù, việc khoá sẽ báo "Chưa có loại nghỉ bù để ghi nhận. Thêm tại Nghỉ phép → Loại nghỉ." Hãy tạo loại nghỉ bù trước (xem chương **Nghỉ phép**).

## Điều chỉnh sau khi khoá

Khi tháng đã khoá, phần **Điều chỉnh sau khi khoá** hiện bên dưới. Ngày công đã khoá giữ nguyên; bạn ghi phần chênh lệch (+/−) để kỳ lương kế tiếp truy lĩnh / truy thu.

1. Trong khung **Điều chỉnh mới**, chọn **Nhân viên**, (không bắt buộc) **Ngày** trong tháng đó.
2. Nhập chênh lệch vào các ô cần thiết, ví dụ **Giờ làm (phút)**, **Ngày công hưởng lương (phần trăm ngày)**, **Nghỉ có lương (phút)**, **Nghỉ không lương (phút)**, **Vắng (phút)**, **Đi muộn (phút)**, **Về sớm (phút)**, **Giờ làm đêm (phút)**, và các loại tăng ca (ngày thường, ngày nghỉ, ngày lễ, ban ngày / ban đêm). Số âm để giảm. Nhập ít nhất một chênh lệch.
3. Ghi **Lý do**, bấm **Ghi nhận điều chỉnh**.

Nhân viên nhận thông báo "Nhân sự điều chỉnh bảng công đã khoá tháng …" kèm lý do.

Mỗi điều chỉnh có trạng thái **Chờ kỳ lương**, **Đã vào kỳ lương …** hoặc **Đã huỷ**. Bạn **Huỷ** được một điều chỉnh (ghi "Vì sao huỷ?") khi nó chưa vào kỳ lương; đã vào kỳ lương thì không huỷ được nữa — hãy tạo điều chỉnh ngược lại.

> [!TIP]
> "Ngày công hưởng lương (phần trăm ngày)" tính theo phần trăm của một ngày: +100 là thêm một ngày công, +50 là nửa ngày.

## Tính lại bảng công

Ngày công tự tính lại mỗi khi có thay đổi nhỏ (một lần chấm, một đơn được duyệt, nghỉ phép được duyệt hay huỷ). Những thay đổi lớn ảnh hưởng nhiều người (thêm ngày lễ, đổi lịch cả pháp nhân) được xử lý bởi tác vụ tự động chạy mỗi đêm, tính lại tháng trước và tháng này cho mọi người.

Nếu cần kết quả ngay, mở **Bảng công của nhóm** ([mở](/attendance/team)), chọn pháp nhân (nếu bạn phụ trách nhiều) và bấm **Tính lại**. Kết quả hiện "Đã ghi lại … ngày, giữ nguyên … ngày đã khóa." Ngày thuộc tháng đã khoá không bao giờ bị thay đổi.

## Danh sách việc trước khi khoá

- [ ] Nhập nhật ký máy chấm công đến hết ngày cuối tháng (xem trang **Máy chấm công**).
- [ ] Gán hết **Mã máy chưa gán**.
- [ ] Không còn **Chấm công gắn cờ** và **Đơn đang chờ** (nhắc quản lý).
- [ ] Các đơn làm ngày nghỉ đã có giờ.
- [ ] Mọi bảng công **Đã duyệt** (nhắc nhân viên, nhắc quản lý, hoặc duyệt thay).
- [ ] Xem qua **Vắng** và **Làm thêm chưa duyệt**.
- [ ] Có loại nghỉ bù nếu có người chọn nghỉ bù.
- [ ] Bấm **Khoá công**.
