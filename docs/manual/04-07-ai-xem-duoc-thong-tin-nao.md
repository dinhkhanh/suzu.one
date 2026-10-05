# Ai xem được thông tin nào

Hồ sơ nhân sự chứa nhiều thông tin nhạy cảm. SuZu One chia thông tin của mỗi người thành **bốn mức**, và mỗi người dùng chỉ thấy tới mức mà quan hệ hoặc vai trò của họ cho phép. Mặc định là **không thấy**; quyền được mở dần theo vai trò.

## Bốn mức thông tin

| Mức | Gồm những gì |
| --- | --- |
| **1. Danh bạ nội bộ** | Họ tên, ảnh, mã nhân viên, email công ty, pháp nhân, phòng ban, nhóm, chức danh, quản lý trực tiếp, khách hàng phụ trách |
| **2. Cá nhân** | Quan hệ lao động (loại lao động, ngày vào làm, thâm niên, ngày nghỉ, cấp bậc, chi nhánh…), chi tiết cá nhân (điện thoại, ngày sinh, địa chỉ…), lịch sử và quá trình công tác, hợp đồng (không gồm lương), liên hệ khẩn cấp, bằng cấp, chứng chỉ |
| **3. Hạn chế** | CCCD, hộ chiếu, mã số thuế, số sổ BHXH, nơi đăng ký KCB, tài khoản ngân hàng, người phụ thuộc, bản chụp CCCD, giấy khám sức khỏe, ghi chú kỷ luật |
| **4. Lương** | Điều khoản lương trong hợp đồng, hợp đồng đã ký, quyết định, lịch sử cơ cấu lương, lý do và ghi chú của sự kiện điều chỉnh lương |

Ai thấy được một mức thì cũng thấy các mức thấp hơn.

## Ai thấy tới mức nào

| Người xem | Mức cao nhất được xem |
| --- | --- |
| **Chính bạn** | Tất cả, kể cả lương của mình |
| Mọi nhân viên khác | Danh bạ nội bộ, và chỉ với người đang làm việc |
| Cộng tác viên | Không có danh bạ (chỉ thấy hồ sơ của chính mình) |
| **Quản lý trực tiếp** (với người báo cáo trực tiếp cho mình) | Cá nhân. **Không bao giờ** thấy thông tin hạn chế hay lương |
| **Trưởng bộ phận** (trong đơn vị được giao) | Cá nhân |
| **Chuyên viên nhân sự**, **Giám đốc pháp nhân** (trong phạm vi được giao) | Hạn chế |
| **Quản trị nhân sự**, **C&B / Tiền lương**, **Tài chính – Kế toán**, **Ban điều hành**, **Kiểm toán (chỉ xem)** (trong phạm vi được giao) | Lương |
| **Tuyển dụng**, **Quản lý tài sản**, **Hỗ trợ hệ thống**, **Kinh doanh / phát triển khách hàng** | Danh bạ nội bộ |

"Phạm vi được giao" là phần tổ chức ghi trong phân quyền của vai trò đó: toàn tập đoàn, một pháp nhân, hoặc một đơn vị (kèm mọi đơn vị bên dưới nó). Ví dụ một Chuyên viên nhân sự được giao pháp nhân A thì không xem được thông tin hạn chế của người ở pháp nhân B.

> [!NOTE]
> Xem được và sửa được là hai chuyện khác nhau. Chỉ **Nhân sự** (Chuyên viên nhân sự, Quản trị nhân sự) sửa được hồ sơ người khác, và cũng chỉ sửa được những mức mình được xem. Ví dụ Chuyên viên nhân sự sửa được CCCD và tài khoản ngân hàng nhưng không ghi được điều khoản lương. Bản thân nhân viên không tự sửa hồ sơ mà gửi yêu cầu thay đổi.

## Người đã nghỉ và người sắp vào

Đồng nghiệp bình thường chỉ thấy người **đang làm việc**. Hồ sơ người đã nghỉ việc hoặc chưa tới ngày vào làm (kể cả ảnh) chỉ hiện với ai được xem mức **Cá nhân** trở lên của người đó.

## Thông tin hạn chế được bảo vệ thế nào

