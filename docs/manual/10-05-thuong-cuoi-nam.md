# Thưởng cuối năm

**Thưởng cuối năm** (thưởng tháng 13) được tính cho từng người theo kết quả KPI và OKR của năm, theo **Quy chế thưởng** do Chủ sở hữu phê duyệt. Một đợt thưởng chạy cho cả tập đoàn: C&B mô phỏng chi phí trên mọi pháp nhân, trình CEO, CEO duyệt, rồi tiền được chi qua một **kỳ lương ngoài kỳ** của từng pháp nhân — thuế, bảo hiểm và phiếu lương do bảng lương lo như mọi khoản tiền khác.

Trang này dành cho **C&B / Tiền lương**, **Quản trị nhân sự**, **Ban điều hành** (CEO) và **Chủ sở hữu**.

> [!IMPORTANT]
> Số tiền thưởng là dữ liệu lương. Quản lý trực tiếp, trưởng bộ phận và giám đốc pháp nhân **không** thấy gì ở đây — dù họ có thể xem xếp loại hiệu suất của nhân viên trong phân hệ **Mục tiêu & KPI**. Xếp loại là về hiệu suất; số tiền là lương.

## Ai làm được gì

| Việc | Ai |
|---|---|
| Xem danh sách đợt thưởng, tổng chi phí | Người có quyền xem bảng lương của **mọi** pháp nhân trong đợt (C&B, CEO, kế toán, kiểm toán, Chủ sở hữu) |
| Tạo đợt, **Tính lại**, **Trình CEO**, **Hủy đợt**, **Chi qua kỳ lương ngoài kỳ**, **Thử bảng hệ số khác** | C&B / Quản trị nhân sự có quyền trên mọi pháp nhân của đợt |
| **Duyệt** hoặc **Trả lại HR** | CEO (có quyền ký duyệt bảng lương trên mọi pháp nhân của đợt) |
| Điều chỉnh số tiền của từng người | Chỉ Chủ sở hữu — kể cả CEO cũng không |
| Đề xuất quy chế thưởng | C&B / Quản trị nhân sự |
| Duyệt quy chế thưởng | Chủ sở hữu |

## Vòng đời một đợt thưởng

| Trạng thái | Ý nghĩa | Bước tiếp theo |
|---|---|---|
| **Nháp** | Vừa tạo | **Tính lại** — C&B |
| **Đã mô phỏng** | Đã có danh sách từng người và chi phí; tính lại bao nhiêu lần cũng được; Chủ sở hữu có thể điều chỉnh từng dòng | **Trình CEO** — C&B |
| **Đã trình** | Chờ CEO, không sửa được nữa | **Duyệt** hoặc **Trả lại HR** — CEO |
| **Đã duyệt** | CEO đã ký; điểm KPI các tháng dùng để tính được khóa lại | **Chi qua kỳ lương ngoài kỳ** — C&B |
| **Đã chi** | Đã tạo kỳ lương ngoài kỳ cho từng pháp nhân | Kỳ lương đi tiếp theo quy trình bảng lương |
| **Đã hủy** | Đợt bị hủy (từ Nháp đến Đã duyệt) | — |

## Bước 0 — Chuẩn bị quy chế thưởng

Đợt thưởng chỉ tính được khi đã có **Quy chế thưởng cuối năm** được duyệt cho pháp nhân và năm đó (nếu không, hệ thống báo "Chưa có quy chế thưởng cho pháp nhân và năm này").

Vào [Thưởng cuối năm](/payroll/bonus) → **Quy chế thưởng** (hoặc [Quy chế thưởng](/payroll/bonus/scheme)). Mỗi phiên bản quy chế có **Phạm vi** (**Toàn tập đoàn** hoặc một pháp nhân), **Hiệu lực từ**, trạng thái (**Chờ duyệt**, **Đang áp dụng**, **Đã từ chối**) và các thành phần:

