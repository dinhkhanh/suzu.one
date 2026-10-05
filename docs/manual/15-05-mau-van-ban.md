# Mẫu văn bản & cấp văn bản

SuZu One cấp các văn bản về nhân viên — giấy xác nhận công tác, giấy xác nhận thu nhập, quyết định, hợp đồng, thư mời nhận việc — từ **mẫu văn bản** có sẵn. Mỗi văn bản được cấp một **số văn bản**, ghi lại ai cấp, khi nào, và tải về dưới dạng PDF.

Trang này dành cho **phòng Nhân sự** (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự**) và chủ sở hữu.

## Văn bản được cấp khi nào

Cách phổ biến nhất:

1. Nhân viên gửi **Đề nghị cấp giấy xác nhận** (xem trang **Gửi đề nghị**): chọn loại giấy, gửi tới cơ quan nào, ngôn ngữ, số bản, cần trước ngày nào.
2. Nhân sự duyệt đề nghị; nếu là giấy xác nhận thu nhập có ghi số lương, Ban điều hành duyệt thêm.
3. Khi đề nghị được duyệt xong, hệ thống **tự cấp** giấy xác nhận từ mẫu tương ứng (mã `XN-CONG-TAC` cho giấy xác nhận công tác, `XN-LUONG` cho giấy xác nhận thu nhập; mẫu riêng của pháp nhân được ưu tiên), nhân danh người duyệt cuối. Trang đề nghị ghi số văn bản và liên kết tới PDF; nhân viên cũng thấy văn bản ở mục **Văn bản của tôi** trên [Hồ sơ của tôi](/me).
4. Nhân sự in, ký và giao bản giấy nếu cần.

Nếu người duyệt cuối không được cấp mẫu đó (ví dụ giấy xác nhận thu nhập cần quyền xem lương), đề nghị vẫn được duyệt nhưng không có văn bản: Nhân sự cấp bằng tay từ hồ sơ nhân viên như bên dưới. Giấy giới thiệu không có mẫu, Nhân sự tự soạn.

Nhân sự cũng có thể cấp văn bản bất cứ lúc nào mà không cần đề nghị (ví dụ một quyết định bổ nhiệm). Khi ghi nhận **Đạt thử việc hoặc gia hạn hợp đồng** trên hồ sơ, có thể cấp luôn quyết định gắn với sự kiện (xem trang **Vị trí và quá trình công tác**).

## Mức nhạy cảm — điều quan trọng nhất

Mỗi mẫu có một **Mức nhạy cảm**: **Nội bộ**, **Cá nhân**, **Hạn chế** hoặc **Lương thưởng**. Mức này phải đủ cao cho những thông tin mà nội dung mẫu in ra:

| Thông tin mẫu in ra | Mức tối thiểu |
| --- | --- |
| Thông tin công ty, số văn bản, ngày, nơi lập | **Nội bộ** |
| Họ tên, mã nhân viên, chức danh, phòng ban, email, ngày vào làm, loại hợp đồng | **Cá nhân** |
| Ngày sinh, giới tính | **Hạn chế** |
| Lương cơ bản, lương đóng bảo hiểm, phụ cấp, tổng thu nhập | **Lương thưởng** |

Hệ thống **từ chối lưu** một mẫu có mức thấp hơn thông tin nó in ra. Nhờ vậy không thể có một mẫu "vô tình" in số lương cho người không được xem lương.

Mức nhạy cảm cũng quyết định **ai được cấp**: người cấp phải vừa quản lý hồ sơ của nhân viên đó, vừa được xem thông tin ở mức của mẫu. Ví dụ, Chuyên viên nhân sự cấp được giấy xác nhận công tác, nhưng giấy xác nhận thu nhập (mức **Lương thưởng**) chỉ người có quyền xem lương — như Quản trị nhân sự — mới cấp được. Quản lý trực tiếp không bao giờ cấp được văn bản có số lương.

## Cấp một văn bản

1. Vào [Nhân sự](/people), mở hồ sơ của nhân viên.
2. Kéo xuống mục **Văn bản đã cấp**.
3. Ở ô **Chọn mẫu văn bản…**, chọn mẫu. Danh sách chỉ gồm những mẫu đang dùng, áp dụng cho pháp nhân của nhân viên (hoặc dùng chung toàn nhóm), và bạn được phép cấp. Nếu không có mẫu nào, bạn thấy **Không có mẫu văn bản nào bạn được phép cấp cho người này.**
4. Bấm **Cấp văn bản**. Màn hình báo **Đã cấp văn bản số …** kèm liên kết **Tải PDF**.
5. Mở PDF, kiểm tra nội dung, in và ký.

Văn bản được **lưu đúng như lúc cấp** (một tệp PDF): mở lại sau này vẫn là bản đó, kể cả khi mẫu, ngày hay thông tin nhân viên đã thay đổi. Văn bản cấp trước khi có cơ chế này được lưu một lần ở lần mở đầu tiên, ghi ngày đã cấp.

> [!IMPORTANT]
> Với mẫu mức **Lương thưởng**, hệ thống yêu cầu bạn **xác thực lại** trước khi cấp (thông báo **Hãy xác thực lại để tiếp tục.**), giống như khi xem phiếu lương. Làm theo hướng dẫn trên màn hình rồi bấm cấp lại.

### Số văn bản

Số được cấp tự động theo dạng **mã pháp nhân – loại – năm – số thứ tự**, ví dụ `SZM-XN-2026-0007`. Phần loại là:

| Loại | Ký hiệu |
| --- | --- |
| **Hợp đồng** | HD |
| **Quyết định** | QD |
| **Giấy xác nhận** | XN |
| **Thư mời nhận việc** | TM |
| **Văn bản khác** | VB |

