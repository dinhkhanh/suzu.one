# Quản lý số dư phép

Trang này dành cho nhân sự (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự** hoặc người được giao quyền quản lý nghỉ phép). Bạn chỉ thấy và thao tác được với những người nằm trong phạm vi được giao (pháp nhân, đơn vị).

Mở từ trang [Nghỉ phép](/leave) → liên kết **Quản lý nghỉ phép**, hoặc vào thẳng [Số dư](/leave/admin/balances). Khu vực này có bốn thẻ: **Số dư**, **Loại phép & chính sách**, **Quân số tối thiểu**, **Số dư đầu kỳ**.

## Thẻ Số dư: bảng số dư của mọi người

1. Chọn năm bằng các nút năm trước / năm nay / năm sau ở đầu trang.
2. Bảng liệt kê những người đang làm việc hoặc đang tạm hoãn trong phạm vi của bạn, theo tên:
   - **Nhân viên** và **Pháp nhân · phòng ban**.
   - Mỗi cột là một loại phép có theo dõi số dư (theo mã, ví dụ `ANNUAL`, `COMP`).
   - Mỗi ô là **số dư** tính đến hôm nay; số trong ngoặc (ví dụ "(−1,5)") là số ngày các đơn chờ duyệt đang giữ. Dấu "—" nghĩa là người đó không có loại phép này.
3. Bấm vào tên một người để mở **sổ phép** chi tiết của họ.

### Cập nhật số dư đến hôm nay

Mỗi đêm hệ thống tự cộng phép, chốt năm, cho hết hạn và thanh toán phép (xem **Cách tính ngày phép**). Nếu cần thấy kết quả ngay — sau khi nhập số dư đầu kỳ hoặc vừa đổi chính sách — bấm **Cập nhật số dư đến hôm nay**.

> [!NOTE]
> Nút này chỉ hiện với nhân sự được phân quyền cho **toàn tập đoàn**, vì nó cập nhật số dư của mọi người. Chạy nhiều lần cũng không cộng trùng.

## Sổ phép của một người

Trang sổ phép hiện tên, mã nhân viên và năm đang xem, gồm:

- **Thẻ số dư** cho từng loại phép: số dư, **đã nghỉ …**, **… đang chờ duyệt**.
- Nút **Nộp đơn thay người này**.
- Khung **Ghi điều chỉnh**.
- **Sổ phép** — mọi dòng phát sinh trong năm, mới nhất trước: ngày hiệu lực, mã loại phép, loại phát sinh, số ngày (+/−), lý do, và người ghi (hoặc **Hệ thống** nếu do tác vụ tự động).
- **Các đơn nghỉ** — 20 đơn gần nhất của người đó kèm trạng thái; bấm tên loại phép để mở đơn.

Các loại phát sinh trong sổ:

| Nhãn | Nghĩa là |
|---|---|
| **Đầu kỳ** | Số dư đầu kỳ được nhập từ tệp. |
| **Cộng hàng tháng** | Phần phép cộng dần mỗi tháng. Cột lý do ghi rõ cách tính (số ngày cơ sở, thâm niên, số tháng được tính…). |
| **Cấp phép** | Phép cấp một lần trong năm, hoặc ngày nghỉ bù từ giờ làm thêm. |
| **Đã nghỉ** | Trừ khi một đơn nghỉ được duyệt. |
| **Hoàn lại** | Cộng lại khi một đơn đã duyệt bị huỷ hoặc được sửa. |
| **Điều chỉnh** | Bút toán tay của nhân sự, có lý do. |
| **Chuyển năm** | Số dư cuối năm chuyển sang năm sau (một dòng trừ ở năm cũ, một dòng cộng ở năm mới). |
| **Hết hạn** | Phần vượt mức chuyển năm, hoặc phần phép chuyển năm không dùng kịp trước hạn. |
| **Thanh toán** | Số ngày chưa nghỉ được trả tiền khi nghỉ việc; bộ phận lương dùng dòng này khi tính lương kỳ cuối. |

Số dư luôn bằng tổng các dòng trong sổ, nên mọi con số đều truy được nguồn gốc.

## Ghi điều chỉnh số dư

Dùng khi cần sửa số dư mà không qua đơn nghỉ: cộng ngày thưởng, sửa số đầu kỳ nhập sai, trừ ngày nghỉ không có đơn…

1. Mở sổ phép của người đó, chọn đúng năm ở trang **Số dư** trước khi bấm vào tên.
2. Trong khung **Ghi điều chỉnh**: chọn **Loại phép**, nhập **Số ngày (+ / −)** (ví dụ `1,5` để cộng, `-2` để trừ), nhập **Lý do** (ít nhất 3 ký tự).
3. Bấm **Ghi sổ**.

Dòng mới hiện ngay trong sổ với nhãn **Điều chỉnh**, tên bạn và lý do. Mọi điều chỉnh đều được ghi nhật ký hệ thống kèm số dư trước và sau.

