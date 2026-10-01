# Pháp nhân & cơ cấu tổ chức

Hai màn hình này mô tả "hình dạng" của tập đoàn trong SuZu One:

- **Pháp nhân** — các công ty trong tập đoàn, mỗi công ty có mã số thuế, vùng lương, chi nhánh riêng.
- **Cơ cấu tổ chức** — **một cây đơn vị duy nhất**: phòng ban, nhóm lớn, nhóm nhỏ, lồng nhau sâu bao nhiêu cấp cũng được. Đơn vị có thể thuộc một pháp nhân hoặc **dùng chung** cho cả tập đoàn.

Gần như mọi thứ khác — phân quyền, luồng duyệt, báo cáo, đối tượng nhận thông báo — đều dựa vào hai màn hình này, nên hãy giữ chúng chính xác.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem pháp nhân và cây tổ chức | Mọi người có ít nhất một vai trò (mọi vai trò đều có quyền xem tổ chức). Người được giao một pháp nhân chỉ thấy pháp nhân đó trong danh sách pháp nhân. |
| Tạo pháp nhân mới | **Quản trị nhân sự** phạm vi toàn tập đoàn, **Chủ sở hữu**. |
| Sửa một pháp nhân, chi nhánh | **Quản trị nhân sự** có phạm vi bao trùm pháp nhân đó, **Chủ sở hữu**. |
| Thêm, sửa đơn vị của một pháp nhân | **Quản trị nhân sự** có phạm vi bao trùm pháp nhân hoặc đơn vị đó. |
| Thêm, sửa đơn vị **dùng chung**; nhập phòng ban từ file | **Quản trị nhân sự** phạm vi toàn tập đoàn, **Chủ sở hữu**. |

## Phần 1 — Pháp nhân

Mở **Quản trị** → [Pháp nhân](/admin/entities). Bảng liệt kê **Mã**, **Tên pháp lý**, **Mã số thuế**, **Vùng lương**, **Trạng thái** (**Hoạt động** / **Ngừng**).

### Thêm pháp nhân

1. Ở khung **Thêm pháp nhân** cuối trang, điền **Mã** (2–12 ký tự: chữ không dấu, số, gạch ngang, gạch dưới), **Tên ngắn**, **Tên pháp lý**, **Mã số thuế**, **Vùng lương**.
2. Bấm **Tạo**.

Mã pháp nhân không đổi được về sau và xuất hiện trong nhiều mã số khác (ví dụ mã tin tuyển dụng, số thư mời nhận việc), nên hãy chọn mã ngắn, dễ nhận.

### Sửa pháp nhân và chi nhánh

Bấm vào một pháp nhân để mở trang chi tiết:

- Sửa **Tên ngắn**, **Tên pháp lý**, **Người đại diện pháp luật**, **Mã số thuế**, **Mã đơn vị BHXH**, **Vùng lương**, **Địa chỉ**, ô **Hoạt động**; bấm **Lưu**.
- Mục **Chi nhánh / địa điểm**: thêm chi nhánh (**Tên chi nhánh**, **Địa chỉ**, **Thêm chi nhánh**), sửa hoặc ngừng chi nhánh có sẵn. Chi nhánh dùng được ở những nơi cần chọn địa điểm, ví dụ đối tượng nhận thông báo.

> [!NOTE]
> **Vùng lương** quyết định mức lương tối thiểu vùng áp dụng cho người lao động của pháp nhân (mức cụ thể nằm trong **Tham số pháp định**). **Mã đơn vị BHXH** và **Người đại diện pháp luật** được dùng trong hồ sơ bảo hiểm và các văn bản in ra.

Không thể chuyển một pháp nhân sang **Ngừng** khi vẫn còn nhân sự thuộc pháp nhân đó.

## Phần 2 — Cơ cấu tổ chức

Mở **Quản trị** → [Cơ cấu tổ chức](/admin/org). Trang hiển thị cây đơn vị, đơn vị con thụt vào dưới đơn vị cha. Mỗi dòng có **Mã**, tên, loại (**Phòng ban** / **Nhóm**), pháp nhân sở hữu hoặc **Dùng chung**, nhãn **Ngừng** nếu đã ngừng, và số đơn vị trực thuộc.

### Đơn vị cấp trên bao trùm đơn vị bên dưới

Đây là quy tắc quan trọng nhất của cây tổ chức:

