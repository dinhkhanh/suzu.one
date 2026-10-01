# Loại phép và chính sách

Trang này dành cho nhân sự cấu hình nghỉ phép: các **loại phép** nhân viên chọn được khi xin nghỉ, và **chính sách** quyết định số ngày được cộng, chuyển năm, hết hạn của từng loại có theo dõi số dư.

Vào [Quản lý nghỉ phép → Loại phép & chính sách](/leave/admin/types).

## Loại phép chung và loại phép riêng của pháp nhân

- Loại phép **chung** (cột phải ghi **Mọi pháp nhân**) áp dụng cho mọi pháp nhân. Chỉ nhân sự được phân quyền cho **toàn tập đoàn** sửa được. Nhân sự của một pháp nhân mở loại chung sẽ thấy: "Loại phép chung: chỉ nhân sự tập đoàn sửa được. Bạn có thể đặt chính sách riêng cho pháp nhân của mình bên dưới."
- Loại phép **riêng** của một pháp nhân do nhân sự của pháp nhân đó quản lý. Nếu loại riêng có **cùng mã** với một loại chung, nhân viên của pháp nhân đó sẽ dùng loại riêng thay cho loại chung.
- Số ngày phép năm theo luật và bậc thâm niên **không** nhập ở đây: chúng lấy từ **Tham số pháp định** (menu **Quản trị → Tham số pháp định**) đang hiệu lực.

> [!NOTE]
> Khi hệ thống mới được cài, có sẵn một bộ loại phép khởi tạo (phép năm, nghỉ ốm, thai sản, nghỉ khi vợ sinh con, kết hôn, con kết hôn, tang, không lương, không lương dài hạn, nghỉ bù, nghỉ sinh nhật) kèm chính sách ghi chú "Chính sách khởi tạo — HR rà soát lại". Hãy rà soát từng loại cho đúng quy chế của công ty.

## Danh sách loại phép

Mỗi loại phép là một dòng có thể mở ra, hiện: **Mã**, tên, cách tính lương (**Công ty trả lương**, **BHXH chi trả** hoặc **Không lương**) và các nhãn **Theo dõi số dư**, **Nghỉ dài hạn**, **Ngừng dùng** nếu có, cùng pháp nhân áp dụng. Bấm vào dòng để xem và sửa.

## Thêm hoặc sửa một loại phép

Để thêm, kéo xuống khung **Thêm loại phép** cuối trang. Để sửa, mở dòng của loại phép. Các trường:

| Trường | Ý nghĩa |
|---|---|
| **Mã** | Mã ngắn, viết hoa, 2–24 ký tự (chữ, số, `_`, `-`), ví dụ `ANNUAL`. Dùng trong tệp nhập số dư và trên bảng số dư. **Không đổi được** sau khi tạo. |
| **Tên (tiếng Việt)**, **Tên (tiếng Anh)** | Tên nhân viên thấy khi xin nghỉ. |
| **Áp dụng cho** | **Mọi pháp nhân** hoặc một pháp nhân. **Không đổi được** sau khi tạo. |
| **Nhóm** | **Phép năm**, **Nghỉ ốm**, **Thai sản**, **Vợ sinh con**, **Việc riêng có lương**, **Không lương**, **Nghỉ bù**, **Riêng của công ty**. Nhóm **Nghỉ bù** là nơi hệ thống cộng ngày nghỉ bù từ giờ làm thêm. |
| **Cách tính lương** | **Công ty trả lương**, **BHXH chi trả** hoặc **Không lương** — bộ phận lương dựa vào đây khi tính lương những ngày nghỉ. |
| **Báo trước (ngày)** | Số ngày tối thiểu từ hôm nộp đến ngày nghỉ đầu tiên. 0 = không cần báo trước. |
| **Số ngày tối đa mỗi lần** | Giới hạn số ngày cho một đơn (có thể có nửa ngày). Để trống = không giới hạn. |
| **Thâm niên tối thiểu (tháng)** | Chỉ người đủ số tháng thâm niên tính đến ngày nghỉ mới xin được. |
| **Điều kiện giới tính** | **Không**, **Nữ** hoặc **Nam**. |
| **Thứ tự** | Thứ tự hiện trong danh sách chọn loại phép. |
| **Hình thức làm việc được hưởng** | Tích **Chính thức**, **Thử việc**, **Thực tập**, **Bán thời gian**, **Cộng tác viên**, **Cố vấn**. Không tích ô nào = tất cả. Người không thuộc hình thức được chọn không xin được và cũng không được cộng phép loại này. |

Các ô tích:

| Ô tích | Khi bật |
|---|---|
| **Theo dõi số dư** | Loại phép có số dư, sổ phép và (nếu có chính sách) được cộng tự động. Không bật = nghỉ bao nhiêu duyệt bấy nhiêu, không trừ số dư. |
| **Nghỉ nửa ngày** | Cho chọn **Buổi sáng** / **Buổi chiều**. |
| **Nghỉ theo giờ** | Cho chọn **Theo giờ**. |
| **Bắt buộc đính kèm** | Nhân viên phải tải lên chứng từ mới gửi được đơn. |
| **Được nộp sau** | Cho phép nộp đơn cho ngày đã qua (ví dụ nghỉ ốm đột xuất). |
| **Nghỉ dài hạn** | Khi được duyệt, kỳ nghỉ được ghi lên quá trình công tác của người đó (ví dụ thai sản, nghỉ không lương dài hạn). |
| **Tính cả Thứ Bảy làm tại nhà** | Những ngày làm việc không chấm công (như Thứ Bảy làm tại nhà) cũng bị tính là ngày nghỉ. Không bật = những ngày đó không bị trừ. |
| **Đang dùng** | Bỏ tích để ngừng dùng: loại phép không còn trong danh sách chọn khi xin nghỉ, nhưng số dư và lịch sử cũ vẫn giữ. |

