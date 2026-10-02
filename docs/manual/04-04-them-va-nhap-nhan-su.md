# Thêm và nhập nhân sự

Trang này dành cho **Nhân sự** (vai trò **Chuyên viên nhân sự** hoặc **Quản trị nhân sự**): thêm từng người mới, nhập nhiều nhân viên cùng lúc từ Excel hoặc CSV, và nhập quá trình công tác trước khi công ty dùng SuZu One.

Bạn chỉ thêm được người vào những pháp nhân và đơn vị nằm trong phạm vi vai trò của mình. Nút **Thêm nhân sự** và **Nhập danh sách nhân viên** chỉ hiện với người có quyền này.

## Thêm một nhân sự

Mở [Nhân sự](/people) → **Thêm nhân sự** (hoặc vào thẳng [/people/new](/people/new)). Biểu mẫu tạo cùng lúc hồ sơ cá nhân, quan hệ lao động với pháp nhân và vị trí công tác đầu tiên.

### Bước 1: Thông tin cá nhân

| Ô | Ghi chú |
| --- | --- |
| **Họ và tên** | Bắt buộc |
| **Email công ty** | Phải thuộc tên miền Google Workspace của công ty. Có email công ty thì người này đăng nhập được. **Để trống = không dùng ứng dụng** |
| **Điện thoại**, **Ngày sinh**, **Giới tính**, **Tình trạng hôn nhân**, **Quốc tịch**, **Email cá nhân**, **Địa chỉ thường trú**, **Chỗ ở hiện tại** | Không bắt buộc, nhưng nên điền ngày sinh, điện thoại hoặc email cá nhân để hệ thống phát hiện hồ sơ trùng |

### Bước 2: Quan hệ lao động

| Ô | Ghi chú |
| --- | --- |
| **Pháp nhân** | Công ty ký hợp đồng với người này |
| **Mã nhân viên** | **Để trống = số kế tiếp** theo cách đánh mã của pháp nhân. Mã không được trùng trong cùng pháp nhân |
| **Ngày vào làm** | Bắt buộc, mặc định là hôm nay |
| **Ngày tính thâm niên** | Để trống thì lấy bằng ngày vào làm |

### Bước 3: Vị trí và tuyến báo cáo

| Ô | Ghi chú |
| --- | --- |
| **Loại lao động** | Chính thức, Thử việc, Thực tập, Bán thời gian, Cộng tác viên, Cố vấn |
| **Đơn vị** | Phòng ban hoặc nhóm trong cây tổ chức. Đơn vị phải thuộc pháp nhân đã chọn hoặc là đơn vị dùng chung |
| **Chức vụ** | Gõ tự do; hệ thống gợi ý các chức vụ đã có |
| **Cấp bậc** | Chọn một: Intern, Junior, Mid-level, Senior |
| **Cấp vị trí** | Chọn một: Executive, Leader, Manager, Director, C-level. Cấp bậc và cấp vị trí ghép lại thành **Chức danh**, ví dụ "Senior Manager" |
| **Quản lý trực tiếp** | Người duyệt đơn từ và thấy hồ sơ chi tiết của nhân viên này |
| **Quản lý gián tiếp** | Báo cáo theo đường chấm (không bắt buộc) |
| **Chi nhánh** | Chỉ hiện khi pháp nhân có chi nhánh |
| **Nơi làm việc** | Gõ tự do |

Bấm **Thêm nhân sự**. Nếu thành công, bạn được chuyển tới hồ sơ vừa tạo.

### Điều gì xảy ra sau khi thêm

- Nếu ngày vào làm là **hôm nay hoặc đã qua**, người này có trạng thái **Đang làm việc** ngay. Nếu là **ngày trong tương lai**, trạng thái là **Chờ nhận việc** và tự chuyển sang **Đang làm việc** vào đúng ngày vào làm.
- Sự kiện **Tiếp nhận** được ghi vào mục **Quá trình công tác**.
- Nếu có mẫu checklist tiếp nhận phù hợp, các bước được giao ngay cho từng người phụ trách (xem trang **Checklist tiếp nhận và thôi việc**).
- Nếu có email công ty, người này đăng nhập SuZu One bằng tài khoản Google công ty đó.