| Thành phần | Ý nghĩa |
|---|---|
| **Khoản chi** | Khoản lương dùng để chi thưởng — quyết định cách tính thuế, bảo hiểm (thường là **Lương tháng 13**) |
| **Lương gốc** | "Một tháng lương" là khoản nào (thường là lương cơ bản) |
| **Trần** | Không ai nhận quá bội số này của một tháng lương |
| **Làm tròn** | Làm tròn số tiền đến bội số bao nhiêu đồng |
| **Thâm niên** | Bảng hệ số theo số tháng làm việc |
| **Hệ số cá nhân** | Hệ số theo xếp loại hiệu suất — **Theo xếp loại đã công bố** hoặc **Theo bảng riêng của quy chế** |
| **Hệ số tập thể** | Hệ số theo mức hoàn thành OKR của đơn vị |
| **Điều kiện** | Số tháng làm việc tối thiểu và các loại hình nhân sự bị loại trừ |

### Đề xuất phiên bản quy chế mới (C&B)

1. Kéo xuống **Đề xuất phiên bản mới**.
2. Chọn **Phạm vi**, **Hiệu lực từ**, ghi **Ghi chú**.
3. Sửa trực tiếp **Cấu hình** (dạng JSON, đã điền sẵn từ quy chế hiện hành). Hệ thống kiểm tra lại toàn bộ khi lưu; nếu sai cấu trúc sẽ báo "Cấu hình không phải JSON hợp lệ" hoặc "Cấu hình quy chế không hợp lệ".
4. Bấm **Đề xuất**. Chủ sở hữu nhận thông báo **Có đề xuất thay đổi quy tắc tính lương**.

Chủ sở hữu mở trang quy chế và bấm **Duyệt** hoặc **Từ chối**. Phiên bản được duyệt thay phiên bản cũ từ ngày hiệu lực.

> [!TIP]
> Nếu bạn không quen JSON, hãy dùng **Thử bảng hệ số khác** trong một đợt thưởng để thử trước bảng hệ số mới và xem tổng chi phí, rồi mới đề xuất quy chế.

## Bước 1 — Tạo đợt thưởng (C&B)

1. Vào [Thưởng cuối năm](/payroll/bonus). Khung **Tạo đợt thưởng** ở cuối trang.
2. Nhập **Năm thưởng** và **Tên đợt** (mặc định "Thưởng cuối năm …").
3. Chọn **Kỳ lương chi trả** — tháng mà tiền thưởng sẽ được chi (mặc định tháng 1 năm sau).
4. Chọn các **Pháp nhân** tham gia. Mỗi pháp nhân sẽ có một kỳ lương ngoài kỳ riêng khi chi.
5. Bấm **Tạo đợt**.

Mỗi năm chỉ có một đợt thưởng đang chạy.

## Bước 2 — Mô phỏng chi phí

1. Mở đợt thưởng, bấm **Tính lại**. Hệ thống dựng danh sách từng người trên mọi pháp nhân và tính số tiền theo quy chế.
2. Khung **Chi phí** cho thấy chi phí theo từng pháp nhân (số người, số người đủ điều kiện) và **Tổng cộng** — trước khi cam kết bất cứ điều gì. Nếu Chủ sở hữu đã điều chỉnh, có thêm dòng **Trước điều chỉnh của chủ sở hữu**.
3. Bảng **Từng người** gồm **Nhân sự**, **Xếp loại**, **Hệ số**, **Theo công thức**, **Thực nhận**; dòng đã được điều chỉnh có ghi **(đã điều chỉnh)**.

Bạn có thể bấm **Tính lại** bao nhiêu lần cũng được khi đợt còn **Nháp** hoặc **Đã mô phỏng** — ví dụ sau khi kết quả đánh giá năm được chốt thêm.

### Thử bảng hệ số khác

Khung **Thử bảng hệ số khác** cho phép C&B sửa cấu hình quy chế ngay trên trang và bấm **Tính thử** để xem **Tổng cộng** nếu áp dụng quy chế đó. Không có gì được lưu lại.

## Xem cách tính của một người

Bấm tên một người trong bảng **Từng người**. Trang chi tiết cho thấy toàn bộ cách tính, từ điểm KPI và OKR đến số tiền:

- **Điểm KPI từng tháng** và **Điểm KPI cả năm** — chỉ những tháng KPI đã chốt.
- **Ba cấu phần** của kết quả năm: **OKR**, **Đánh giá**, **KPI**, mỗi cấu phần một trọng số. Nếu một cấu phần không có số liệu, trọng số của nó được chia lại cho các cấu phần còn lại.
- **Kết quả năm**: **Điểm theo công thức**, điều chỉnh điểm của Chủ sở hữu (nếu có, kèm lý do), **Điểm cuối cùng**, **Xếp loại**.
- **Từng bước**: **Lương một tháng** × **Hệ số thâm niên** × **Hệ số cá nhân** × **Hệ số tập thể** = **Hệ số tổng**, rồi **Sau khi áp trần**, **Sau làm tròn**.
- **Số tiền**: **Theo công thức**, **Chủ sở hữu điều chỉnh** (nếu có, kèm lý do), **Thực nhận**.
- Sau khi chi: đường dẫn **Đã chi qua** **kỳ lương ngoài kỳ**.

Nếu một người không được thưởng, trang ghi rõ lý do, ví dụ:

- Không còn làm việc tại ngày chốt.
- Loại hình nhân sự không thuộc diện thưởng.
- Chưa đủ thâm niên tối thiểu.
- Chưa có kết quả đánh giá năm được chốt / Kết quả năm chưa có điểm.
- Chưa có mức lương tại ngày chốt.

Kết quả đánh giá năm đến từ phân hệ **Mục tiêu & KPI** — xem chương **Mục tiêu, KPI & đánh giá**.

## Chủ sở hữu điều chỉnh từng người

Khi đợt còn **Nháp** hoặc **Đã mô phỏng**, Chủ sở hữu mở trang chi tiết một người và dùng khung **Chủ sở hữu điều chỉnh**:

1. Nhập **Số tiền (đ)** mới.
2. Nhập **Lý do** — bắt buộc.
3. Bấm **Lưu điều chỉnh**.

Số tiền theo công thức vẫn được giữ nguyên bên cạnh để đối chiếu. Muốn bỏ điều chỉnh, để trống số tiền và lưu lại.

## Bước 3 — Trình CEO và duyệt

1. C&B bấm **Trình CEO** (ghi chú tùy chọn). Đợt chuyển sang **Đã trình** và không sửa được nữa.
2. CEO mở đợt thưởng, xem chi phí và danh sách, rồi:
   - bấm **Duyệt** — đợt chuyển sang **Đã duyệt**; dòng "CEO duyệt ngày …" hiện trong danh sách đợt; hoặc
   - bấm **Trả lại HR** kèm **Lý do trả lại** (bắt buộc) — đợt về **Đã mô phỏng** để C&B sửa và trình lại.

CEO vẫn có thể trả lại một đợt đã duyệt, miễn là chưa chi.

> [!NOTE]
> Khi CEO duyệt, các tháng KPI dùng để tính thưởng bị khóa lại: phân hệ hiệu suất không mở lại được những tháng này nữa, để số tiền luôn giải thích được bằng đúng số liệu đã dùng. Nếu đợt bị trả lại, các tháng được mở khóa.

## Bước 4 — Chi thưởng

1. Khi đợt ở **Đã duyệt**, C&B bấm **Chi qua kỳ lương ngoài kỳ**.
2. Hệ thống tạo một kỳ lương **Ngoài kỳ** cho mỗi pháp nhân, trong tháng **Kỳ lương chi trả**, với khoản thưởng của từng người. Người có số tiền bằng 0 không được đưa vào. Đợt thưởng chuyển sang **Đã chi** và được khóa lại.
3. Từ đây, mỗi kỳ lương ngoài kỳ đi theo đúng quy trình của trang **Chạy lương hằng tháng**: C&B **Tính lương**, **Trình bảng lương**; CEO **Ký duyệt**; C&B **Phát hành phiếu lương**; kế toán chi; C&B khóa sổ.

Thuế TNCN của khoản thưởng được tính gộp với lương tháng đó; phiếu lương ngoài kỳ ghi rõ phần thuế đã khấu trừ ở kỳ chính và ở kỳ này.

> [!WARNING]
> Nếu kỳ lương của tháng chi trả đã khóa sổ, hệ thống từ chối chi ("Kỳ lương của tháng chi đã khóa sổ"). Hãy chọn tháng chi trả chưa khóa khi tạo đợt.

## Nhật ký

Phần **Nhật ký** trên trang đợt thưởng ghi từng bước: ai tính lại, ai trình, ai duyệt hay trả lại, ghi chú kèm theo, lúc nào.
