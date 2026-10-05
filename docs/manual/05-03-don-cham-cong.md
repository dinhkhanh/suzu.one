# Đơn chấm công

Đơn chấm công dùng cho những ngày không thể hiện đúng qua lượt chấm: quên chấm, làm việc ở nơi khác, ở lại làm thêm, đi làm vào ngày nghỉ. Có bốn loại đơn, đều do **quản lý trực tiếp** duyệt (pháp nhân có thể thêm bước duyệt, ví dụ trưởng bộ phận hoặc nhân sự, trong **Luồng phê duyệt**).

## Tạo đơn

1. Vào **Chấm công** → **Tạo đơn chấm công** ([mở](/attendance/requests/new)), hoặc bấm liên kết sửa trong mục **… mục cần xử lý** trên trang **Chấm công** (form mở sẵn đúng loại và ngày).
2. Chọn loại đơn bằng các nút ở đầu trang: **Bổ sung công**, **Làm việc từ xa / ngoài văn phòng**, **Làm thêm giờ**, **Làm việc ngày nghỉ, ngày lễ**.
3. Điền các trường (xem từng loại bên dưới). Trường **Lý do** luôn bắt buộc.
4. Bấm **Gửi đơn**.

Đơn được chuyển tới người duyệt, người này nhận thông báo. Khi có quyết định, bạn nhận thông báo kết quả.

> [!IMPORTANT]
> Mỗi loại đơn chỉ có một đơn đang chờ hoặc đã duyệt cho cùng một ngày ("Đã có đơn cùng loại cho ngày đó."). Không tạo được đơn cho ngày thuộc tháng đã khoá công ("Bảng công tháng này đã khoá. Hãy đề nghị nhân sự điều chỉnh.").

## Bổ sung công

Dùng khi bạn quên chấm công hoặc máy / ứng dụng lỗi: ghi giờ vào / ra thực tế.

| Trường | Cách điền |
| --- | --- |
| **Ngày** | Một ngày đã qua (không bổ sung cho ngày tương lai) |
| **Giờ vào**, **Giờ ra** | Nhập giờ vào, giờ ra, hoặc cả hai. Giờ ra phải sau giờ vào |
| **Giờ ra sau nửa đêm (hôm sau)** | Đánh dấu khi bạn ra ca sau 0 giờ |
| **Nguyên nhân** | **Quên chấm công**, **Lỗi máy hoặc ứng dụng** hoặc **Khác** |
| **Minh chứng (không bắt buộc)** | Tải lên ảnh, tệp chứng minh (nếu có) |
| **Lý do** | Mô tả ngắn |

Khi đơn được duyệt, giờ trong đơn trở thành lượt chấm (ghi chú "Đơn bổ sung công") và ngày công được tính lại ngay.

**Giới hạn mỗi tháng**: công ty có thể giới hạn số đơn bổ sung công mỗi tháng. Khi đó trang hiện "Đã dùng …/… lần bổ sung công trong tháng". Đơn đang chờ và đã duyệt đều được tính. Hết lượt, bạn sẽ thấy "Bạn đã dùng hết số lần bổ sung công trong tháng." — nếu lỗi do máy chấm công, nhân sự có thể tạo đơn thay bạn (không bị tính giới hạn).

> [!TIP]
> Đơn có minh chứng sẽ được người duyệt mở ra xem, không được duyệt hàng loạt. Đính kèm minh chứng khi có thể để quản lý duyệt nhanh và chắc chắn.

## Làm việc từ xa / ngoài văn phòng

Dùng khi bạn làm việc tại nhà hoặc ngoài văn phòng (quay phim, gặp khách, sự kiện).

> [!NOTE]
> **Đi công tác** không còn tạo ở đây: hãy lập đề nghị đi công tác ở mục **Đề nghị**. Khi đề nghị được duyệt, ngày công tác được ghi vào bảng công tự động.