> [!TIP]
> Sau khi thêm, hãy hoàn thiện hồ sơ ngay trên trang của người đó: thêm hợp đồng, thông tin hạn chế (CCCD, mã số thuế, tài khoản ngân hàng), liên hệ khẩn cấp và giấy tờ. Xem trang **Hợp đồng, giấy tờ và người phụ thuộc**.

### Khi hệ thống báo có thể trùng hồ sơ

Trước khi lưu, SuZu One tìm những người đã có trong hệ thống và **trùng họ tên và ngày sinh**, **trùng email cá nhân** hoặc **trùng số điện thoại**. Nếu thấy, biểu mẫu chưa lưu mà hiện khung "Có thể người này đã có hồ sơ:" kèm danh sách (mã nhân viên, pháp nhân, nhãn **đã nghỉ việc** nếu là người cũ, và lý do trùng).

- Bấm vào tên để mở hồ sơ đó trong tab mới và kiểm tra.
- Nếu đây là **nhân viên cũ quay lại**, đừng tạo hồ sơ mới. Hãy mở hồ sơ cũ và dùng **Tuyển lại** (xem trang **Nghỉ việc, thôi việc và tuyển lại**).
- Nếu chắc chắn đây là người khác, tick ô **Đây là người khác, vẫn tạo hồ sơ mới** rồi bấm **Thêm nhân sự** lần nữa.

### Lỗi thường gặp

| Thông báo | Cách xử lý |
| --- | --- |
| Email công ty phải thuộc tên miền Google Workspace của công ty. | Dùng email theo tên miền công ty, hoặc để trống |
| Email công ty này đã thuộc về người khác. | Kiểm tra lại, có thể người này đã có hồ sơ |
| Mã nhân viên này đã được dùng trong pháp nhân. | Đổi mã khác hoặc để trống cho hệ thống tự cấp |
| Không tìm được mã nhân viên trống. Vui lòng nhập mã thủ công. | Nhập mã bằng tay |
| Phòng ban thuộc pháp nhân khác. / Đơn vị đó thuộc pháp nhân khác. | Chọn đơn vị của đúng pháp nhân |
| Thay đổi này khiến tuyến báo cáo bị vòng lặp. | Người quản lý được chọn đang (gián tiếp) báo cáo cho chính người này |

## Nhập danh sách nhân viên từ Excel / CSV

Dùng khi cần đưa nhiều người vào cùng lúc, ví dụ lúc chuyển dữ liệu từ bảng tính cũ sang SuZu One. Mở [Nhân sự](/people) → **Nhập danh sách nhân viên** ([/people/import](/people/import)).

> [!IMPORTANT]
> Tệp chỉ dành cho **người mới**. Người đã có trong hệ thống (trùng email công việc, mã nhân viên hoặc số CCCD) bị báo lỗi chứ không được cập nhật. Muốn sửa người đã có, hãy sửa trên hồ sơ của họ.

### Các bước

1. Trong khung **Tệp nhân viên**, bấm **Tải file mẫu** để lấy tệp có sẵn tên cột và một dòng ví dụ.
2. Điền mỗi người một dòng. Cột bắt buộc: **Họ và tên**, **Pháp nhân (mã)**, **Ngày vào làm**. Các cột khác: Mã nhân viên, Email công việc, Phòng ban (mã), Nhóm, Chức vụ, Cấp bậc, Cấp vị trí, Loại lao động, Ngày tính thâm niên, Quản lý trực tiếp (mã NV hoặc email), Ngày sinh, Giới tính, Tình trạng hôn nhân, Quốc tịch, Số điện thoại, Email cá nhân, Địa chỉ thường trú, Nơi ở hiện tại, Số CCCD, Ngày cấp CCCD, Nơi cấp CCCD, Mã số thuế, Số sổ BHXH, Ngân hàng, Số tài khoản, Chủ tài khoản.
3. Bấm **Chọn file .xlsx hoặc .csv** rồi **Kiểm tra file**.
4. Hệ thống đọc toàn bộ tệp và báo số dòng, số lỗi. Mỗi lỗi ghi rõ **Dòng …**, cột nào và lý do. Bản xem trước hiện các dòng đầu, với CCCD, mã số thuế, số BHXH và số tài khoản bị che.
5. Nếu có lỗi: sửa trong tệp rồi kiểm tra lại. Lúc này chưa có gì được ghi vào hệ thống.
6. Nếu không có lỗi: bấm **Ghi … dòng vào hệ thống**. Hoặc **tất cả** các dòng được lưu, hoặc **không dòng nào**, nên không có chuyện nhập dở dang.

