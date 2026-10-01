# Lương

Phân hệ **Lương** gom mọi việc liên quan đến tiền lương trong SuZu One: phiếu lương hằng tháng của bạn, hồ sơ và cơ cấu lương, quy trình tính – trình – ký duyệt – chi – khóa sổ bảng lương, các báo cáo và số liệu khai báo bảo hiểm, thuế TNCN, và đợt thưởng cuối năm.

Lương là loại dữ liệu nhạy cảm nhất của công ty. Vì vậy phân hệ này có những quy tắc riêng, khác với phần còn lại của ứng dụng — hãy đọc mục **Bảo mật dữ liệu lương** bên dưới trước khi bắt đầu.

## Trang này dành cho ai

- **Mọi nhân viên**: xem phiếu lương của mình, hỏi C&B khi thắc mắc, xác nhận đã nhận lương tiền mặt, xem hồ sơ lương của chính mình. Xem trang **Phiếu lương cho nhân viên**.
- **C&B / Tiền lương** và **Quản trị nhân sự**: quản lý cơ cấu lương, hồ sơ trả lương, chạy bảng lương hằng tháng, phát hành phiếu lương, trả lời thắc mắc, lập dữ liệu khai báo, tổ chức đợt thưởng cuối năm.
- **Ban điều hành** (CEO): xem bảng lương và báo cáo tổng hợp, ký duyệt hoặc trả lại bảng lương và đợt thưởng.
- **Tài chính – Kế toán** (kế toán trưởng): lập tệp chuyển khoản ngân hàng, bảng chi tiền mặt, xác nhận đã chi.
- **Chủ sở hữu**: phê duyệt thay đổi lương, đổi hồ sơ trả lương, các quy tắc tính lương; điều chỉnh từng khoản thưởng.
- **Kiểm toán (chỉ xem)**: xem danh sách kỳ lương và báo cáo tổng hợp.

> [!IMPORTANT]
> Quản lý trực tiếp, trưởng bộ phận, giám đốc pháp nhân và chuyên viên nhân sự **không** xem được lương của người khác — kể cả nhân viên dưới quyền mình. Quyền xem lương không đi theo sơ đồ tổ chức mà theo vai trò lương được cấp trên từng pháp nhân.

## Bảo mật dữ liệu lương

- **Xác thực lại**: mọi màn hình có số liệu lương (phiếu lương, hồ sơ lương, kỳ lương, báo cáo…) yêu cầu bạn đã xác nhận danh tính trong vòng 15 phút gần nhất. Nếu quá thời gian này, hệ thống chuyển bạn sang màn hình **Xác thực lại** — bấm **Đăng nhập lại bằng Google** bằng đúng tài khoản đang dùng, sau đó bạn được đưa về đúng trang đang mở.
- **Theo pháp nhân**: người làm C&B chỉ thấy lương của nhân sự thuộc pháp nhân mình phụ trách.
- **Không ai tự xử lý lương của mình**: C&B không thể nhập khoản cho dòng lương của chính mình, và không ai tự duyệt đề xuất lương của mình.
- **Thông báo không chứa con số**: thông báo về lương chỉ nói "phiếu lương tháng … đã có", không bao giờ ghi số tiền.
- **Mọi thao tác đều được ghi nhật ký**: ai trình, ai ký, ai chi, lúc nào.

> [!NOTE]
> Nếu bạn đang được bộ phận hỗ trợ "xem với tư cách" một người khác, bạn không thể xác thực lại thay cho họ — hãy trở về tài khoản của mình trước.

## Vào đâu trong ứng dụng

Trên thanh bên có hai mục liên quan:

- **Phiếu lương** (nhóm **Của tôi**) — mở thẳng danh sách phiếu lương của bạn.
- **Lương** (nhóm **Quản lý**) — mở bàn làm việc **Lương**. Mỗi người thấy những ô khác nhau tùy quyền: nhân viên chỉ thấy **Phiếu lương của tôi** và **Hồ sơ lương của tôi**; C&B, CEO, kế toán thấy thêm các ô nghiệp vụ.

## Bạn muốn… → Vào đâu