> [!CAUTION]
> Sổ phép không sửa hay xoá được dòng cũ. Ghi sai thì ghi thêm một dòng điều chỉnh ngược lại. Chỉ loại phép có **theo dõi số dư** mới điều chỉnh được.

## Nộp đơn thay nhân viên

Khi nhân viên không tự nộp được (ốm đột xuất, nghỉ thai sản, quên nộp), bạn nộp thay:

1. Mở sổ phép của người đó và bấm **Nộp đơn thay người này**.
2. Trang xin nghỉ hiện dòng "Bạn đang nộp đơn thay người khác; không áp dụng thời hạn báo trước." Bạn được nộp cho ngày đã qua và không bị giới hạn số ngày báo trước. Các điều kiện khác (số dư, trùng đơn, hình thức làm việc…) vẫn được kiểm tra.
3. Làm tiếp như một đơn bình thường: **Kiểm tra**, thêm lý do / tệp, **Gửi đơn**. Khi nộp thay, mục **Cũng nghỉ trong những ngày này** hiện cả đồng nghiệp có đơn đang chờ duyệt.

Đơn vẫn đi qua luồng phê duyệt như khi nhân viên tự nộp; trang đơn ghi "… nộp thay". Bạn không thể duyệt đơn do chính mình nộp.

## Huỷ hoặc sửa đơn của nhân viên

Từ danh sách **Các đơn nghỉ** trong sổ phép, mở đơn rồi:

- **Huỷ nghỉ** một đơn đã duyệt — được cả khi kỳ nghỉ đã bắt đầu. Nhập **Lý do (không bắt buộc)**. Số ngày được hoàn lại; nhân viên nhận thông báo.
- **Rút đơn** một đơn đang chờ duyệt — đơn chuyển sang **Đã huỷ**.
- **Sửa** — thay đơn bằng một đơn mới, đơn mới đi duyệt lại.

> [!WARNING]
> Kỳ nghỉ có ngày nằm trong tháng đã **khoá bảng công** thì không huỷ được. Hãy ghi điều chỉnh bảng công cho tháng đó ở phần Chấm công (xem chương **Chấm công**).

## Thẻ Số dư đầu kỳ: nhập số dư khi bắt đầu dùng hệ thống

Số dư đầu kỳ là số ngày phép mỗi người **còn lại** vào ngày bắt đầu theo dõi trên SuZu One, thường lấy từ bảng tính cũ.

1. Vào [Số dư đầu kỳ](/leave/admin/import).
2. Bấm **Tải file mẫu** để lấy tệp mẫu. Các cột:

| Cột | Bắt buộc | Ghi chú |
|---|---|---|
| Mã nhân viên | Có | Mã nhân viên trong hồ sơ. |
| Loại phép (mã) | Có | Mã loại phép, ví dụ `ANNUAL`. Phải là loại có theo dõi số dư. |
| Năm | Có | Năm phép của số dư. |
| Số ngày còn lại | Có | Ví dụ `7` hoặc `7,5`. Có thể âm nếu đã nghỉ ứng trước. |
| Tính đến ngày | Không | Ngày chốt số dư, phải nằm trong năm đã ghi. Để trống = 01/01 của năm đó. |
| Ghi chú | Không | Hiện làm lý do trong sổ phép. |

3. Chọn tệp (.xlsx hoặc .csv) và bấm **Kiểm tra file**. Hệ thống báo số dòng và các lỗi theo từng dòng; chưa có gì được ghi.
4. Nếu có lỗi, sửa trong tệp rồi kiểm tra lại. Nếu không có lỗi, bấm **Ghi … dòng vào hệ thống**.
5. Sau khi ghi, hệ thống hiện tổng số ngày của tệp để bạn đối chiếu với bảng tính.
6. Vào thẻ **Số dư** và bấm **Cập nhật số dư đến hôm nay** (hoặc chờ tác vụ đêm) để hệ thống cộng tiếp phần phép từ sau ngày chốt.

Lưu ý quan trọng:

- **Tính đến ngày** quyết định từ đâu hệ thống bắt đầu cộng: các tháng bắt đầu trước ngày đó được coi là đã nằm trong số dư đầu kỳ và không được cộng lại.
- Mỗi người, mỗi loại phép, mỗi năm chỉ có **một** số dư đầu kỳ. Nhập lại sẽ báo lỗi "Người này đã có số dư đầu kỳ cho loại phép và năm này" — sửa bằng bút toán điều chỉnh.
- Nhân viên ngoài phạm vi của bạn được báo như không tồn tại ("Không có nhân viên mang mã này trong phạm vi của bạn").

Các lỗi thường gặp khi kiểm tra tệp: "Số ngày không hợp lệ (ví dụ 7 hoặc 7,5)", "Năm không hợp lệ", "Không có loại phép mang mã này", "Loại phép này không theo dõi số dư", "Ngày phải nằm trong năm đã ghi", "Trùng với một dòng khác trong file".
