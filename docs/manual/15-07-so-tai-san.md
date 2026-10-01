# Quản lý sổ tài sản

Sổ tài sản cho biết công ty có những gì, mỗi món đang ở đâu, ai đang giữ và tình trạng ra sao. Trang này dành cho người giữ vai trò **Quản lý tài sản** (và chủ sở hữu). Quyền này được giao theo pháp nhân: bạn chỉ thấy và quản lý tài sản của các pháp nhân mình phụ trách.

Những người khác thấy gì:

- **Nhân viên** chỉ thấy thiết bị mình đang giữ, và thông tin (không có giá) của thiết bị dùng chung cho đặt lịch.
- **Nhân sự** thấy mục **Thiết bị đang giữ** trên hồ sơ của nhân viên mình quản lý — để thu hồi khi nhân viên nghỉ việc — nhưng không mở được cả sổ.
- **Nguyên giá**, **Ngày mua** và **Nhà cung cấp** chỉ người quản lý tài sản thấy; người đang giữ thiết bị không thấy giá của nó.

## Màn hình sổ tài sản

Mở **Của tôi → Tài sản** (với bạn, mục này mở thẳng sổ) hoặc [Tài sản](/assets).

- Dòng tổng: **Trong kho: … · Đang giao: … · Đang sửa: … · Mất: … · Đã thanh lý: …**
- Bộ lọc: **Tìm kiếm** (mã, tên hoặc số sê-ri), **Pháp nhân**, **Nhóm**, **Trạng thái**, rồi bấm **Lọc**.
- Bảng: **Mã**, **Tên**, **Nhóm**, **Pháp nhân**, **Trạng thái**, **Người giữ**, **Nguyên giá (₫)**.
- Các nút: **Thiết bị của tôi**, **Lịch đặt thiết bị**, **Bản quyền & thuê bao**, **In nhãn QR**, **Nhập từ tệp**, **Nhóm tài sản**, **Ghi nhận tài sản**.

### Trạng thái của tài sản

| Trạng thái | Ý nghĩa |
| --- | --- |
| **Trong kho** | Sẵn sàng để giao |
| **Đang giao** | Đang có người, nhóm hoặc pháp nhân giữ — do việc giao/thu hồi quyết định, không chọn tay |
| **Đang sửa** | Đang sửa chữa; không đặt lịch mượn được |
| **Mất** | Đã báo mất |
| **Đã thanh lý** | Đã thanh lý, ra khỏi sử dụng |

## Ghi nhận một tài sản mới

1. Bấm **Ghi nhận tài sản** ([mở](/assets/new)).
2. Điền **Tên tài sản**, chọn **Nhóm** và **Pháp nhân sở hữu**, **Tình trạng** (**Mới**, **Tốt**, **Bình thường**, **Kém**, **Hỏng**).
3. Điền thêm nếu có: **Hãng**, **Model**, **Số sê-ri**, **Vị trí**, **Ngày mua**, **Bảo hành đến**, **Nguyên giá (₫)**, **Nhà cung cấp**, **Ghi chú**.
4. Bấm **Ghi nhận**.

Hệ thống tự cấp **mã tài sản** theo dạng **mã pháp nhân – mã nhóm – số thứ tự**, ví dụ `SZM-LAP-0007`, và một mã QR riêng. Tài sản mới ở trạng thái **Trong kho**.

Lưu ý:

- Nhóm có bật **Bắt buộc số sê-ri** thì không lưu được nếu thiếu số sê-ri.
- **Nguyên giá** là số nguyên đồng, không âm.

Để sửa thông tin sau này, mở tài sản → **Sửa thông tin**.

## Trang của một tài sản

Bấm vào một dòng trong sổ (hoặc quét nhãn QR) để mở trang tài sản. Trang gồm:

- mã, tên, trạng thái, nhóm, pháp nhân và **mã QR** của tài sản;
- các thông tin: hãng, model, sê-ri, tình trạng, vị trí, bảo hành, (với bạn) ngày mua, nguyên giá, nhà cung cấp;
- **Đang được giữ** hoặc khung **Giao cho**;
- khung **Trạng thái** và liên kết **Sửa thông tin**;
- với thiết bị cho đặt lịch: khung **Lịch đặt thiết bị** gồm các lượt đặt sắp tới và biểu mẫu đặt;
- **Lịch sử**: mọi sự kiện — **Ghi nhận**, **Sửa thông tin**, **Giao**, **Xác nhận nhận**, **Thu hồi**, **Đổi tình trạng**, **Sửa xong**, **Báo mất**, **Thanh lý**, **Nhập từ tệp** — kèm người làm và ghi chú.

## Giao tài sản

Khi tài sản đang **Trong kho** (hoặc **Đang sửa**), khung **Giao cho** hiện trên trang tài sản:

