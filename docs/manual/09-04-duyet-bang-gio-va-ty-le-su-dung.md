# Duyệt bảng giờ & tỷ lệ sử dụng

Trang này dành cho **trưởng nhóm**, **quản lý trực tiếp** và **trưởng dự án**: duyệt bảng giờ tuần của mọi người, xem giờ ghi trên dự án mình phụ trách, và đọc tỷ lệ sử dụng thời gian của nhóm.

## Ai duyệt bảng giờ của ai

Bảng giờ tuần của một người được duyệt bởi:

- **trưởng nhóm** của bất kỳ nhóm làm việc nào người đó thuộc về, hoặc
- **quản lý trực tiếp** của người đó (cấp ngay phía trên, không phải cả tuyến).

Không ai tự duyệt bảng giờ của mình. Các cấp quản lý phía trên xem được bảng giờ nhưng không quyết định. Người không thuộc nhóm nào được quản lý trực tiếp duyệt.

Nếu một người không có trưởng nhóm nào (ngoài chính họ) và cũng không có quản lý trực tiếp đang làm việc, tuần của họ được chuyển cho người có quyền quản lý công việc phía trên họ, và nếu không có ai, cho **Chủ sở hữu**. Người duyệt dự phòng này nhận thông báo và thấy tuần trong danh sách duyệt, nhưng chỉ đọc được bảng giờ đó.

## Duyệt bảng giờ

Mở [Duyệt bảng giờ](/daily/timesheets) (nút trên trang **Báo cáo của tôi**, hoặc từ thông báo *Bảng giờ chờ duyệt*).

### Duyệt nhanh nhiều tuần

Phần **Chờ bạn duyệt (…)** liệt kê các tuần đang chờ: tên người, tuần, tổng giờ, giờ nộp. Tích từng dòng (hoặc **Chọn tất cả**) rồi bấm **Duyệt … bảng giờ đã chọn**. Nếu có tuần vừa được người khác xử lý, trang báo một vài bảng giờ chưa được duyệt — tải lại danh sách để xem phần còn lại.

### Xem kỹ một tuần

Bấm vào một dòng để mở bảng giờ tuần đó (chỉ xem). Bạn thấy bảng giờ từng ngày, các dòng giờ và — nếu bạn là quản lý trong tuyến của người đó — giờ chấm công cạnh mỗi ngày để đối chiếu. Sau đó:

- **Duyệt** — tuần bị khoá; người nộp nhận thông báo.
- **Trả lại** — ghi **Lý do trả lại** (*Cần sửa gì? Người nộp sẽ đọc được lời nhắn này*), bấm **Trả lại bảng giờ**. Người nộp sửa rồi nộp lại.

### Mở lại một tuần đã duyệt

Khi một tuần đã duyệt cần sửa (ví dụ ghi nhầm dự án), mở tuần đó từ phần **Đã xử lý gần đây**, bấm **Mở lại tuần**, ghi **Lý do mở lại** (lý do được ghi vào nhật ký), bấm **Mở lại**. Tuần trở về **Đang mở** để người đó sửa và nộp lại.

> [!NOTE]
> Bảng giờ được nộp, duyệt hay trả lại không làm thay đổi bảng công chấm công, và ngược lại. Trước khi đóng một dự án, các tuần có giờ ghi trên dự án cần được duyệt (xem trang **Đóng dự án** ở chương **Dự án**).

## Giờ ghi trên dự án bạn phụ trách

Nếu bạn là **trưởng dự án**, phần **Giờ ghi trên dự án tôi phụ trách** trên trang **Duyệt bảng giờ** cho thấy từng người đã ghi bao nhiêu giờ trên các dự án của bạn trong tuần (kèm *… giờ tính phí*). Dùng **← Tuần trước** / **Tuần sau →** để chuyển tuần. Bấm vào một người để xem chi tiết — bạn chỉ thấy các dòng giờ ghi trên dự án bạn phụ trách, không thấy phần còn lại trong tuần của họ.

## Tỷ lệ sử dụng

[Tỷ lệ sử dụng](/daily/utilisation) là giờ đã ghi chia cho giờ làm việc theo lịch (đã trừ nghỉ phép và ngày lễ) trong 8 tuần gần nhất; tuần hiện tại tính đến hôm nay.

### Ai thấy gì

- Trưởng nhóm thấy từng thành viên các nhóm mình làm trưởng, cùng dòng **Cả nhóm**.
- Quản lý thấy từng người trong khối **Người báo cáo cho tôi**.
- Lãnh đạo có quyền quản lý công việc (**Ban điều hành**, **Giám đốc pháp nhân**, **Trưởng bộ phận**) thấy thêm các nhóm trong phạm vi mà mình không làm trưởng, nhưng **chỉ số tổng** của nhóm (*Cả nhóm (… người)*, *… nhóm nhỏ khác*) — không thấy từng người.

### Cách đọc

Mỗi ô có ba con số: tỷ lệ sử dụng (%), *giờ đã ghi / giờ làm việc*, và *…% tính phí*. Tỷ lệ trên 110% được tô màu cảnh báo. Mọi người được xếp theo tên, không xếp hạng.

Bấm **Xuất CSV** để tải tệp gồm **Nhóm**, **Nhân sự**, **Tuần (thứ Hai)**, **Giờ làm việc**, **Giờ đã ghi**, **Giờ tính phí**, **Tỷ lệ sử dụng (%)**, **Tỷ lệ tính phí (%)**.

> [!IMPORTANT]
> Tỷ lệ sử dụng là số liệu để **điều phối công việc**, không dùng để xếp hạng hay tính lương. Tỷ lệ thấp có thể chỉ vì quên ghi giờ — hãy hỏi trước khi kết luận.
