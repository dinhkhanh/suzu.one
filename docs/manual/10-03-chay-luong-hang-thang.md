# Chạy lương hằng tháng

Trang này hướng dẫn trọn vòng một **kỳ lương**: tạo kỳ lương, tính lương, nhập các khoản theo kỳ, đối chiếu với tháng trước, trình CEO, ký duyệt, phát hành phiếu lương, chi lương và khóa sổ. Cuối trang là cách C&B trả lời thắc mắc phiếu lương của nhân viên.

Dành cho: **C&B / Tiền lương**, **Quản trị nhân sự**, **Ban điều hành** (CEO), **Tài chính – Kế toán** và **Chủ sở hữu**.

## Mỗi người làm bước nào

Một kỳ lương đi qua tay nhiều người, mỗi bước là một "chữ ký" được ghi lại (ai, lúc nào, ghi chú gì):

| Bước | Nút trên màn hình | Ai làm | Trạng thái sau bước |
|---|---|---|---|
| Tạo kỳ lương | **Kỳ lương mới** → **Tạo** | C&B | **Nháp** |
| Tính lương | **Tính lương** / **Tính lại** | C&B | **Đã tính** |
| Trình CEO | **Trình bảng lương** | C&B | **Đã trình** |
| Ký duyệt | **Ký duyệt** | CEO | **Đã ký duyệt** |
| Trả lại (nếu cần) | **Trả lại cho nhân sự** | CEO | về **Đã tính** |
| Phát hành phiếu lương | **Phát hành phiếu lương** | C&B | (không đổi trạng thái) |
| Lập lệnh chi | **Lập lệnh chi** | Kế toán | **Đã lập lệnh chi** |
| Xác nhận đã chi | **Xác nhận đã chi** | Kế toán | **Đã chi** |
| Khóa sổ | **Khóa sổ kỳ lương** | C&B | **Đã khóa** |

Mỗi bước chỉ làm được từ đúng trạng thái liền trước — không bỏ qua bước, không đi vòng. Khóa sổ cố ý do C&B làm chứ không phải kế toán đã chi: hai người cùng đóng một kỳ.

> [!NOTE]
> Bạn chỉ thấy nút của những bước thuộc quyền mình. Ví dụ CEO thấy **Ký duyệt** và **Trả lại cho nhân sự**, nhưng không thấy **Tính lại**.

## Trước khi tạo kỳ lương

Hãy kiểm tra những điều kiện sau, nếu không bảng lương sẽ không tạo hoặc không tính được:

- [ ] **Bảng công của tháng đã khóa.** Chỉ những tháng đã khóa bảng công mới tạo được kỳ lương — xem chương **Chấm công**.
- [ ] **Có Chính sách tính lương đã duyệt** cho pháp nhân ở tháng đó (lỗi "Chưa có chính sách tính lương được duyệt cho thời điểm này").
- [ ] **Tham số pháp định** của tháng đã có (lỗi "Thiếu tham số pháp định cho kỳ này").
- [ ] **Mọi nhân viên đều có hồ sơ trả lương** (lỗi "Có nhân viên chưa có hồ sơ trả lương") và cơ cấu lương.
- [ ] Tài khoản ngân hàng và mã số thuế của nhân viên đã đầy đủ (không bắt buộc để tính, nhưng sẽ bị cảnh báo).

Xem trang **Hồ sơ lương & thay đổi lương** và **Quy tắc tính lương** để bổ sung những gì còn thiếu.

## Bước 1 — Tạo kỳ lương

1. Vào [Kỳ lương](/payroll/runs), bấm **Kỳ lương mới**.
2. Trên màn hình **Tạo kỳ lương**, chọn **Pháp nhân**.
3. Chọn **Tháng** — danh sách chỉ gồm những tháng đã khóa bảng công và chưa có kỳ lương. Nếu thấy "Không có tháng nào đã khóa bảng công và chưa có kỳ lương", hãy khóa bảng công trước.
4. Thêm **Ghi chú** nếu cần, bấm **Tạo**.

Mỗi pháp nhân chỉ có một kỳ lương định kỳ cho mỗi tháng. Nếu một kỳ lỡ sai cấu trúc, hãy **Hủy kỳ lương** rồi tạo lại, đừng tạo kỳ thứ hai.

## Bước 2 — Tính lương

1. Trên trang kỳ lương, bấm **Tính lương**.
2. Hệ thống tính cho mọi người thuộc pháp nhân trong tháng, dựa trên bảng công đã khóa, cơ cấu lương, hồ sơ trả lương, danh mục khoản lương, chính sách và tham số pháp định đang hiệu lực.
3. Với pháp nhân đông người, trang hiện tiến độ "Đang tính: x/y người." Bạn có thể rời trang — việc tính chạy nền và tự hoàn tất kể cả khi bạn đóng trình duyệt. Trong danh sách kỳ lương, kỳ đang tính có chữ **đang tính…**.
4. Nếu tính lỗi, trang báo "Không tính được: …" (trong danh sách là **tính lỗi**). Sửa nguyên nhân rồi bấm **Tính lại**.