1. **Giao cho**: chọn **Cá nhân**, **Nhóm** (một đơn vị trong cơ cấu tổ chức) hoặc **Pháp nhân** (ví dụ máy in của văn phòng).
2. **Người / nhóm nhận**: chọn người hoặc nhóm.
3. **Tình trạng khi giao**, **Hẹn trả** (nếu là giao tạm thời), **Mục đích**.
4. **Phụ kiện kèm theo**: mỗi dòng một món — sạc, túi, pin dự phòng…
5. Bấm **Giao tài sản**.

Tài sản chuyển sang **Đang giao**. Nếu giao cho một cá nhân, người đó phải tự vào **Thiết bị của tôi** để **Xác nhận đã nhận**; cho đến lúc đó, trang tài sản ghi **Chưa xác nhận nhận**. Giao cho nhóm hoặc pháp nhân thì không cần ai xác nhận.

Không giao được khi:

- tài sản đang có người khác giữ — **Tài sản đang được người khác giữ. Hãy thu hồi trước.**;
- tài sản đã **Mất** hoặc **Đã thanh lý**;
- người nhận đã nghỉ việc.

> [!TIP]
> Hệ thống không tự báo cho người nhận. Khi bàn giao trực tiếp, hãy nhắc họ mở **Thiết bị của tôi** để xác nhận ngay — đó là bằng chứng họ đã nhận đủ đồ.

## Thu hồi tài sản

Khi tài sản đang được giữ, trang tài sản có khung **Đang được giữ** (người giữ, ngày giao, đã xác nhận hay chưa, phụ kiện) và khung thu hồi:

1. Chọn **Tình trạng khi trả**.
2. Ghi **Cất về vị trí** nếu cất ở chỗ khác.
3. Ghi **Ghi chú khi thu hồi** (thiếu phụ kiện, hư hỏng…).
4. Bấm **Thu hồi**.

Tài sản trở về **Trong kho** — hoặc **Đang sửa** nếu tình trạng khi trả là **Hỏng**.

## Đổi trạng thái: sửa chữa, mất, thanh lý

Trong khung **Trạng thái** trên trang tài sản, chọn **Chuyển sang** (**Trong kho**, **Đang sửa**, **Mất**, **Đã thanh lý**), ghi **Lý do** và bấm **Cập nhật**.

- Chỉ đổi được khi tài sản **không có ai giữ**. Nếu đang giao, hãy **Thu hồi** trước để biên bản ghi đúng thứ gì đã trả về, trong tình trạng nào.
- Sửa xong, chuyển từ **Đang sửa** về **Trong kho** — lịch sử ghi **Sửa xong**.

## Khi nhân viên nghỉ việc

Khi Nhân sự ghi nhận một người nghỉ việc, hệ thống tự tạo **một việc thu hồi cho mỗi món** người đó còn giữ, hạn là ngày làm việc cuối cùng. Việc được giao cho quản lý trực tiếp của người nghỉ — người thường nhận lại đồ trực tiếp — hoặc, nếu không có, cho người quản lý tài sản của pháp nhân. Người được giao nhận thông báo; việc xuất hiện trong **Việc của tôi** của họ và dẫn thẳng tới trang tài sản.

Khi bạn bấm **Thu hồi** trên tài sản, việc thu hồi tương ứng tự đóng. Nếu việc nghỉ việc bị hủy, các việc thu hồi cũng bị hủy theo.

## Duyệt lịch đặt thiết bị

Với thiết bị thuộc nhóm có bật **Cho phép đặt lịch mượn**, nhân viên đặt lịch trên [Lịch đặt thiết bị](/assets/bookings). Bạn là người duyệt và giao nhận:

- Mục **Chờ duyệt** trên trang lịch liệt kê các yêu cầu đang chờ. Bấm vào một yêu cầu → **Duyệt**, hoặc **Từ chối** kèm **Lý do từ chối** (bắt buộc). Hệ thống không gửi thông báo cho yêu cầu mới, nên hãy xem mục này thường xuyên.
- Bạn có thể đặt lịch thay cho người khác bằng ô **Người sử dụng**; lượt đặt do bạn tạo được duyệt ngay.
- Khi người mượn đến nhận: mở lượt đặt → **Giao thiết bị** → **Tình trạng khi giao**, **Ghi chú** → **Đã giao máy**. Thiết bị chuyển sang **Đang giao**.
- Khi trả: mở lượt đặt → **Nhận lại thiết bị** → **Tình trạng khi nhận lại**, **Ghi chú** → **Đã nhận lại**. Thiết bị về **Trong kho**, hoặc **Đang sửa** nếu hỏng.
- Bạn có thể **Hủy lượt đặt** bất kỳ lượt nào còn **Chờ duyệt** hoặc **Đã duyệt**.

Hai lượt đặt cùng một thiết bị không bao giờ chồng giờ nhau; nếu hai người bấm đặt cùng lúc, chỉ một người được.

Các thiết lập nhóm tài sản, nhập sổ từ bảng tính và in nhãn QR được mô tả ở trang **Nhóm tài sản, nhập từ tệp & nhãn QR**.
