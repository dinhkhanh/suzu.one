# Thiết kế loại đề nghị

Mỗi loại đề nghị trong SuZu One — mua sắm, thanh toán, tạm ứng, công tác… — gồm ba phần do quản trị viên tự thiết kế, không cần lập trình:

1. **Biểu mẫu**: người gửi phải điền những gì.
2. **Luồng duyệt**: ai duyệt, theo thứ tự nào, trong điều kiện nào.
3. **Nhắc và leo thang**: nhắc người duyệt khi để quá lâu, và báo lên trên khi vẫn không ai trả lời.

Ngoài ra, một loại có thể cho phép lập **đề nghị kèm theo** (ví dụ tạm ứng dưới một chuyến công tác).

## Ai làm được

Người có quyền quản trị tổ chức: vai trò **Quản trị nhân sự** và **Chủ sở hữu**. Họ thấy mục **Quản trị → Loại đề nghị** trên thanh bên, và đường dẫn **Thiết kế loại đề nghị** trên trang [Đề nghị](/requests).

Người chỉ quản trị một pháp nhân sẽ chỉ tạo và sửa được loại đề nghị của pháp nhân đó; loại dùng cho **Toàn tập đoàn** cần quyền trên cả tập đoàn.

## Danh sách loại đề nghị

Vào [Loại đề nghị](/admin/request-types). Mỗi dòng cho biết tên, mã, số trường của biểu mẫu, số ngày nhắc, số đề nghị kèm theo, và các nhãn:

- tên pháp nhân áp dụng, hoặc **Toàn tập đoàn**;
- **Chỉ kèm theo** — loại không lập riêng được;
- **Đã tắt** — loại không còn hiện cho người gửi.

## Tạo một loại mới

1. Bấm **Thêm loại đề nghị**.
2. Điền **Thông tin chung**:
   - **Mã** — chữ thường không dấu, ví dụ `purchase`. Sau khi lưu, mã **không đổi được** vì các đề nghị đã gửi tham chiếu tới nó.
   - **Nhóm** — **Mua sắm**, **Tài chính**, **Nhân sự**, **IT**, **Hành chính** hoặc **Khác**; quyết định loại nằm dưới tiêu đề nào ở trang **Tạo đề nghị mới**.
   - **Tên (tiếng Việt)**, **Tên (tiếng Anh)**, **Mô tả (tiếng Việt)**, **Mô tả (tiếng Anh)**.
   - **Áp dụng cho** — một pháp nhân, hoặc **Toàn tập đoàn**. Nhân viên chỉ thấy loại của pháp nhân mình và loại dùng chung.
   - **Thứ tự hiển thị** — số nhỏ đứng trước.
3. Thêm các trường của biểu mẫu (xem bên dưới).
4. Đặt **Nhắc và leo thang** nếu muốn.
5. Bấm **Lưu**. Sau khi lưu, bạn được đưa sang trang của loại đó để thiết lập luồng duyệt.

> [!IMPORTANT]
> Nếu một loại chưa có luồng duyệt nào được lưu, đề nghị sẽ chỉ đi qua **quản lý trực tiếp** của người gửi. Hãy luôn lưu một luồng duyệt rõ ràng cho mỗi loại mới.

## Thiết kế biểu mẫu

Bấm **Thêm trường** để thêm một trường; dùng **Lên trên** / **Xuống dưới** để đổi thứ tự, **Xóa** để bỏ. Mỗi trường có:

- **Mã trường** — bắt đầu bằng chữ thường, chỉ gồm chữ, số và dấu gạch dưới; không trùng trong cùng biểu mẫu.
- **Kiểu** — **Văn bản ngắn**, **Văn bản dài**, **Số**, **Số tiền (VNĐ)**, **Ngày**, **Chọn một**, **Chọn nhiều**, **Ô tích**, **Nhân sự**, **Pháp nhân**, **Tệp đính kèm**.
- **Nhãn (tiếng Việt)** và **Nhãn (tiếng Anh)** — cả hai đều bắt buộc.
- **Bắt buộc** — người gửi phải điền.
- Tùy kiểu trường, các giới hạn: **Nhỏ nhất** / **Lớn nhất** (số, số tiền), **Từ ngày** / **Đến ngày** (ngày), **Độ dài tối thiểu** / **Độ dài tối đa** và **Định dạng (regex)** (văn bản), **Cho chọn nhiều** (nhân sự, pháp nhân).
- Với kiểu chọn: **Danh sách lựa chọn** — mỗi lựa chọn có **Giá trị**, **Nhãn tiếng Việt**, **Nhãn tiếng Anh**; bấm **Thêm lựa chọn** để thêm.

### Trường chỉ hiện trong điều kiện nhất định

Ở mục **Chỉ hiển thị khi**, chọn một trường đứng trước, một **Phép so sánh** (**bằng**, **khác**, **lớn hơn**, **từ**, **nhỏ hơn**, **đến**, **thuộc**) và một **Giá trị so sánh**. Để **Luôn hiển thị** nếu trường lúc nào cũng hiện. Ví dụ: ô "Số tài khoản" chỉ hiện khi "Hình thức" **bằng** "Chuyển khoản".

