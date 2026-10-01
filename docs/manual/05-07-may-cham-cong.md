# Máy chấm công

Trang này dành cho **nhân sự phụ trách chấm công**. Nếu văn phòng dùng máy chấm công vân tay / thẻ, SuZu One đọc tệp xuất thô của máy, gán mã người dùng trên máy cho từng nhân sự, và đưa các lượt chấm vào bảng công cùng với lượt chấm trên ứng dụng.

Mở **Chấm công** → **Thiết lập chấm công** → thẻ **Máy chấm công** ([mở](/attendance/devices)). Màn hình có ba thẻ: **Máy**, **Nhập nhật ký**, **Hồ sơ ánh xạ**.

## Tổng quan quy trình

1. **Hồ sơ ánh xạ**: mô tả tệp xuất của từng dòng máy (cột nào là mã người dùng, ngày giờ, vào / ra). Làm một lần cho mỗi dòng máy.
2. **Máy**: khai báo từng máy, chọn hồ sơ ánh xạ và nơi đặt máy.
3. **Gán mã**: cho mỗi mã người dùng trên máy biết đó là ai.
4. **Nhập nhật ký**: định kỳ tải tệp xuất của máy lên; hệ thống kiểm tra, cho xem trước, rồi ghi lượt chấm và tính lại ngày công.

## Hồ sơ ánh xạ

Thẻ **Hồ sơ ánh xạ** liệt kê các hồ sơ đang có (tên, loại tệp, phạm vi, định dạng thời điểm). Hồ sơ có thể tìm cột theo tiêu đề, hoặc theo vị trí khi tệp không có dòng tiêu đề (ví dụ tệp `attlog.dat` của máy ZKTeco).

**Thêm hồ sơ:**

1. Mở khung **Thêm hồ sơ**.
2. Nhập **Tên**, **Dòng máy**, chọn **Loại tệp**: **CSV**, **Excel** hoặc **DAT / văn bản**; chọn **Áp dụng cho**.
3. Đánh dấu **Dòng đầu là tên cột** nếu tệp có dòng tiêu đề.
4. Với mỗi cột, nhập tiêu đề hoặc **Vị trí** (tính từ 1):
   - **Cột mã người dùng** (bắt buộc)
   - **Cột ngày giờ** (bắt buộc)
   - **Cột giờ riêng (nếu có)** — khi ngày và giờ nằm ở hai cột
   - **Cột vào/ra (nếu có)**
5. **Định dạng thời điểm (YYYY MM DD HH mm ss)**: ví dụ `YYYY-MM-DD HH:mm:ss` hoặc `DD/MM/YYYY HH:mm`. Phải có đủ YYYY, MM, DD, HH và mm.
6. **Mã vào/ra, ví dụ 0=in, 1=out**: cách máy ghi hướng chấm.
7. Nếu máy không ghi vào / ra, đánh dấu **Không có mã thì các lượt trong ngày lần lượt là vào, ra, vào…**.
8. Bấm **Lưu**.

> [!NOTE]
> Hồ sơ **Mọi pháp nhân** dùng chung cho cả tập đoàn; chỉ nhân sự cấp tập đoàn được sửa ("Dùng chung cho mọi pháp nhân; chỉ nhân sự tập đoàn được sửa.").

## Khai báo máy

Thẻ **Máy** liệt kê từng máy: tên, pháp nhân, hồ sơ ánh xạ, số mã đã gán, nhãn đỏ "… mã chưa gán người" (nếu có), và thời điểm lượt chấm gần nhất.

**Thêm máy:**

1. Mở khung **Thêm máy**.
2. Nhập **Tên**, chọn **Pháp nhân**, **Hồ sơ ánh xạ** (hồ sơ của pháp nhân đó hoặc hồ sơ dùng chung).
3. (Không bắt buộc) **Dòng máy**, **Số sê-ri**, **Đặt tại** (một địa điểm làm việc của pháp nhân).
4. Bấm **Lưu**.

Bấm **Sửa** dưới một máy để thay đổi; bỏ dấu **Đang dùng** khi máy ngừng hoạt động (máy ngừng dùng không còn trong danh sách nhập nhật ký). Tên máy không được trùng trong cùng pháp nhân.

## Gán mã người dùng trên máy

Mỗi người có một mã trên máy (số thứ tự khi đăng ký vân tay / thẻ). Bấm tên máy để mở trang gán mã.

**Gán từng mã:**

1. Ở cuối danh sách **… mã đã gán**, nhập **Mã trên máy**, chọn **Nhân sự** (danh sách gồm người đang làm việc của pháp nhân, kèm mã nhân viên).
2. Bấm **Gán**.

**Gán nhiều mã cùng lúc** — khung **Gán nhiều mã theo mã nhân viên**:

