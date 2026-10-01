# Nhóm tài sản, nhập từ tệp & nhãn QR

Trang này dành cho người **Quản lý tài sản**: thiết lập danh mục nhóm tài sản, chuyển sổ tài sản từ bảng tính sang SuZu One, và in nhãn QR dán lên thiết bị.

## Nhóm tài sản

Nhóm tài sản dùng chung cho cả tập đoàn: một chiếc laptop là laptop ở mọi pháp nhân. Vì vậy chỉ người có quyền quản lý tài sản **trên toàn tập đoàn** mới sửa được danh mục này; người chỉ quản lý một pháp nhân dùng danh mục có sẵn.

Mở [Tài sản](/assets) → **Nhóm tài sản**. Mỗi nhóm là một khung có thể sửa trực tiếp:

| Trường | Ý nghĩa |
| --- | --- |
| **Mã nhóm** | Chữ in hoa không dấu, số hoặc gạch ngang, 2–12 ký tự, ví dụ `LAP`. Là một phần của mã tài sản (`SZM-LAP-0007`) |
| **Tên nhóm** | Tên hiển thị |
| **Loại** | **Thiết bị CNTT**, **Thiết bị sản xuất**, **Nội thất**, **Phương tiện**, **Điện thoại / SIM**, **Khác** |
| **Bảo hành mặc định (tháng)** | Thời hạn bảo hành thường gặp của nhóm |
| **Thứ tự** | Thứ tự hiển thị |
| **Bắt buộc số sê-ri** | Tài sản thuộc nhóm phải có số sê-ri |
| **Cho phép đặt lịch mượn** | Tài sản thuộc nhóm xuất hiện trên **Lịch đặt thiết bị**, ai cũng đặt mượn được |
| **Đang dùng** | Bỏ tích để ngừng dùng nhóm mà không xóa |

Bấm **Lưu** trên từng khung. Để thêm nhóm, điền khung **Thêm nhóm mới** ở cuối trang.

Khi hệ thống được cài đặt, có sẵn các nhóm như máy tính xách tay (`LAP`), máy tính để bàn, màn hình, điện thoại, SIM / thuê bao, máy quay / máy ảnh (`CAM`), ống kính, thiết bị ánh sáng, âm thanh, chân máy, thẻ nhớ / ổ cứng, flycam, nội thất, phương tiện và khác. Các nhóm thiết bị sản xuất và phương tiện được bật sẵn **Cho phép đặt lịch mượn**.

> [!WARNING]
> Bật **Cho phép đặt lịch mượn** cho một nhóm nghĩa là **mọi nhân viên** đều xem được thông tin các tài sản trong nhóm (trừ giá) và đặt mượn được. Đừng bật cho thiết bị cấp riêng cho từng người như laptop.

## Nhập sổ tài sản từ tệp

Dùng khi bạn đang có sổ tài sản trên Excel hoặc Google Sheets và muốn chuyển vào SuZu One một lần.

Mở [Tài sản](/assets) → **Nhập từ tệp** ([Nhập tài sản từ tệp](/assets/import)).

### Quy tắc

- **Chỉ thêm mới**: mã tài sản đã có trong hệ thống sẽ báo lỗi chứ không ghi đè. Muốn sửa tài sản đã có, hãy sửa trên trang của tài sản đó.
- Để trống cột **Mã tài sản** thì hệ thống tự đánh số tiếp theo pháp nhân và nhóm. Nếu điền mã, các mã tự cấp sau này sẽ đánh số tiếp từ mã lớn nhất bạn đã nhập.
- Cột **Người giữ** nhận **mã nhân viên** hoặc **email công việc**; hệ thống sẽ mở luôn lượt giao, và người đó vẫn phải tự xác nhận đã nhận.
- Nhóm có bật **Bắt buộc số sê-ri** thì dòng thiếu sê-ri sẽ báo lỗi. Số sê-ri trùng với tài sản đã có hoặc trùng giữa hai dòng cũng báo lỗi.
- Bạn chỉ nhập được tài sản cho pháp nhân mình quản lý.

### Các cột của tệp

| Cột | Bắt buộc | Ghi chú |
| --- | --- | --- |
| Mã tài sản | Không | Để trống để tự cấp |
| Tên tài sản | Có | |
| Nhóm (mã) | Có | Mã nhóm, ví dụ `LAP` |
| Pháp nhân (mã) | Có | Mã pháp nhân |
| Hãng, Model, Số sê-ri | Không | |
| Ngày mua, Bảo hành đến | Không | Định dạng dd/mm/yyyy |
| Nguyên giá | Không | Số nguyên đồng |
| Nhà cung cấp | Không | |
| Tình trạng | Không | Mới, Tốt, Bình thường, Kém, Hỏng |
| Vị trí | Không | Ví dụ "Kho tầng 3" |
| Người giữ (mã NV hoặc email) | Không | Mở lượt giao cho người này |
| Ghi chú | Không | |

Tên cột tiếng Anh cũng được nhận.

### Các bước

1. Bấm **Tải file mẫu** để lấy tệp mẫu đúng cột.
2. Điền dữ liệu vào tệp mẫu (hoặc đổi tên cột trong bảng tính của bạn cho khớp).
3. Bấm **Chọn file .xlsx hoặc .csv** và chọn tệp.
4. Bấm **Kiểm tra file**. Hệ thống đọc toàn bộ tệp và báo số dòng, số lỗi, và từng lỗi theo **Dòng …** — ví dụ thiếu cột bắt buộc, ngày không hợp lệ, mã nhóm không tồn tại, mã đã có trong hệ thống.
5. Nếu có lỗi: sửa trong tệp rồi kiểm tra lại. **Chưa có gì được ghi vào hệ thống** cho tới khi tệp sạch lỗi.
6. Khi không còn lỗi, bấm **Ghi … dòng vào hệ thống**.

Mỗi tài sản nhập vào được ghi sự kiện **Nhập từ tệp** trong lịch sử, có mã QR riêng và (nếu có người giữ) một lượt giao đang chờ xác nhận.

> [!TIP]
> Sau khi nhập xong, nhắc những người được ghi là **Người giữ** vào **Thiết bị của tôi** để xác nhận. Trang của từng tài sản ghi **Chưa xác nhận nhận** cho đến khi người giữ xác nhận.

## Nhãn QR

Mỗi tài sản có một mã QR riêng, hiện ở góc trang tài sản. Dán nhãn QR lên thiết bị giúp ai cũng mở được hồ sơ của nó bằng camera điện thoại.

### In nhãn

1. Mở [Tài sản](/assets) → **In nhãn QR**.
2. Hệ thống tạo một tệp PDF gồm nhãn của mọi tài sản trong sổ mà bạn quản lý. Mỗi nhãn có mã tài sản, tên, pháp nhân, mã QR và dòng **Quét mã để mở hồ sơ tài sản**.
3. In trên giấy decal và dán lên thiết bị.

### Quét nhãn

Quét mã QR bằng điện thoại sẽ mở trang của tài sản trong SuZu One:

- Người chưa đăng nhập được đưa tới trang đăng nhập trước.
- Mã QR chỉ **xác định** tài sản, không **mở quyền**: người quét chỉ thấy trang nếu họ được phép xem tài sản đó (người quản lý tài sản, người đang giữ, hoặc mọi nhân viên với thiết bị cho đặt lịch). Những người khác nhận trang "không tìm thấy".

> [!TIP]
> Khi kiểm kê, chỉ cần đi một vòng quét nhãn: trang tài sản cho thấy ngay ai đang giữ và tình trạng ghi trên sổ, để bạn so với thực tế.
