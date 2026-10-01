# Thanh toán, báo cáo & tờ khai

Trang này dành cho **Tài chính – Kế toán**, **C&B / Tiền lương**, **Quản trị nhân sự**, **Ban điều hành** và **Kiểm toán**. Nội dung: chi lương qua ngân hàng và tiền mặt, các báo cáo lương, số liệu lập tờ khai bảo hiểm và thuế TNCN, chạy song song với bảng lương cũ, và nhập số liệu luỹ kế đầu năm.

Mọi màn hình ở đây yêu cầu xác thực lại trong 15 phút gần nhất và chỉ hiển thị pháp nhân bạn được giao.

## Chi lương

### Ai làm gì

| Việc | Ai |
|---|---|
| Lập tệp chuyển khoản, ghi nhận đã chi tiền mặt, **Lập lệnh chi**, **Xác nhận đã chi** | Tài chính – Kế toán |
| Lập / cập nhật bảng chi tiền mặt | Kế toán hoặc C&B |
| Xem tiến độ chi | Mọi người có quyền xem bảng lương của pháp nhân |
| Xác nhận đã nhận tiền mặt | Chính nhân viên nhận tiền |

### Mở màn hình Chi lương

Màn hình này chỉ có sau khi CEO đã ký duyệt kỳ lương.

1. Vào [Kỳ lương](/payroll/runs), mở kỳ lương cần chi.
2. Trong khung **Chi lương**, bấm **Chi lương**.

Đầu màn hình có ba ô: **Tổng chuyển khoản**, **Tổng chi tiền mặt** (kèm số người) và **Tình trạng** — **Đã chi xong** hoặc **Chưa chi xong**. Khi chưa xong, hệ thống liệt kê lý do, ví dụ:

- "Chưa lập tệp chuyển khoản nào."
- "Còn người hưởng lương qua ngân hàng chưa nằm trong tệp đã lập."
- "Còn người trong bảng tiền mặt chưa ghi nhận đã chi."

Người hồ sơ **Đầy đủ** nhận lương chuyển khoản; người hồ sơ **Đơn giản** nhận tiền mặt.

### Lập tệp chuyển khoản

Mỗi ngân hàng một tệp, theo mẫu nộp lô của ngân hàng đó. Hiện hệ thống hỗ trợ mẫu của **Vietcombank** và **ACB**.

1. Trong khung **Tệp chuyển khoản**, chọn **Ngân hàng** (kèm số người hưởng lương qua ngân hàng đó).
2. Chọn **Ngày chi**.
3. Nhập **Tài khoản công ty** và **Tên tài khoản công ty** dùng để chi.
4. Bấm **Lập tệp**. Tệp được tải về máy ngay; hệ thống báo "Đã lập … (… dòng)". Bấm **Tải lại** nếu cần tải lần nữa.
5. Đăng tệp lên cổng ngân hàng doanh nghiệp như thường lệ.

Bảng **Các tệp đã lập** ghi lại **Tên tệp**, **Phiên bản mẫu**, **Số dòng**, **Tổng tiền**, **Lập lúc**. Hệ thống không lưu nội dung tệp — chỉ lưu thông tin để đối chiếu.

> [!WARNING]
> Mẫu tệp VCB và ACB được dựng theo hiểu biết tốt nhất và **chưa đối chiếu** với mẫu hiện hành của ngân hàng. Trước kỳ chi lương thật đầu tiên, kế toán trưởng hãy tải mẫu mới nhất trên cổng ngân hàng và kiểm tra tệp do hệ thống lập.

### Người chưa thể chuyển khoản

Hệ thống không bao giờ lặng lẽ bỏ ai. Người không đưa được vào tệp được liệt kê trong khung **Những người chưa thể chuyển khoản** (và "Không đưa vào tệp:" sau khi lập), kèm lý do:

- chưa có số tài khoản / số tài khoản không hợp lệ / số tài khoản quá ngắn
- chưa có tên chủ tài khoản
- thực nhận bằng 0 hoặc thực nhận âm
- hệ thống chưa hỗ trợ mẫu tệp của ngân hàng này

Hãy nhờ nhân viên cập nhật tài khoản ngân hàng (qua yêu cầu thay đổi thông tin) hoặc chi cho họ theo cách khác rồi xử lý trước khi xác nhận đã chi.

### Bảng chi tiền mặt

Dành cho người thuộc hồ sơ chi lương giản lược.