Một kỳ lương hoặc được tính trọn, hoặc không — không bao giờ có bảng lương tính dở.

Sau khi tính, đầu trang hiển thị các ô tổng: **Số người**, **Tổng thu nhập**, **Tổng khấu trừ**, **Tổng thực nhận**, **Chi phí công ty**, và hàng thứ hai **Chuyển khoản (hồ sơ Đầy đủ)**, **Tiền mặt (hồ sơ Đơn giản)**, **Thuế TNCN**, **Bảo hiểm bắt buộc**.

> [!WARNING]
> Nếu trang hiện cảnh báo vàng "Các tham số sau chưa được Kế toán trưởng xác nhận: …", nghĩa là một số tham số pháp định dùng trong kỳ chưa được kiểm tra lại. Hãy báo người phụ trách tham số pháp định trước khi trình.

## Bước 3 — Nhập các khoản theo kỳ

Thưởng, hoa hồng, tạm ứng, khấu trừ vi phạm… là các khoản **Nhập theo từng kỳ lương**. Khi kỳ còn ở **Nháp** hoặc **Đã tính**, trang kỳ lương có khung **Khoản nhập tay**:

1. Chọn **Nhân viên**.
2. Chọn **Khoản mục** (chỉ hiện các khoản có nguồn nhập theo kỳ của pháp nhân).
3. Nhập **Số tiền** và **Diễn giải**, bấm **Lưu**.
4. Lặp lại cho những người khác, rồi bấm **Tính lại** để số liệu vào bảng lương.

Các khoản đã nhập hiện ngay dưới tên từng người trong **Danh sách nhân viên**; bấm **Xóa** để bỏ một khoản.

Một số khoản được hệ thống tự đưa vào kỳ lương đang mở của pháp nhân:

- **Hoàn ứng chi phí** — từ đề nghị thanh toán chi phí đã được duyệt (xem trang **Đề nghị thanh toán chi phí**).
- **Hoa hồng** — từ bảng hoa hồng kinh doanh đã được C&B xác nhận.

> [!IMPORTANT]
> Bạn không thể nhập khoản cho dòng lương **của chính mình**, dù bạn là C&B. Hãy nhờ một đồng nghiệp C&B khác.

## Bước 4 — Đối chiếu với tháng trước

Phần **Đối chiếu với tháng trước** so sánh kỳ này với kỳ lương tháng trước của pháp nhân: "So với … : … · thay đổi …%". Bảng bên dưới chỉ liệt kê những người cần xem lại, với các nhãn **Cảnh báo**:

| Nhãn | Ý nghĩa |
|---|---|
| **Biến động lớn** | Thực nhận thay đổi vượt ngưỡng cảnh báo trong Chính sách tính lương |
| **Người mới** / **Không còn trong kỳ** | Có trong tháng này mà không có tháng trước, hoặc ngược lại |
| **Thực nhận âm** / **Thực nhận bằng 0** | Cần kiểm tra khấu trừ hoặc ngày công |
| **Thiếu tài khoản ngân hàng** | Người này sẽ không vào được tệp chuyển khoản |
| **Thiếu mã số thuế** | Ảnh hưởng tờ khai thuế TNCN |
| **Chưa có cơ cấu lương**, **Không có ngày công hưởng lương**, **Lương đóng BH dưới mức tối thiểu**, **Lương đóng BH vượt mức đã khai** | Cảnh báo từ phần tính lương |

Nếu thấy "Không có bất thường nào cần xem lại." là kỳ lương sạch.

Bấm tên một người trong **Danh sách nhân viên** để mở hồ sơ lương của họ; bảng này có các cột **Hồ sơ**, **Tổng thu nhập**, **Bảo hiểm bắt buộc**, **Thuế TNCN**, **Thực nhận**.

## Bước 5 — Trình CEO

Khi số liệu đã ổn:

1. Bấm **Trình bảng lương**, ghi chú nếu cần (không bắt buộc).
2. Kỳ lương chuyển sang **Đã trình**. Từ đây không sửa, không tính lại được nữa ("Kỳ lương đã trình, không sửa được nữa").

Kỳ lương không có ai thì không trình được.

## Bước 6 — CEO ký duyệt hoặc trả lại

CEO mở [Kỳ lương](/payroll/runs) và bấm vào kỳ đang **Đã trình**.

- CEO thấy các ô tổng, phần đối chiếu và danh sách nhân viên với cột **Thực nhận**. Chi tiết từng khoản (thu nhập, bảo hiểm, thuế của từng người) và phiếu lương chỉ C&B mới thấy.
- Bấm **Ký duyệt** (ghi chú tùy chọn) để duyệt — kỳ lương chuyển sang **Đã ký duyệt**.
- Hoặc bấm **Trả lại cho nhân sự** và nhập **Lý do trả lại** — bắt buộc, vì nhân sự cần biết phải sửa gì. Kỳ lương về lại **Đã tính** để C&B sửa và trình lại.

CEO vẫn có thể trả lại một kỳ đã ký, miễn là kế toán chưa bấm **Lập lệnh chi**.

## Bước 7 — Phát hành phiếu lương