Số thứ tự đếm lại từ đầu mỗi năm, riêng cho từng pháp nhân và từng loại. Hai văn bản cấp cùng lúc không bao giờ trùng số.

### Xem lại văn bản đã cấp

Bảng **Văn bản đã cấp** trên hồ sơ liệt kê **Số**, **Mẫu**, **Mức nhạy cảm**, **Người cấp**, **Ngày cấp** và liên kết **Tải PDF**. Bạn chỉ thấy những văn bản mà **hiện tại** bạn vẫn được phép xem: nếu quyền của bạn bị thu hẹp, các văn bản ở mức cao hơn sẽ không còn hiện, kể cả văn bản do chính bạn cấp trước đó.

### Sổ văn bản đã cấp

[Văn bản](/documents) là sổ đăng ký chung: mọi hợp đồng, quyết định và giấy tờ đã cấp mà bạn được mở, mới nhất trước, lọc theo **Loại** và **Năm**. Trang hiện các văn bản mới nhất; lọc theo loại hoặc năm để xem văn bản cũ hơn. Quyền xem được kiểm tra lại cho từng dòng.

## Viết và sửa mẫu văn bản

Vào **Quản trị → Mẫu văn bản** ([Mẫu văn bản](/admin/document-templates)). Bảng liệt kê **Mã mẫu**, **Tên mẫu**, **Loại**, **Pháp nhân**, **Mức nhạy cảm** và **Phiên bản**. Nếu nội dung của một mẫu cần mức cao hơn mức đang đặt, cột mức nhạy cảm ghi thêm "(cần …)".

Khi hệ thống được cài đặt, có sẵn các mẫu khởi đầu: **Giấy xác nhận công tác**, **Giấy xác nhận thu nhập**, **Quyết định bổ nhiệm**, **Quyết định thôi việc**, **Hợp đồng lao động (khung)** và **Thư mời nhận việc**. Đây là bản nháp tham khảo — hãy để bộ phận pháp chế rà soát lời văn trước khi dùng.

### Tạo hoặc sửa một mẫu

1. Bấm **Tạo mẫu mới**, hoặc bấm vào mã của một mẫu để sửa.
2. Điền **Mã mẫu** (tự viết hoa), **Tên mẫu**, **Loại**, **Pháp nhân** (hoặc **Dùng chung toàn nhóm**) và **Mức nhạy cảm**.
3. Viết **Nội dung mẫu**. Chỗ cần điền thông tin thì đặt trường trong cặp ngoặc nhọn kép, ví dụ `{{person.fullName}}`, `{{employment.startDate}}`, `{{salary.total}}`. Mở mục **Danh sách trường có thể chèn** để xem mọi trường và mức nhạy cảm của từng trường.
4. Ngay dưới nội dung, hệ thống cho biết **Nội dung hiện tại cần mức nhạy cảm tối thiểu: …**, các trường **Đang dùng**, và cảnh báo nếu có trường **Không nhận diện được** hoặc mức đang chọn quá thấp.
5. Điền **Thông tin đầu thư**: **Tên công ty**, **Địa chỉ**, **Mã số thuế**, **Điện thoại**, **Người đại diện**, **Chức vụ người đại diện**, **Nơi lập văn bản**. Các trường `{{company.…}}` và `{{document.place}}` lấy giá trị từ đây — trừ tên pháp lý, địa chỉ, mã số thuế và người đại diện mà pháp nhân của nhân viên đã khai trong **Quản trị → Pháp nhân**: những giá trị đó được ưu tiên hơn giá trị của mẫu.
6. Để tích **Đang sử dụng** nếu mẫu được phép cấp; bỏ tích để ngừng dùng mẫu mà không xóa.
7. Bấm **Lưu mẫu**.

Mỗi lần lưu, **Phiên bản** của mẫu tăng thêm một.

Ngoài họ tên, mã nhân viên, ngày vào làm…, mẫu còn chèn được: chức danh (`{{person.jobTitle}}`), nhóm, quản lý trực tiếp, chi nhánh, nơi làm việc, số điện thoại và địa chỉ, hợp đồng đang hiệu lực (`{{contract.number}}`, `{{contract.type}}`, `{{contract.startDate}}`…), sự kiện mà văn bản được cấp cho (`{{event.type}}`, `{{event.effectiveDate}}`, `{{event.from}}`, `{{event.to}}`), và — ở mức **Hạn chế** — số CCCD, mã số thuế, số sổ BHXH. Các mã như loại nhân sự, trạng thái, giới tính, loại hợp đồng, loại sự kiện được in bằng chữ tiếng Việt. Danh sách đầy đủ ở mục **Danh sách trường có thể chèn**.

> [!WARNING]
> Một trường không có dữ liệu (ví dụ nhân viên chưa có chức danh) sẽ để trống trong văn bản. Luôn đọc lại PDF trước khi ký.

> [!TIP]
> Mẫu dùng chung toàn nhóm cần quyền trên cả tập đoàn. Nếu bạn chỉ quản lý một pháp nhân, hãy tạo mẫu riêng cho pháp nhân đó.

## Câu hỏi thường gặp

**Nhân viên có tự tải được văn bản của mình không?** Có. Mọi văn bản cấp về một người hiện ở mục **Văn bản của tôi** trên [Hồ sơ của tôi](/me) của người đó, mở đúng bản PDF đã cấp. Bản có chữ ký và dấu vẫn do Nhân sự giao.

**Thư mời nhận việc cấp ở đâu?** Thư mời dùng cùng thư viện mẫu nhưng được tạo trong quy trình tuyển dụng, với ứng viên chưa có hồ sơ nhân viên — xem chương **Tuyển dụng**.