| Trường | Cách điền |
| --- | --- |
| **Từ ngày**, **Đến ngày** | Tối đa 31 ngày một đơn; trong khoảng phải có ít nhất một ngày làm việc |
| **Hình thức** | **Làm việc tại nhà** hoặc **Ngoài văn phòng (quay, gặp khách, sự kiện)** |
| **Thời gian trong ngày** | **Cả ngày**, **Buổi sáng** hoặc **Buổi chiều** (nửa ngày chỉ áp dụng cho đơn một ngày) |
| **Địa điểm** | Bắt buộc với ngoài văn phòng |
| **Vị trí trên bản đồ**, **Bán kính (m)** | Không bắt buộc. Bấm **Dùng vị trí của tôi** khi đang ở nơi đó (màn hình cho biết độ chính xác), hoặc mở **Dán liên kết bản đồ hoặc nhập toạ độ** và dán liên kết Google Maps / Apple Maps / OpenStreetMap hay cặp toạ độ. Liên kết rút gọn (maps.app.goo.gl) không chứa toạ độ. Bán kính từ 50 đến 5.000 m, mặc định 300 m |
| **Lý do** | Mô tả ngắn |

Khi được duyệt:

- **Không khai báo vị trí**: phần ngày được đơn bao phủ được tính công mà không cần chấm. Ngày hiện **Từ xa / ngoài văn phòng**.
- **Có khai báo vị trí**: bạn vẫn chấm công tại nơi đó như ở văn phòng. Lần chấm trong phạm vi đã đăng ký được chấp nhận ngay, không bị gắn cờ.

## Làm thêm giờ

Xin **trước khi ở lại**: làm thêm chỉ được tính trong khung giờ đã duyệt và theo giờ chấm công thực tế.

| Trường | Cách điền |
| --- | --- |
| **Ngày** | Một ngày làm việc (nếu là ngày nghỉ / ngày lễ, dùng đơn **Làm việc ngày nghỉ, ngày lễ**) |
| **Từ**, **Đến** | Khung giờ làm thêm. Giờ kết thúc trước giờ bắt đầu nghĩa là qua nửa đêm. Tối đa 16 giờ |
| **Hình thức bù** | **Trả lương theo hệ số luật định** hoặc **Nghỉ bù** |
| **Lý do** | Mô tả ngắn |

Nếu ngày đó bạn đã ở lại mà chưa xin, trang **Chấm công** sẽ hiện bất thường **Làm thêm chưa duyệt** kèm liên kết **Tạo đơn tăng ca** cho đúng ngày.

**Cảnh báo giới hạn làm thêm**: khi tổng giờ làm thêm của tháng hoặc năm (đã làm, cộng các đơn đã duyệt cho ngày sắp tới, cộng đơn này) gần hoặc vượt giới hạn luật định, trang hiện cảnh báo, ví dụ "Tăng ca tháng này sẽ là … giờ — gần giới hạn luật định … giờ." Đây chỉ là cảnh báo: đơn vẫn gửi được, người duyệt thấy cùng con số để quyết định. Giới hạn lấy theo tham số pháp định đang hiệu lực.

**Nghỉ bù**: nếu chọn **Nghỉ bù**, giờ làm thêm thực tế không được trả lương làm thêm mà được quy đổi thành ngày nghỉ bù (một giờ làm thêm đổi một giờ nghỉ, theo độ dài ngày công chuẩn của bạn) và cộng vào số dư nghỉ phép khi nhân sự khoá công tháng.

## Làm việc ngày nghỉ, ngày lễ

Dùng khi bạn đi làm vào ngày nghỉ tuần, ngày lễ, ngày nghỉ bù hoặc ngày công ty cho nghỉ.

| Trường | Cách điền |
| --- | --- |
| **Ngày** | Phải là ngày nghỉ theo lịch của bạn (nếu là ngày làm việc, dùng đơn **Làm thêm giờ**) |
| **Từ**, **Đến** | Không bắt buộc. Khung giờ dự kiến |
| **Hình thức bù** | **Trả lương theo hệ số luật định** hoặc **Nghỉ bù** |
| **Lý do** | Mô tả ngắn |