- **Mã hóa khi lưu**: CCCD, hộ chiếu, mã số thuế, số BHXH, nơi KCB, tài khoản ngân hàng và số giấy tờ của người phụ thuộc được mã hóa trong cơ sở dữ liệu. Kể cả khi nhập từ Excel, các ô này được mã hóa ngay và bị che trong bản xem trước.
- **Che mặc định**: trên màn hình chỉ hiện `••••••`. Phải bấm **Hiện** mới thấy giá trị.
- **Ghi nhật ký mỗi lần xem**: mỗi lần bấm **Hiện** (kể cả xem của chính mình, kể cả xem giá trị mới trong yêu cầu thay đổi) được ghi lại: ai, xem hồ sơ của ai, lúc nào. Giá trị không bao giờ được ghi vào nhật ký.
- **Không gửi qua thông báo**: yêu cầu thay đổi chỉ ghi *tên* các ô được đổi, không ghi giá trị, nên email hay thông báo không bao giờ chứa số CCCD hay số tài khoản.

## Thông tin lương cần xác thực lại

Một số thao tác với thông tin lương, và thao tác lưu thông tin hạn chế, yêu cầu bạn đã **xác thực lại** danh tính (đăng nhập lại bằng Google) trong một khoảng thời gian ngắn gần đây:

- Xem điều khoản lương trong hợp đồng.
- Tải bản hợp đồng đã ký, quyết định.
- Xem số liệu **Lịch sử cơ cấu lương**.
- Lưu thay đổi ở **Thông tin hạn chế** (vì có tài khoản nhận lương).
- **Tải dữ liệu của tôi** trên [Hồ sơ của tôi](/me) (tệp có thông tin lương của bạn).

Khi cần, hệ thống hiện thông báo hoặc đường dẫn tới trang **Xác thực lại**. Làm xong bạn quay lại và thao tác tiếp. Xem thêm trang **Đăng nhập & bảo mật**.

## Quản trị viên xem với tư cách người khác

Người giữ vai trò **Hỗ trợ hệ thống** (và Chủ sở hữu) có thể thấy nút **Xem với tư cách người này** trên hồ sơ của người khác, để xem đúng những gì người đó thấy khi cần hỗ trợ. Trong lúc đó, đầu trang luôn có dòng "Bạn đang xem với tư cách …". Mọi thao tác được ghi nhận dưới tài khoản của người hỗ trợ. Với người đang giữ một vai trò trong hệ thống (HR, trưởng bộ phận…), chỉ Chủ sở hữu mới được xem với tư cách họ.

## Thông tin được lưu bao lâu

Mục **Dữ liệu và quyền riêng tư** trên [Hồ sơ của tôi](/me) ghi thời gian lưu trữ áp dụng cho bạn. Tóm tắt:

- Vị trí chính xác, địa chỉ mạng và trình duyệt của lượt chấm công trên ứng dụng: tự xoá sau 90 ngày (giờ chấm công vẫn ở trong bảng công).
- Hội thoại với trợ lý: tự xoá 180 ngày sau tin nhắn cuối.
- Dữ liệu khuôn mặt: xoá khi bạn nghỉ việc hoặc rút lại sự đồng ý.
- Sau khi nghỉ việc 3 năm, Nhân sự **ẩn danh hoá** thông tin cá nhân của người cũ tại **Quản trị** → [Quyền riêng tư và lưu trữ](/admin/privacy): email công việc và tài khoản ứng dụng, ảnh, số điện thoại, email cá nhân, địa chỉ hiện tại, người liên hệ khẩn cấp, bản chụp giấy tờ tuỳ thân, giấy khám sức khoẻ, bằng cấp, thông báo, hội thoại, dữ liệu khuôn mặt và vị trí chấm công bị xoá. Hồ sơ lương, thuế và bảo hiểm (họ tên, mã nhân viên, số giấy tờ, mã số thuế, số bảo hiểm, hợp đồng, phiếu lương, bảng công…) được giữ theo luật kế toán, thuế và bảo hiểm (tối thiểu mười năm). Không có gì bị xoá cho đến khi Nhân sự xác nhận từng người; thao tác không hoàn tác được.

## Ai đã xem hồ sơ của tôi?

Nhật ký hệ thống (menu **Quản trị** → **Nhật ký hệ thống**) do người có quyền xem nhật ký (ví dụ **Quản trị nhân sự**, **Kiểm toán (chỉ xem)**) mở được. Nếu bạn nghi ngờ thông tin của mình bị xem không đúng mục đích, hãy báo cho Nhân sự hoặc Ban điều hành để họ kiểm tra nhật ký.