| Bạn muốn… | Vào đâu | Ai làm |
|---|---|---|
| Xem phiếu lương tháng này, tải PDF | [Phiếu lương](/payslips) | Mọi nhân viên |
| Hỏi C&B về một khoản trên phiếu lương | Mở phiếu lương → **Gửi thắc mắc đến C&B** | Mọi nhân viên |
| Xác nhận đã nhận lương tiền mặt | [Phiếu lương](/payslips) → **Tôi đã nhận đủ** | Nhân viên nhận tiền mặt |
| Xem mức lương, phụ cấp, lịch sử điều chỉnh của mình | [Lương](/payroll) → **Hồ sơ lương của tôi** | Mọi nhân viên |
| Xem cơ cấu lương của nhân viên | [Cơ cấu lương nhân viên](/payroll/salaries) | C&B |
| Đề xuất tăng / điều chỉnh lương | Hồ sơ lương của người đó → **Đề xuất điều chỉnh lương** | C&B |
| Duyệt đề xuất điều chỉnh lương | [Phê duyệt](/approvals) | Chủ sở hữu (mặc định) |
| Thiết lập hoặc đổi hồ sơ trả lương | Hồ sơ lương của người đó → **Thiết lập hồ sơ trả lương** | C&B đề xuất, Chủ sở hữu duyệt |
| Duyệt chuyển hồ sơ Đầy đủ ↔ Đơn giản | [Hồ sơ trả lương](/payroll/profiles) | Chủ sở hữu |
| Tính mức gross từ mức net thỏa thuận | [Quy đổi net → gross](/payroll/tools/net-to-gross) | C&B |
| Tạo và tính bảng lương tháng | [Kỳ lương](/payroll/runs) → **Kỳ lương mới** | C&B |
| Ký duyệt bảng lương | [Kỳ lương](/payroll/runs) → mở kỳ → **Ký duyệt** | CEO |
| Lập tệp chuyển khoản, bảng chi tiền mặt | Mở kỳ lương → **Chi lương** | Kế toán |
| Phát hành phiếu lương | Mở kỳ lương → **Phát hành phiếu lương** | C&B |
| Trả lời thắc mắc của nhân viên | [Thắc mắc phiếu lương](/payroll/queries) | C&B |
| Xem báo cáo lương, chi phí nhân sự | [Báo cáo lương](/payroll/reports) | C&B, CEO, kế toán, kiểm toán |
| Lấy số liệu lập tờ khai BHXH, thuế TNCN | [Dữ liệu khai báo](/payroll/statutory) | C&B |
| Đối chiếu với bảng lương cũ | [Chạy song song](/payroll/parallel) | C&B |
| Nhập thu nhập, thuế của những tháng trước khi dùng hệ thống | [Số liệu luỹ kế](/payroll/ytd) | C&B |
| Tổ chức thưởng tháng 13 | [Thưởng cuối năm](/payroll/bonus) | C&B, CEO, Chủ sở hữu |
| Xem / đề xuất khoản lương, công thức | [Danh mục khoản lương](/payroll/components) | C&B đề xuất, Chủ sở hữu duyệt |
| Xem / đề xuất chính sách tính lương | [Chính sách tính lương](/payroll/policy) | C&B đề xuất, Chủ sở hữu duyệt |
| Xem thuế suất, tỷ lệ bảo hiểm, lương tối thiểu vùng | [Tham số pháp định](/admin/rules) | C&B, Chủ sở hữu |

## Tổng quan các màn hình