Bấm **Lưu**. Lỗi "Mã này đã được dùng." nghĩa là đã có loại phép cùng mã trong cùng phạm vi.

> [!TIP]
> Loại phép không xoá được; muốn thôi dùng thì bỏ tích **Đang dùng**. Đổi tên thì an toàn: đơn và sổ phép cũ vẫn trỏ đúng loại phép.

## Chính sách của một loại phép

Loại phép có **Theo dõi số dư** có phần **Các phiên bản chính sách** khi mở ra. Mỗi phiên bản có ngày hiệu lực, pháp nhân áp dụng, cách cấp, số ngày cơ sở và quy tắc chuyển năm (ví dụ "chuyển năm 5, hết hạn 03-31"; "∞" là không giới hạn). Nếu chưa có phiên bản nào, trang ghi "Chưa có chính sách: số dư chỉ thay đổi qua các bút toán."

### Lưu một phiên bản mới

Biểu mẫu bên dưới được điền sẵn theo phiên bản đang hiệu lực. Sửa các trường rồi bấm **Lưu thành phiên bản mới**.

| Trường | Ý nghĩa |
|---|---|
| **Áp dụng cho** | **Mọi pháp nhân** hoặc một pháp nhân. Chính sách riêng của pháp nhân được ưu tiên hơn chính sách chung. Nhân sự của một pháp nhân có thể đặt chính sách riêng cho pháp nhân mình, kể cả với loại phép chung. |
| **Hiệu lực từ** | Ngày phiên bản bắt đầu áp dụng. |
| **Cách cấp ngày phép** | **Cộng dần hàng tháng**, **Cấp một lần mỗi năm**, hoặc **Không tự cấp (chỉ qua bút toán)**. |
| **Số ngày cơ sở** | **Phép năm theo luật** (lấy từ Tham số pháp định) hoặc **Số cố định**. |
| **Số ngày cố định mỗi năm** | Dùng khi chọn **Số cố định**. |
| **Ngày thêm của công ty** | Số ngày công ty cho thêm ngoài số cơ sở. |
| **Làm tròn khi không đủ năm** | **Không làm tròn**, **Đến nửa ngày** hoặc **Đến cả ngày** — áp dụng khi tính theo tỷ lệ cho người không làm đủ năm. |
| **Trong thời gian thử việc** | **Được cộng và được nghỉ**, **Được cộng, hết thử việc mới nghỉ**, hoặc **Không được cộng**. |
| **Chuyển năm tối đa (ngày)** | Số ngày tối đa được mang sang năm sau. Để trống = không giới hạn; nhập 0 = không chuyển. |
| **Ngày chuyển năm hết hạn sau (MM-DD)** | Ví dụ `03-31`: phần phép chuyển sang năm mới mà chưa dùng hết đến hết ngày đó sẽ hết hạn. Để trống = không hết hạn. |
| **Cho ứng trước (ngày)** | Cho phép nghỉ vượt số dư tối đa bấy nhiêu ngày. 0 = không cho ứng. |
| **Ghi chú** | Ghi chú nội bộ cho phiên bản. |
| **Cộng ngày theo thâm niên (theo luật)** | Cộng thêm ngày theo số năm làm việc, theo bậc trong Tham số pháp định. |
| **Tính theo tỷ lệ cho người mới vào / nghỉ việc** | Người không làm đủ năm chỉ được phần tương ứng số tháng làm việc. Không bật = ai làm trong năm cũng được cả năm. |
| **Thanh toán ngày chưa nghỉ khi nghỉ việc** | Khi hợp đồng kết thúc, số dư còn lại được ghi **Thanh toán** để bộ phận lương trả tiền. |

Cách các trường này biến thành số ngày cụ thể được giải thích ở trang **Cách tính ngày phép**.

### Phiên bản hoạt động thế nào

- Lưu với một ngày **Hiệu lực từ** mới: phiên bản đang dùng tự kết thúc vào ngày hôm trước, phiên bản mới bắt đầu từ ngày đó. Lịch sử không bị viết lại.
- Lưu với **đúng ngày hiệu lực** của phiên bản đang dùng: phiên bản đó được sửa trực tiếp (dùng để sửa nhầm).
- Không thể chen một phiên bản vào trước một phiên bản đã có ngày muộn hơn: lỗi "Đã có phiên bản sau ngày này; hãy chọn ngày hiệu lực muộn hơn."
- Thay đổi được phản ánh vào số dư ở lần cập nhật tiếp theo (tác vụ đêm, hoặc nút **Cập nhật số dư đến hôm nay**). Phần chênh lệch được ghi thành một dòng mới trong sổ phép.

> [!IMPORTANT]
> Chính sách quyết định tiền: số ngày được thanh toán khi nghỉ việc và cách tính lương ngày nghỉ đều đi vào bảng lương. Hãy thống nhất với bộ phận lương trước khi đổi **Cách tính lương** hay **Thanh toán ngày chưa nghỉ khi nghỉ việc**.