1. Trong khung **Bảng chi tiền mặt**, bấm **Lập bảng chi**. Mỗi người nhận tiền mặt nhận thông báo **Xác nhận đã nhận lương tiền mặt**. Nếu kỳ lương có thay đổi, bấm **Cập nhật bảng chi** để thêm người còn thiếu.
2. Bấm **In bảng chi (PDF)** để in **BẢNG THANH TOÁN LƯƠNG BẰNG TIỀN MẶT** với các cột **STT**, **Mã NV**, **Họ và tên**, **Số tiền**, **Ký nhận**, **Ngày**.
3. Chi tiền và lấy chữ ký từng người.
4. Với mỗi người đã nhận, chọn **Ngày chi** rồi bấm **Ghi nhận đã chi**.
5. Cột **Xác nhận** cho biết nhân viên đã bấm **Tôi đã nhận đủ** trong ứng dụng (**Đã xác nhận**) hay chưa (**Chờ xác nhận**).

> [!NOTE]
> Xác nhận của nhân viên là bằng chứng bổ sung. Kỳ lương vẫn chuyển được sang **Đã chi** khi kế toán đã ghi nhận chi đủ cho mọi người.

### Hoàn tất

Khi **Tình trạng** là **Đã chi xong**, quay lại trang kỳ lương và bấm **Xác nhận đã chi**. Sau đó C&B **Khóa sổ kỳ lương** (xem trang **Chạy lương hằng tháng**).

## Báo cáo lương

Vào [Báo cáo lương](/payroll/reports). Chọn **Pháp nhân** và **Kỳ lương** ở đầu trang. Số liệu lấy từ các bảng lương đã tính (không tính lại), bỏ qua kỳ nháp và kỳ đã hủy.

| Báo cáo | Nội dung | Ai xem |
|---|---|---|
| **Bảng lương chi tiết** | Từng người: **Phòng ban**, **Tổng thu nhập**, **Bảo hiểm (NLĐ)**, **Thuế TNCN**, **Thực nhận**, **Tổng chi phí**; dòng **Tổng cộng** | C&B, Chủ sở hữu |
| **Đối chiếu bảo hiểm bắt buộc** | Phần người lao động, phần công ty và tổng; số người không phát sinh đóng | C&B, Chủ sở hữu |
| **Tổng hợp thuế TNCN đã khấu trừ** | Thu nhập chịu thuế, thuế đã khấu trừ; số người chưa có mã số thuế | C&B, Chủ sở hữu |
| **Chi phí nhân sự theo phòng ban** | **Số người**, **Tổng thu nhập**, **Công ty đóng BH**, **Tổng chi phí** theo phòng ban | Mọi người có quyền xem bảng lương |
| **Báo cáo công đoàn** | Số đoàn viên, đoàn phí, kinh phí công đoàn | Mọi người có quyền xem bảng lương |
| **Chi phí nhân sự theo tháng** | Xu hướng 24 tháng gần nhất: số người, tổng thu nhập, thực nhận, tổng chi phí | Mọi người có quyền xem bảng lương |

Như vậy CEO, kế toán và kiểm toán thấy các báo cáo tổng hợp theo phòng ban và theo tháng, nhưng không thấy báo cáo nêu tên từng người.

Bấm **Xuất CSV** cạnh mỗi báo cáo để tải về (bảng lương chi tiết, bảo hiểm, thuế, chi phí, công đoàn). Việc xuất được ghi nhật ký.

## Dữ liệu khai báo

Vào [Dữ liệu khai báo](/payroll/statutory) (dành cho C&B). Trang tổng hợp số liệu để lập tờ khai bảo hiểm và thuế TNCN, lấy từ các bảng lương đã tính. Chọn **Pháp nhân**, **Tháng** và **Năm**.

| Phần | Nội dung | Tải về |
|---|---|---|
| **Tăng / giảm lao động tham gia bảo hiểm (D02-LT)** | Từng thay đổi trong tháng: **Phương án** (**Tăng mới**, **Điều chỉnh tăng mức đóng**, **Điều chỉnh giảm mức đóng**, **Giảm do nghỉ việc**, **Giảm do nghỉ không lương**, **Giảm do nghỉ ốm đau/thai sản**, **Giảm khác**), **Mức đóng cũ**, **Mức đóng mới** | **Tải CSV** |
| **Tờ khai khấu trừ thuế TNCN (05/KK-TNCN)** | Số cá nhân và tổng thuế đã khấu trừ trong tháng | **Chỉ tiêu tháng**, **Bảng kê chi tiết**, **Chỉ tiêu quý** |
| **Quyết toán thuế TNCN năm (05/QTT-TNCN)** | Từng người: **Thu nhập chịu thuế**, **Đã khấu trừ**, **Phải nộp (tính lại)**; đánh dấu **(có số liệu nhập)** cho người có số liệu luỹ kế nhập từ ngoài | **Chỉ tiêu quyết toán**, **Phụ lục 05-1/BK**, **Phụ lục 05-2/BK** |
| **Danh sách người phụ thuộc (07/ĐK-NPT-TNCN)** | Người phụ thuộc đang được tính giảm trừ | **Tải CSV** |