- Khi bạn **chọn một đơn vị** ở bất kỳ đâu trong hệ thống — làm phạm vi của một vai trò, làm đối tượng đọc một không gian tri thức, làm đối tượng nhận một thông báo — lựa chọn đó **bao gồm mọi đơn vị bên dưới**. Ví dụ, cấp vai trò **Trưởng bộ phận** cho khối Sáng tạo thì người đó phụ trách luôn các nhóm Design, Video, Motion bên dưới.
- Khi bạn chỉ muốn **riêng đơn vị đó, không gồm các nhóm con**, những nơi cho chọn đối tượng (thông báo, quyền truy cập tri thức) có tuỳ chọn **Chỉ riêng đơn vị đó**. Phạm vi của vai trò thì luôn gồm cả đơn vị bên dưới.

### Mỗi người thuộc một đơn vị

Mỗi nhân sự được xếp vào **một** đơn vị trong cây (trong hồ sơ nhân sự — xem chương **Nhân sự**). Từ đó hệ thống **tự suy ra** phòng ban và nhóm của người đó: phòng ban là đơn vị loại **Phòng ban** gần nhất phía trên, nhóm là đơn vị loại **Nhóm**. Bạn không cần (và không thể) nhập riêng phòng ban hay nhóm. Khi bạn đổi cấp trên của một đơn vị, mọi người trong đơn vị đó và bên dưới được cập nhật theo.

### Thêm một đơn vị

- Ở **cấp cao nhất** hoặc bất kỳ đâu: dùng khung **Thêm đơn vị** ở cuối trang.
- **Bên trong một đơn vị có sẵn**: bấm vào đơn vị đó để mở ra, rồi dùng khung **Thêm đơn vị trong …** (ô **Trực thuộc** được chọn sẵn).

Điền:

1. **Mã** — 2–12 ký tự (chữ không dấu, số, gạch ngang, gạch dưới), không trùng với đơn vị khác. Mã **không đổi được** sau khi tạo.
2. **Tên đơn vị**.
3. **Loại**: **Phòng ban** hoặc **Nhóm**.
4. **Trực thuộc** — đơn vị cấp trên, hoặc **Cấp cao nhất**.
5. **Thuộc về** — một pháp nhân, hoặc **Dùng chung** (chỉ hiện với quản trị phạm vi toàn tập đoàn). Đơn vị dùng chung có thể có người của nhiều pháp nhân.
6. Bấm **Thêm đơn vị**.

### Sửa, chuyển hoặc ngừng một đơn vị

Bấm vào đơn vị để mở biểu mẫu sửa: đổi tên, loại, **Trực thuộc** (chuyển cả nhánh sang chỗ khác trong cây), pháp nhân, ô **Hoạt động**; bấm **Lưu**.

> [!WARNING]
> - Một đơn vị không thể trực thuộc chính nó hoặc một đơn vị con của nó.
> - Không thể ngừng một đơn vị khi vẫn còn nhân sự thuộc đơn vị đó **hoặc bất kỳ đơn vị nào bên dưới**. Hãy chuyển người đi trước.
> - Chuyển một đơn vị sang nhánh khác làm thay đổi phạm vi của những vai trò được cấp trên nhánh cũ / nhánh mới. Hãy kiểm tra lại **Phân quyền** sau khi tái cơ cấu lớn.

### Nhập phòng ban từ Excel / CSV

Dùng khi dựng cây tổ chức lần đầu hoặc tái cơ cấu hàng loạt (quản trị phạm vi toàn tập đoàn):

1. Ở khung **Nhập phòng ban từ Excel / CSV**, bấm **Tải file mẫu**.
2. Điền các cột: **Mã phòng ban** (bắt buộc), **Tên phòng ban** (bắt buộc), **Trực thuộc (mã)**, **Pháp nhân (mã)** — để trống cột pháp nhân thì đơn vị là dùng chung.
3. **Chọn file .xlsx hoặc .csv**, bấm **Kiểm tra file**. Hệ thống liệt kê lỗi theo từng dòng (thiếu cột, mã sai định dạng, không có pháp nhân / cấp trên mang mã này, trực thuộc vòng tròn…). Chưa có gì được ghi vào hệ thống ở bước này.
4. Khi không còn lỗi, bấm **Ghi … dòng vào hệ thống**.

Mã mới được tạo; mã đã có thì tên và cấp trên được cập nhật.

## Mẹo

- Đặt mã đơn vị ngắn và ổn định (ví dụ `DES`, `VID`): tên đổi được, mã thì không.
- Vẽ cây theo **cách công ty thực sự phân quyền và duyệt**, không chỉ theo sơ đồ trên giấy: trưởng của một đơn vị duyệt cho mọi người bên dưới.
- Xem cây tổ chức dưới góc nhìn nhân viên ở trang **Danh bạ và sơ đồ tổ chức**.