Điều kiện chỉ được tham chiếu trường **đứng trước** trường đang đặt, và một trường không thể phụ thuộc vào chính nó.

> [!TIP]
> Nếu biểu mẫu có một trường **Số tiền (VNĐ)**, số tiền đó được dùng làm con số của đề nghị: hiện trong tóm tắt đề nghị và dùng được trong điều kiện của luồng duyệt (ví dụ "chỉ khi số tiền > 20 triệu").

## Thiết lập luồng duyệt

Trên trang của một loại, phần **Luồng duyệt** nằm dưới biểu mẫu. Mỗi luồng áp dụng cho một pháp nhân hoặc cả tập đoàn; bạn có thể có luồng riêng cho từng pháp nhân. Bấm vào khung **Thêm luồng duyệt** để tạo, hoặc sửa luồng có sẵn.

Một luồng gồm tối đa tám bước. Mỗi bước có:

- **Mã** của bước (chữ thường, không trùng).
- **Ai phải trả lời** — **Một người duyệt bất kỳ** hoặc **Tất cả người duyệt**.
- **Mở cùng lúc với bước trước** — cho hai bước chạy song song (bước đầu tiên không dùng được).
- **Người duyệt** — bấm **Thêm người duyệt** và chọn: **Quản lý trực tiếp**, **Trưởng phòng**, **Quản lý cấp trên N bậc** (1–6), **Người có quyền** (ví dụ quyền chi trả lương), **Người giữ vai trò** (ví dụ Ban điều hành) hoặc **Một người cụ thể**.
- **Chỉ khi** — điều kiện để bước này được áp dụng, dựa trên các trường số, lựa chọn và ô tích của biểu mẫu.

Luồng phải có ít nhất một bước không có điều kiện, để không đề nghị nào rơi vào cảnh không ai duyệt. Bấm **Lưu luồng** để lưu, **Về mặc định** để xóa luồng đã cấu hình.

Đề nghị đã gửi giữ nguyên luồng tại thời điểm gửi; thay đổi chỉ áp dụng cho đề nghị mới. Xem thêm trang **Luồng phê duyệt hoạt động thế nào** trong chương **Phê duyệt**.

## Nhắc và leo thang

Trong mục **Nhắc và leo thang**:

- **Nhắc sau (ngày)** — người duyệt được nhắc khi để đề nghị chờ quá số ngày này.
- **Leo thang sau (ngày)** — phải lớn hơn hoặc bằng số ngày nhắc.
- **Leo thang tới** — **Không leo thang**, **Cấp trên của người duyệt** hoặc **Trưởng phòng**.

Đặt 0 để tắt. Việc kiểm tra chạy tự động mỗi sáng; mỗi lượt chờ chỉ được nhắc một lần và leo thang một lần.

## Đề nghị kèm theo

Mục **Đề nghị kèm theo** cho phép lập một loại khác **dưới** đề nghị thuộc loại này. Bấm **Thêm đề nghị kèm theo** và đặt:

- **Loại đề nghị** — loại được lập kèm.
- **Được lập khi** — **Đề nghị này đã được gửi** hoặc **Đề nghị này đã được duyệt**.
- **Không sớm hơn** — **Bất kỳ ngày nào**, hoặc từ ngày ở một trường ngày của biểu mẫu này (ví dụ ngày kết thúc chuyến công tác).
- **Tối đa** — số lần lập tối đa (1–50), hoặc **Không giới hạn**.

Các câu trả lời có **cùng mã trường** ở hai biểu mẫu được chép sang làm giá trị ban đầu. Vì vậy, nếu muốn số tiền và mục đích của chuyến công tác tự điền vào đề nghị tạm ứng, hãy đặt cùng mã trường (ví dụ `amount`, `purpose`) cho cả hai biểu mẫu.

Ô **Có thể lập riêng**: bỏ chọn nếu loại này chỉ được lập kèm một đề nghị khác — khi đó nó không hiện trong danh sách **Tạo đề nghị mới**.

Hệ thống chặn những thiết lập vòng tròn (một loại nằm dưới chính nó qua loại khác) và loại kèm theo trùng lặp.

## Tắt và bật lại một loại

Trên trang của loại, bấm **Tắt loại này** để ngừng cho nhân viên gửi loại đó; bấm **Bật lại** để mở lại. Các đề nghị đã gửi trước đó không bị ảnh hưởng và vẫn được duyệt như bình thường.

## Sửa một loại đang dùng

Bạn có thể sửa tên, mô tả, trường, nhắc hạn bất cứ lúc nào và bấm **Lưu**; màn hình báo **Đã lưu.** Lưu ý:

- Đổi biểu mẫu không làm thay đổi câu trả lời của các đề nghị đã gửi.
- Bỏ một trường đang được luồng duyệt dùng làm điều kiện có thể khiến bước đó không còn áp dụng đúng — hãy xem lại luồng sau khi sửa biểu mẫu.
- Loại đề nghị thanh toán chi phí có phần **Các khoản chi** cố định do hệ thống quản lý; biểu mẫu của nó chỉ chứa phần thông tin chung.