> [!CAUTION]
> Bố cục cột trong các tệp này là **giả định**, chưa đối chiếu với biểu mẫu chính thức của HTKK và cổng BHXH. Số liệu lấy đúng từ bảng lương đã duyệt, nhưng kế toán trưởng cần kiểm tra thứ tự và tên cột trước khi nộp.

## Chạy song song với bảng lương cũ

Khi công ty mới chuyển sang tính lương bằng SuZu One, hãy chạy song song vài tháng: vẫn tính lương theo cách cũ (bảng tính), đồng thời tính trên hệ thống, rồi đối chiếu từng người. Mỗi chênh lệch phải được giải thích trước khi chuyển sang dùng chính thức.

1. Vào [Chạy song song](/payroll/parallel). Chọn **Pháp nhân** và **Tháng** (hoặc chọn trong **Tháng khác**).
2. Đưa số liệu bảng lương cũ vào:
   - **Nhập số liệu bảng lương cũ**: bấm **Nhập file đối chiếu**, **Tải file mẫu**, điền mã nhân viên và các cột tổng thu nhập, bảo hiểm, đoàn phí, thuế, khấu trừ khác, thực nhận; chọn file (.xlsx hoặc .csv), bấm **Kiểm tra file**, sửa lỗi nếu có, rồi bấm ghi vào hệ thống. Nhập lại sẽ thay thế số cũ của tháng.
   - **Nhập tay một người**: dùng khi chỉ cần sửa vài người.
3. Màn hình tóm tắt: số người, số **khớp**, số **lệch**, số **thiếu ở hệ thống**, số **thiếu ở bảng cũ**.
4. Mỗi người có chênh lệch hiện các trường lệch (**Tổng thu nhập**, **Bảo hiểm (NLĐ)**, **Đoàn phí**, **Thuế TNCN**, **Khấu trừ khác**, **Thực nhận**) dạng hệ thống / bảng cũ, nhãn **Chưa giải thích**.
5. Bấm **Giải thích**, chọn **Nguyên nhân** — **Lỗi hệ thống**, **Sai ở bảng tính cũ**, **Thiếu quy tắc**, **Chênh lệch làm tròn, chấp nhận** — và ghi **Diễn giải**, bấm **Lưu**.
6. Khi mọi chênh lệch đã giải thích, trang báo "Tháng …: … người, không còn chênh lệch nào chưa giải thích."

> [!TIP]
> Nếu bạn tính lại bảng lương sau khi đã giải thích, một số giải thích có thể hiện nhãn **Giải thích cũ không còn khớp số hiện tại**. Hãy bấm **Sửa giải thích** để cập nhật.

## Số liệu luỹ kế đầu năm

Nếu công ty bắt đầu dùng SuZu One giữa năm, những tháng trước đó không có bảng lương trong hệ thống. Để quyết toán thuế TNCN đủ cả năm, C&B nhập số liệu luỹ kế của những tháng đó.

1. Vào [Số liệu luỹ kế](/payroll/ytd). Chọn **Pháp nhân** và năm.
2. Bấm **Nhập số liệu luỹ kế**, **Tải file mẫu**, điền mỗi nhân viên một dòng. Bắt buộc: Mã nhân viên, Số tháng, Thu nhập chịu thuế, Thuế đã khấu trừ. Không bắt buộc: Bảo hiểm được trừ, Giảm trừ bản thân, Giảm trừ người phụ thuộc, Giảm trừ khác, Thu nhập tính thuế, Ghi chú. Số tiền ghi bằng số nguyên VND.
3. Chọn file, **Kiểm tra file**, sửa lỗi rồi ghi vào hệ thống. Nhập lại sẽ thay thế dòng cũ của người đó.
4. Bảng trên trang liệt kê **Nhân viên**, **Số tháng**, **Thu nhập chịu thuế**, **Bảo hiểm được trừ**, **Thuế đã khấu trừ**.

Số liệu này được cộng vào phần **Quyết toán thuế TNCN năm** trong **Dữ liệu khai báo**.