Sau khi CEO ký, trang kỳ lương có khung **Phát hành phiếu lương** (chỉ C&B thấy):

1. Bấm **Phát hành phiếu lương**.
2. Mỗi người trong kỳ nhận thông báo **Phiếu lương tháng … đã có** (không kèm số tiền) và thấy phiếu trong [Phiếu lương](/payslips).
3. Khung hiện **Đã phát hành** · thời điểm · số người **Đã xem** trên tổng số.
4. Trong **Danh sách nhân viên**, cạnh tên mỗi người có đường dẫn **Xem** để mở phiếu lương của họ.

Nếu sau đó có thêm người vào kỳ, nút đổi thành **Phát hành bổ sung** — chỉ những người chưa có phiếu mới được phát hành.

> [!NOTE]
> Không có phiếu lương nào đến tay nhân viên trước khi CEO ký duyệt ("Bảng lương chưa được ký duyệt nên chưa thể phát hành phiếu lương").

## Bước 8 — Chi lương

Sau khi ký duyệt, trang kỳ lương có khung **Chi lương** với nút **Chi lương**. Kế toán:

1. Bấm **Lập lệnh chi** trên trang kỳ lương.
2. Vào **Chi lương** để lập tệp chuyển khoản cho từng ngân hàng và bảng chi tiền mặt.
3. Khi tiền đã chuyển và tiền mặt đã chi đủ, bấm **Xác nhận đã chi**.

Hệ thống từ chối **Xác nhận đã chi** nếu còn tệp ngân hàng hoặc bảng tiền mặt chưa hoàn tất. Chi tiết ở trang **Thanh toán, báo cáo & tờ khai**.

## Bước 9 — Khóa sổ

Khi kỳ lương ở **Đã chi**, C&B bấm **Khóa sổ kỳ lương**.

- Kỳ lương **Đã khóa** trở thành chứng từ: không ai sửa được số liệu, khoản nhập hay trạng thái.
- Tháng đó cũng đóng lại với lương — không thể tạo thêm kỳ lương ngoài kỳ cho tháng đã khóa sổ ("Kỳ lương của tháng này đã khóa sổ").

## Theo dõi diễn biến

Khung **Quy trình duyệt** trên trang kỳ lương cho biết thời điểm của từng mốc **Đã trình**, **Đã ký duyệt**, **Đã lập lệnh chi**, **Đã chi**, **Đã khóa**. Phần **Diễn biến** liệt kê từng bước đã làm, ai làm và ghi chú kèm theo.

Danh sách [Kỳ lương](/payroll/runs) có bộ lọc **Mọi pháp nhân** và ô tháng (dạng `2026-08`), bấm **Lọc**. Các cột: **Tháng**, **Pháp nhân**, **Loại** (**Định kỳ** / **Ngoài kỳ**), **Trạng thái**, **Số người**, **Thực nhận**, **Ngày chi**.

## Hủy kỳ lương

Khi kỳ lương còn ở **Nháp** hoặc **Đã tính**, C&B có thể bấm **Hủy kỳ lương**. Kỳ bị hủy giữ lại trong danh sách với trạng thái **Đã hủy**, và tháng đó có thể tạo kỳ lương mới. Kỳ đã trình trở đi không hủy được — nếu cần sửa, CEO trả lại kỳ lương.

## Kỳ lương ngoài kỳ

Kỳ **Ngoài kỳ** là một lần chi thêm trong tháng, ví dụ thưởng cuối năm. Hiện nay kỳ ngoài kỳ được tạo từ đợt **Thưởng cuối năm** (xem trang **Thưởng cuối năm**). Kỳ ngoài kỳ đi qua đúng các bước như kỳ định kỳ: tính, trình, ký, phát hành phiếu, chi, khóa. Thuế TNCN được tính gộp với kỳ chính của tháng; bảo hiểm không tính lại.

## Trả lời thắc mắc phiếu lương (cho C&B)

Khi nhân viên gửi câu hỏi về phiếu lương, C&B của pháp nhân nhận thông báo **Có thắc mắc về phiếu lương**.

1. Vào [Thắc mắc phiếu lương](/payroll/queries). Bảng liệt kê các thắc mắc chưa đóng trong phạm vi bạn phụ trách, với **Người hỏi**, **Nội dung gần nhất** và trạng thái.
2. Bấm **Trả lời** để mở phiếu lương của người hỏi — bạn đọc được toàn bộ phiếu và cuộc trao đổi.
3. Nhập câu trả lời vào ô **Trả lời**, bấm **Gửi**. Nhân viên nhận thông báo **C&B đã trả lời thắc mắc**; trạng thái thành **C&B đã trả lời**.
4. Khi vấn đề đã xong, bấm **Đóng thắc mắc**.

> [!TIP]
> Nếu thắc mắc cho thấy bảng lương sai và kỳ lương chưa trình, hãy sửa và **Tính lại**. Nếu kỳ đã trình hoặc đã ký nhưng chưa chi, hãy nhờ CEO **Trả lại cho nhân sự**. Kỳ đã khóa thì không sửa được nữa — thống nhất cách xử lý với kế toán và giải thích rõ cho nhân viên.