Số giờ được lấy từ chấm công của ngày đó. Nếu công việc không thể hiện qua chấm công (ví dụ một thứ Bảy không chấm công, quay ngoại cảnh), quản lý trực tiếp hoặc nhân sự sẽ **Xác nhận số giờ đã làm** sau khi ngày đó đến. Đơn đã duyệt mà chưa có số giờ sẽ chặn việc khoá công tháng cho tới khi được xác nhận.

## Theo dõi đơn

- Trên trang **Chấm công**, mục **Đơn của tôi trong tháng** liệt kê đơn của tháng đang xem kèm trạng thái: **Đang chờ**, **Đã duyệt**, **Từ chối**, **Trả lại**, **Đã rút**, **Đã huỷ**.
- Bấm vào tên đơn để mở trang chi tiết: các thông tin đã điền, **Ngày công hiện tại** (giờ vào, ra, giờ làm, tăng ca, làm thêm chưa duyệt của ngày đó), cảnh báo giới hạn, lịch sử xử lý.
- Đơn cũng hiện trong **Phê duyệt** → **Yêu cầu của tôi**.

## Sửa và gửi lại đơn bị trả lại

Người duyệt có thể **Trả lại để chỉnh sửa** kèm ý kiến. Khi đó:

1. Mở đơn (từ thông báo hoặc **Đơn của tôi trong tháng**).
2. Bấm **Sửa và gửi lại**. Trang **Sửa và gửi lại** mở với các giá trị cũ.
3. Sửa theo ý kiến người duyệt, bấm **Gửi lại**. Đơn đi lại luồng duyệt.

## Rút hoặc huỷ đơn

| Tình huống | Ai làm được | Nút |
| --- | --- | --- |
| Đơn đang chờ duyệt | Người tạo đơn, hoặc nhân sự | **Rút đơn** |
| Đơn đã duyệt, ngày chưa đến | Người tạo đơn, hoặc nhân sự | **Huỷ đơn** |
| Đơn đã duyệt, ngày đã đến hoặc đã qua | Chỉ nhân sự | **Huỷ đơn** |
| Tháng đã khoá công | Không ai — cần nhân sự điều chỉnh | — |

Huỷ một đơn bổ sung công đã duyệt sẽ làm các lượt chấm từ đơn đó không còn được tính; ngày công được tính lại.

## Nhân sự tạo đơn thay nhân viên

Nhân sự phụ trách chấm công có thể tạo bất kỳ loại đơn nào thay cho người trong phạm vi của mình, thường từ **Bảng bất thường chấm công** (liên kết **Tạo đơn bổ sung công**, **Tạo đơn tăng ca**, **Tạo đơn làm ngày nghỉ**). Đầu trang hiện "Tạo thay cho …". Đơn bổ sung công do nhân sự tạo thay không bị tính vào giới hạn hằng tháng. Đơn vẫn đi qua quản lý trực tiếp của nhân viên để duyệt như thường.

## Lỗi thường gặp

| Thông báo | Cách xử lý |
| --- | --- |
| Chỉ bổ sung công cho ngày đã qua. | Đợi ngày đó qua, hoặc chấm công bình thường hôm nay |
| Đó là ngày nghỉ: hãy dùng đơn làm việc ngày nghỉ, ngày lễ. | Chuyển sang loại **Làm việc ngày nghỉ, ngày lễ** |
| Đó là ngày làm việc: hãy dùng đơn làm thêm giờ. | Chuyển sang loại **Làm thêm giờ** |
| Không có ngày làm việc trong khoảng này. | Đơn làm từ xa phải bao gồm ít nhất một ngày làm việc |
| Không có ai duyệt được đơn này. Liên hệ nhân sự. | Luồng duyệt không tìm được người duyệt (thường do hồ sơ chưa có quản lý trực tiếp); báo nhân sự |