| Màn hình | Nội dung chính |
|---|---|
| **Phiếu lương của tôi** | Danh sách các kỳ lương đã phát hành cho bạn, nhãn **Mới** cho phiếu chưa xem, nhãn **Đang có thắc mắc**. |
| **Hồ sơ lương của tôi** | Hồ sơ trả lương và **Lịch sử cơ cấu lương** của bạn: lương cơ bản, lương đóng bảo hiểm, các phụ cấp, quyết định lương. |
| **Cơ cấu lương nhân viên** | Bảng toàn bộ nhân sự trong phạm vi C&B: hồ sơ trả lương, lương cơ bản, lương đóng BH, tổng phụ cấp, đề xuất đang chờ. |
| **Hồ sơ trả lương** | Các đề xuất chuyển hồ sơ đang chờ Chủ sở hữu; với Chủ sở hữu có thêm **Báo cáo hồ sơ Đơn giản**. |
| **Kỳ lương** | Sổ các kỳ lương theo pháp nhân và tháng, trạng thái từng kỳ, số người, tổng thực nhận, ngày chi. |
| **Chi lương** | Tệp chuyển khoản theo ngân hàng, bảng chi tiền mặt, tình trạng đã chi xong hay chưa. |
| **Thắc mắc phiếu lương** | Hàng chờ câu hỏi của nhân viên về phiếu lương. |
| **Báo cáo lương** | Bảng lương chi tiết, chi phí theo phòng ban, đối chiếu bảo hiểm, tổng hợp thuế TNCN, công đoàn, xu hướng chi phí. |
| **Dữ liệu khai báo** | Số liệu D02-LT, 05/KK-TNCN, 05/QTT-TNCN và danh sách người phụ thuộc, tải về dạng CSV. |
| **Chạy song song** | So sánh từng người giữa hệ thống và bảng lương cũ, giải thích từng chênh lệch. |
| **Số liệu luỹ kế** | Thu nhập và thuế của những tháng hệ thống chưa chạy, phục vụ quyết toán năm. |
| **Thưởng cuối năm** | Các đợt thưởng tháng 13, quy chế thưởng, mô phỏng chi phí, cách tính từng người. |
| **Danh mục khoản lương** / **Chính sách tính lương** | Các quy tắc tính lương có ngày hiệu lực, do C&B đề xuất và Chủ sở hữu phê duyệt. |

## Vòng đời một kỳ lương (tóm tắt)

| Trạng thái | Ý nghĩa | Bước tiếp theo — ai làm |
|---|---|---|
| **Nháp** | Kỳ lương vừa tạo, chưa tính | **Tính lương** — C&B |
| **Đã tính** | Đã có số liệu, còn sửa và tính lại được | **Trình bảng lương** — C&B |
| **Đã trình** | Chờ CEO | **Ký duyệt** hoặc **Trả lại cho nhân sự** — CEO |
| **Đã ký duyệt** | Được phép phát hành phiếu lương và chuẩn bị chi | **Lập lệnh chi** — kế toán |
| **Đã lập lệnh chi** | Đang chuyển khoản / chi tiền mặt | **Xác nhận đã chi** — kế toán |
| **Đã chi** | Tiền đã đến tay nhân viên | **Khóa sổ kỳ lương** — C&B |
| **Đã khóa** | Kỳ lương thành chứng từ, không sửa được nữa | — |
| **Đã hủy** | Kỳ lương bị hủy khi còn Nháp hoặc Đã tính | — |

Chi tiết từng bước có ở trang **Chạy lương hằng tháng**.

## Các trang trong chương này

- **Phiếu lương cho nhân viên** — xem, tải, hỏi về phiếu lương; xác nhận nhận tiền mặt; hồ sơ lương của bạn.
- **Hồ sơ lương & thay đổi lương** — cơ cấu lương, đề xuất và duyệt điều chỉnh lương, quyết định lương, hồ sơ trả lương, công cụ quy đổi net → gross.
- **Chạy lương hằng tháng** — từ tạo kỳ lương đến khóa sổ, phát hành phiếu lương, trả lời thắc mắc.
- **Thanh toán, báo cáo & tờ khai** — chi lương qua ngân hàng và tiền mặt, báo cáo lương, dữ liệu khai báo, chạy song song, số liệu luỹ kế.
- **Thưởng cuối năm** — quy chế thưởng, đợt thưởng, điều chỉnh, ký duyệt và chi.
- **Quy tắc tính lương** — danh mục khoản lương, chính sách tính lương và tham số pháp định.

> [!TIP]
> Bạn có thể chọn nhận hay tắt thông báo nhóm **Lương & bảng lương** trong **Cài đặt thông báo**.