### Mẹo điền tệp

- **Ngày** ghi theo dạng dd/mm/yyyy, ví dụ 01/03/2024.
- **Quản lý trực tiếp** ghi bằng mã nhân viên hoặc email công việc. Người quản lý có thể là người đã có trong hệ thống, hoặc nằm ở bất kỳ dòng nào trong cùng tệp.
- **Loại lao động** dùng đúng chữ: Chính thức, Thử việc, Thực tập, Bán thời gian, Cộng tác viên (hoặc CTV), Cố vấn.
- **Số điện thoại**: định dạng cột là *văn bản* trong Excel, nếu không số 0 ở đầu sẽ mất.
- **Phòng ban** ghi bằng **mã** phòng ban; **Nhóm** ghi bằng tên nhóm nằm trong phòng ban đó.
- Tài khoản ngân hàng cần cả tên ngân hàng và số tài khoản.

> [!NOTE]
> Người được nhập với ngày vào làm **đã qua** thì không có checklist tiếp nhận (họ đã vào làm từ trước). Người có ngày vào làm từ hôm nay trở đi thì có checklist như khi thêm bằng tay.

> [!NOTE]
> Số CCCD, mã số thuế, số sổ BHXH và số tài khoản ngân hàng được mã hóa ngay khi kiểm tra tệp và lưu mã hóa sau khi ghi.

## Nhập quá trình công tác trước đây

Cùng trang [Nhập danh sách nhân viên](/people/import), phần **Quá trình công tác trước đây** dùng để ghi lại lịch sử của **nhân viên đã có trong hệ thống**: họ từng ở phòng ban nào, chức vụ gì, trước khi công ty dùng SuZu One.

1. Trong khung **Tệp quá trình công tác**, bấm **Tải file mẫu**.
2. Mỗi dòng là **một giai đoạn đã kết thúc**. Cột bắt buộc: **Mã nhân viên**, **Từ ngày**, **Đến ngày**. Cột khác: Phòng ban (mã), Nhóm, Chức vụ, Cấp bậc, Cấp vị trí, Loại lao động, Quản lý trực tiếp (mã NV hoặc email), Ghi chú.
3. **Kiểm tra file**, sửa lỗi nếu có, rồi ghi vào hệ thống.

Các dòng của cùng một người được áp dụng **từ cũ đến mới**, giống như thao tác **Thêm quá trình công tác trước đây** trên hồ sơ (xem trang **Vị trí và quá trình công tác**). Khi xong, hệ thống báo bao nhiêu giai đoạn đã ghi và bao nhiêu giai đoạn cũ được điều chỉnh cho vừa.

> [!TIP]
> Giai đoạn cũ nhất nên bắt đầu từ ngày vào làm. Giai đoạn cuối cùng phải kết thúc muộn nhất là hôm qua; vị trí hiện tại không bị thay đổi bởi tệp này.

## Phòng ban phải có trước

Tệp nhân viên và tệp quá trình công tác tham chiếu phòng ban bằng **mã**. Nếu phòng ban chưa có, quản trị viên tạo trước trong **Quản trị** → **Cơ cấu tổ chức** (có thể nhập phòng ban từ Excel / CSV ở đó).