1. Mỗi dòng nhập: mã trên máy, mã nhân viên, phân cách bằng dấu phẩy, chấm phẩy hoặc tab (ví dụ `105, NV0023`). Có thể dán thẳng hai cột từ Excel.
2. Bấm **Gán tất cả**. Hệ thống chỉ lưu khi mọi dòng đều đúng; nếu có lỗi, không dòng nào được lưu và bạn thấy danh sách "Dòng …: …" cần sửa (sai định dạng, không có mã nhân viên này trong pháp nhân, mã xuất hiện hai lần…).

**Gỡ mã**: bấm **Gỡ** cạnh một dòng. Các lượt chấm đã nhập từ mã đó vẫn giữ nguyên.

### Mã chưa gán cho ai

Khi tệp nhật ký có mã chưa gán, khung đỏ "**… mã chưa gán cho ai**" hiện đầu trang máy: mỗi mã kèm số dòng và khoảng thời gian. Các dòng nhật ký được giữ lại — gán mã là chúng thành lượt chấm ngay. Chọn người trong ô "Mã … là ai?" rồi bấm **Gán**. Bấm **Tải các dòng (CSV)** để xem các dòng đó (tệp chỉ chứa 5.000 dòng đầu).

Mã chưa gán cũng hiện trên **Bảng bất thường chấm công** với loại **Mã máy chưa gán** và liên kết **Gán mã**.

## Nhập nhật ký máy chấm công

Thẻ **Nhập nhật ký** ([mở](/attendance/devices/import)):

1. Xuất tệp nhật ký từ máy (USB hoặc phần mềm của máy).
2. Trong khung **Nhập nhật ký máy chấm công**, chọn **Máy**. Loại tệp được nhận theo hồ sơ ánh xạ của máy (CSV, Excel, hoặc `.dat` / `.txt` / `.log`).
3. Chọn tệp, bấm **Kiểm tra file**.
4. Xem kết quả kiểm tra: số dòng, số lỗi, các dòng xem trước và lỗi theo từng dòng, ví dụ:
   - "Thời điểm không đúng định dạng của hồ sơ ánh xạ" — kiểm tra lại hồ sơ.
   - "Thời điểm ở tương lai — sai đồng hồ máy hay sai tệp?" — kiểm tra đồng hồ của máy.
   - "Chưa gán mã này cho ai; các dòng được giữ lại và thành lượt chấm khi gán mã" — chỉ là lưu ý, không chặn việc nhập.
5. Nếu có lỗi chặn, sửa tệp hoặc hồ sơ rồi kiểm tra lại — chưa có gì được ghi vào hệ thống.
6. Nếu ổn, bấm **Ghi … dòng vào hệ thống**. Kết quả hiện số **lượt chấm mới**, số **dòng đã nhập trước đó hoặc lặp lại**, số **dòng chờ gán mã**.

Những điều cần biết:

- **Nhập lại không sợ trùng**: nhập lại tệp trùng khoảng thời gian chỉ thêm những dòng mới. Bạn có thể nhập tệp cả tháng nhiều lần.
- **Mã chưa gán không chặn việc nhập**: dòng của mã chưa gán chờ đến khi mã được gán.
- **Tính lại ngay**: các ngày công liên quan được tính lại sau khi ghi; tháng đã khoá giữ nguyên.
- Lượt chấm từ máy và từ ứng dụng được gộp theo quy tắc **Khi cả hai nguồn đều có lượt chấm** trong thẻ **Quy định**.

Phần **Các lần nhập gần đây** liệt kê từng lần nhập: thời điểm, tên tệp, máy, trạng thái (**Có lỗi**, **Đã kiểm tra, chưa ghi**, **Đã ghi**), kết quả "… mới · … bỏ qua · … chờ gán" và người nhập.

> [!TIP]
> Nhập nhật ký đều đặn (ví dụ hằng tuần) để nhân viên và quản lý thấy bảng công đúng sớm, thay vì dồn vào cuối tháng. Trước khi khoá công, nhớ nhập đến hết ngày cuối tháng.

## Lỗi thường gặp

| Thông báo | Cách xử lý |
| --- | --- |
| Cho biết cột nào là mã người dùng. / Cho biết cột nào là ngày giờ. | Điền tiêu đề hoặc vị trí cột trong hồ sơ ánh xạ |
| Định dạng thời điểm cần có YYYY, MM, DD, HH và mm. | Sửa **Định dạng thời điểm** |
| Đã có hồ sơ trùng tên. | Đặt tên khác |
| Chọn hồ sơ ánh xạ mà pháp nhân này được dùng. | Chọn hồ sơ của pháp nhân máy hoặc hồ sơ dùng chung |
| Địa điểm thuộc pháp nhân khác. | Chọn địa điểm cùng pháp nhân với máy |
| Mã này đã được gán trên máy này. | Gỡ mã cũ trước nếu muốn gán cho người khác |
| Hãy thêm máy trước: | Khai báo máy ở thẻ **Máy** rồi quay lại nhập |
