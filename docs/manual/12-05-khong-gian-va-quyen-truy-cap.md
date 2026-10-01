# Không gian và quyền truy cập

Trang này dành cho **người quản lý không gian**: người quản lý tri thức của công ty (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự**) và lãnh đạo đơn vị quản lý không gian riêng của đơn vị mình (**Trưởng bộ phận**, **Giám đốc pháp nhân**, **Ban điều hành**). Phần cuối, về giới hạn người xem một trang, cũng dành cho người biên tập của không gian.

## Ba mức quyền trong một không gian

| Mức | Làm được gì | Có được từ đâu |
|---|---|---|
| **Xem** | Đọc trang đã xuất bản, xem lịch sử, tìm kiếm | Một dòng mức **Xem** trong danh sách quyền của không gian |
| **Biên tập** | Thêm: tạo, sửa, lưu nháp, xuất bản (không gian mở) hoặc gửi duyệt (không gian có kiểm soát), chuyển, lưu trữ trang, giới hạn người xem trang | Một dòng mức **Biên tập** |
| **Quản lý** | Thêm: đổi thiết lập, đặt quyền, xuất bản trực tiếp trong không gian có kiểm soát, đặt trang bắt buộc xác nhận, lưu mẫu, lưu trữ không gian | Vai trò quản lý tri thức trên công ty sở hữu không gian, hoặc lãnh đạo đơn vị sở hữu không gian (và các đơn vị cấp trên) |

Người quản lý luôn có toàn quyền, không cần dòng nào trong danh sách. **Chủ sở hữu** đọc được mọi không gian và mọi trang, kể cả nhánh bị giới hạn và không gian tài liệu của dự án.

## Các loại không gian

- **Toàn tập đoàn** — dành cho cả tập đoàn, không thuộc riêng công ty nào. Chỉ người quản lý tri thức có phạm vi toàn tập đoàn mới tạo được.
- **Theo công ty** — thuộc một pháp nhân; người quản lý tri thức của công ty đó quản lý.
- **Của đơn vị bạn** — không gian riêng của một phòng ban, nhóm…; mỗi đơn vị có tối đa một không gian. Lãnh đạo đơn vị đó và lãnh đạo các đơn vị cấp trên quản lý.
- **Không gian tài liệu của dự án** — mở cho thành viên dự án; không vai trò nào quản lý thay họ.

## Tạo không gian mới

1. Vào [Tri thức](/kb), cuộn xuống cuối, mở khung **Tạo không gian mới** (chỉ hiện nếu bạn có quyền).
2. Điền:
   - **Tên không gian**.
   - **Mã trên đường dẫn**: tự sinh từ tên (ví dụ "Sổ tay nhân viên" → `so-tay-nhan-vien`); có thể sửa. 2–40 ký tự gồm chữ thường, số và dấu gạch ngang; không trùng không gian khác.
   - **Không gian của đơn vị**: chọn đơn vị nếu đây là không gian riêng của một đơn vị, hoặc **Không thuộc đơn vị nào**. Chỉ hiện những đơn vị bạn lãnh đạo mà chưa có không gian.
   - **Thuộc**: **Toàn tập đoàn** hoặc một công ty.
   - **Cách xuất bản**: **Mở — người biên tập tự xuất bản** hoặc **Có kiểm soát**.
   - **Biểu tượng**: một emoji, ví dụ 📘.
   - **Thứ tự**: số nhỏ hiện trước.
   - **Mô tả**: một câu giới thiệu, hiện trên thẻ không gian.
3. Bấm **Tạo không gian**. Bạn được đưa vào không gian mới.

> [!IMPORTANT]
> Không gian mới mặc định cho **Toàn bộ nhân viên** xem. Ngay sau khi tạo, hãy mở khung **Ai được vào không gian này** để thu hẹp người xem (nếu cần) và thêm người **Biên tập**.

## Đặt ai được vào không gian

Trên trang không gian, khung **Ai được vào không gian này** là danh sách các dòng quyền. Mỗi dòng gồm **Đối tượng**, **Tên** và **Mức**.

| Đối tượng | Ai khớp |
|---|---|
| **Toàn bộ nhân viên** | Mọi nhân viên (không gồm cộng tác viên) |
| **Công ty** | Nhân viên thuộc công ty (pháp nhân) đó |
| **Đơn vị (gồm các đơn vị bên dưới)** | Người trong đơn vị đó và mọi đơn vị con, cháu |
| **Chỉ riêng đơn vị đó** | Chỉ người trực tiếp nằm trong đơn vị đó, không gồm đơn vị con |
| **Vai trò** | Người đang giữ vai trò đó, ví dụ **Tài chính – Kế toán** |
| **Cá nhân** | Đúng một người |

Cách làm:

1. Chọn **Đối tượng**, chọn **Tên** (với **Toàn bộ nhân viên** thì không cần), chọn **Mức**: **Xem** hoặc **Biên tập**.
2. Bấm **Thêm**. Lặp lại cho các dòng khác. Bấm **Bỏ** để xoá một dòng.
3. Bấm **Lưu quyền truy cập**. Thay đổi chỉ có hiệu lực sau khi lưu.

Một người khớp nhiều dòng thì nhận mức cao nhất. Mỗi không gian có tối đa 100 dòng.

> [!NOTE]
> **Cộng tác viên** không thuộc "Toàn bộ nhân viên", công ty hay đơn vị: họ chỉ vào được không gian khi được thêm bằng dòng **Cá nhân**.

### Ví dụ

- Sổ tay chung cho cả công ty, chỉ HR được viết: **Toàn bộ nhân viên — Xem**, và HR có sẵn quyền quản lý.
- Không gian phòng Sáng tạo, cả phòng cùng viết, phòng Kinh doanh được đọc: **Đơn vị: Phòng Sáng tạo — Biên tập**, **Đơn vị: Phòng Kinh doanh — Xem**.
- Quy trình kế toán chỉ cho bộ phận kế toán: **Vai trò: Tài chính – Kế toán — Biên tập**.

## Thiết lập không gian

Khung **Thiết lập không gian** cho phép sửa **Tên không gian**, **Mã trên đường dẫn**, **Cách xuất bản**, **Biểu tượng**, **Thứ tự**, **Mô tả**. Bấm **Lưu**.

- Đổi mã thì **các liên kết cũ vẫn dẫn về không gian này**.
- Công ty sở hữu không gian không đổi được sau khi tạo (vì nó quyết định ai quản lý).
- Chuyển từ **Mở** sang **Có kiểm soát**: từ đó các bản sửa của người biên tập phải qua duyệt. Chuyển ngược lại: người biên tập tự xuất bản được.

## Lưu trữ không gian

Khi một không gian không còn dùng:

1. Trong **Thiết lập không gian**, bấm **Lưu trữ không gian**.
2. Xác nhận: "Lưu trữ không gian này? Người đọc sẽ không còn thấy nó; nội dung vẫn được giữ."

Không gian lưu trữ chỉ còn người quản lý thấy, trong nhóm **Đã lưu trữ** ở trang [Tri thức](/kb); không tạo được trang mới trong đó. Bấm **Khôi phục không gian** để mở lại.

## Giới hạn người xem một trang

Dành cho người biên tập của không gian. Dùng khi một nhánh trang chỉ dành cho một nhóm nhỏ, ví dụ "Quy trình xử lý kỷ luật" trong sổ tay HR.

1. Mở trang gốc của nhánh, mở **Quản lý trang**.
2. Tìm khung **Giới hạn người xem trang này**.
3. Thêm các dòng như ở không gian (**Đối tượng**, **Tên**, **Mức**), bấm **Lưu quyền truy cập**.

Quy tắc:

- Khi có **ít nhất một dòng**, trang này **và mọi trang con** chỉ dành cho những người được nêu, cùng người biên tập và người quản lý của không gian.
- **Để trống** = theo quyền của không gian.
- Trang bị giới hạn có nhãn 🔒 **Giới hạn người xem** trên đầu trang và trong cây trang.
- Nếu một trang cha đã giới hạn, trang con hiện dòng: **Trang này đang theo giới hạn của một trang cha. Thêm dòng ở đây để đặt giới hạn riêng từ trang này trở xuống.**

### Giao quyền biên tập một nhánh

Một dòng mức **Biên tập** trên trang cho phép người đó sửa trang và các trang con, và tạo trang con mới bên dưới, dù họ chỉ có quyền xem cả không gian. Họ không chuyển, giới hạn hay đổi quyền được — những việc đó vẫn của người biên tập không gian.

> [!TIP]
> Cách này phù hợp khi bạn muốn trưởng một nhóm tự cập nhật tài liệu của nhóm mình trong sổ tay chung, mà không cho họ sửa phần còn lại.

## Những câu hỏi thường gặp

**Tôi là trưởng phòng, sao không thấy khung "Tạo không gian mới"?**
Bạn chỉ thấy khung này nếu có quyền quản lý tri thức hoặc đơn vị bạn lãnh đạo (hay một đơn vị bên dưới) chưa có không gian riêng.

**Một người mới vào phòng có tự đọc được không gian của phòng không?**
Có, nếu không gian cấp quyền theo **Đơn vị**. Quyền được tính theo đơn vị hiện tại của người đó, không cần ai làm gì thêm.

**Ai duyệt bản sửa trong không gian có kiểm soát của đơn vị?**
Lãnh đạo đơn vị xuất bản trực tiếp được. Bản sửa người biên tập gửi duyệt thì đi tới người quản lý tri thức của công ty (xem trang **Xuất bản và duyệt**).
