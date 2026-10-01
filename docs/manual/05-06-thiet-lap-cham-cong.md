# Thiết lập chấm công

Trang này dành cho **nhân sự phụ trách chấm công** (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự**). Bạn thiết lập những gì bảng công dựa vào: lịch ngày lễ và ngày nghỉ, lịch làm việc theo tuần, ca và phân ca, địa điểm được chấm công, và quy định nội bộ (châm chước, làm tròn, làm thêm…).

Mở **Chấm công** → liên kết **Thiết lập chấm công** ở góc trên ([mở](/attendance/settings/calendar)). Trang có các thẻ: **Lịch làm việc**, **Lịch làm việc theo tuần**, **Ca & phân ca**, **Địa điểm làm việc**, **Quy định**, **Máy chấm công**.

## Phạm vi: pháp nhân hay mọi pháp nhân

Hầu hết thiết lập có trường **Áp dụng cho**: một pháp nhân cụ thể, hoặc **Mọi pháp nhân** (dùng chung cả tập đoàn).

- Bạn chỉ tạo / sửa được thiết lập của pháp nhân mình phụ trách.
- Thiết lập **Mọi pháp nhân** chỉ người có quyền trên toàn tập đoàn mới sửa được.
- Khi có cả dòng chung và dòng riêng cho cùng một việc, dòng riêng của pháp nhân được ưu tiên.

> [!NOTE]
> Thay đổi thiết lập ảnh hưởng tới bảng công từ ngày áp dụng. Thay đổi nhỏ được tính lại ngay; thay đổi ảnh hưởng nhiều người được tính lại trong đêm. Cần ngay thì dùng nút **Tính lại** trên **Bảng công của nhóm** (xem trang **Khoá công tháng**). Tháng đã khoá không bao giờ bị thay đổi.

## Lịch làm việc (ngày lễ và ngày đặc biệt)

Thẻ **Lịch làm việc** liệt kê các ngày khác với lịch tuần trong một năm. Chọn năm bằng các nút năm ở đầu trang.

Loại ngày:

| Loại | Dùng khi |
| --- | --- |
| **Ngày lễ** | Ngày nghỉ lễ, Tết theo quy định |
| **Nghỉ bù** | Ngày nghỉ bù cho ngày lễ trùng cuối tuần, hoặc ngày hoán đổi |
| **Công ty cho nghỉ** | Công ty cho nghỉ riêng (ví dụ nghỉ du lịch công ty) |
| **Ngày làm bù** | Một ngày thường nghỉ (ví dụ thứ Bảy) nay phải đi làm để bù |

**Thêm hoặc thay một ngày:**

1. Kéo xuống khung **Thêm hoặc thay một ngày**.
2. Chọn **Ngày**, **Loại**, nhập **Tên** (ví dụ "Giỗ Tổ Hùng Vương"), chọn **Áp dụng cho**.
3. Bấm **Lưu**.

**Xác nhận ngày điền sẵn:** các ngày lễ âm lịch và ngày hoán đổi hằng năm được hệ thống điền sẵn với nhãn **Chờ xác nhận**, vì Nhà nước công bố lịch nghỉ từng năm. Khi có thông báo chính thức, kiểm tra từng ngày rồi bấm **Xác nhận**; nếu khác, **Xóa** dòng đó và thêm lại đúng ngày.

## Lịch làm việc theo tuần

Thẻ **Lịch làm việc theo tuần** có hai phần: các lịch tuần, và **Ai theo lịch nào**.

### Tạo một lịch tuần

1. Mở khung **Thêm lịch làm việc**.
2. Nhập **Tên**, chọn **Loại**:
   - **Giờ hành chính**: giờ bắt đầu và kết thúc cố định.
   - **Giờ linh hoạt**: khung giờ là giờ bắt buộc có mặt; **Số phút yêu cầu** là tổng thời gian phải làm trong ngày.
   - **Theo ca (phân ca)**: bảng phân ca cho biết ai làm ca nào ngày nào; lịch tuần áp dụng cho ngày chưa phân ca.
3. Chọn **Áp dụng cho**.
4. Với từng ngày từ **Thứ Hai** đến **Chủ Nhật**, chọn loại ngày:
   - **Làm việc**: nhập giờ bắt đầu, kết thúc; có thể thêm phần hai (ví dụ ca gãy sáng / chiều); **Nghỉ giữa giờ (phút)**; với giờ linh hoạt thì thêm **Số phút yêu cầu**.
   - **Làm việc, không chấm công (WFH)**: ngày làm việc nhưng không cần chấm; nhập **Số phút ghi nhận** để tính công tự động.
   - **Nghỉ**.
5. (Tuỳ chọn) Đánh dấu **Thứ Bảy cách tuần: cứ hai tuần nghỉ một Thứ Bảy** và chọn **Một Thứ Bảy theo lịch ở trên** làm mốc.
6. (Tuỳ chọn) Đánh dấu **Lịch mặc định (cho người chưa được gán lịch)** — lịch mặc định phải áp dụng cho mọi pháp nhân và đang dùng.
7. Bấm **Lưu**.

Bấm vào một lịch có sẵn để sửa. Bỏ dấu **Đang dùng** để ngừng dùng lịch (lịch ngừng dùng không gán được nữa).

### Gán lịch: Ai theo lịch nào

Người chưa được gán lịch nào sẽ theo lịch mặc định. Để gán:

1. Ở khung **Gán lịch làm việc**, chọn **Cho**: **Pháp nhân**, **Phòng ban** hoặc **Nhân viên**, rồi chọn đối tượng tương ứng. Gán cho một phòng ban áp dụng cho mọi đơn vị bên dưới phòng ban đó.
2. Chọn **Lịch**, **Từ ngày**, (không bắt buộc) **Đến ngày**, **Ghi chú**.
3. Bấm **Gán**.

Quy tắc:

- Gán cụ thể nhất được ưu tiên: nhân viên, rồi phòng ban, rồi pháp nhân.
- Gán mới sẽ kết thúc gán cũ cùng phạm vi vào ngày hôm trước.
- Nếu đã có một gán khác cùng phạm vi **bắt đầu** trong giai đoạn bạn chọn, hệ thống báo trùng — hãy xóa gán đó trước.

Mỗi dòng gán có nhãn **Đang hiệu lực**, **Sắp tới** hoặc **Đã kết thúc**, và nút **Xóa** nếu bạn có quyền với đối tượng đó.

> [!TIP]
> Ai chưa có lịch sẽ hiện **Chưa có lịch** trên bảng công và **Chưa có lịch làm việc** trên bảng bất thường. Luôn giữ một lịch mặc định đang dùng để tránh tình trạng này.

## Ca & phân ca

### Khai báo ca

1. Mở khung **Thêm ca**.
2. Nhập **Mã** (ví dụ `S`, `C`, `D`), **Tên**, chọn **Áp dụng cho**, **Nghỉ giữa giờ (phút)**.
3. Nhập **Bắt đầu**, **Kết thúc**; nếu ca có hai phần thì thêm **Phần hai — bắt đầu**, **Phần hai — kết thúc**.
4. Bấm **Lưu**.

Giờ kết thúc không sau giờ bắt đầu nghĩa là ca qua nửa đêm; ca thuộc về ngày bắt đầu. Mã ca không được trùng.

### Phân ca

Phân ca cho biết ai làm ca nào vào ngày nào, và thay cho lịch tuần của ngày đó. Danh sách hiện phân ca từ một tuần trước đến khoảng một tháng tới, của những người bạn phụ trách.

1. Ở khung **Phân ca cho một giai đoạn**, chọn **Nhân viên**.
2. Chọn **Ca**, hoặc **Nghỉ theo phân ca** (ngày nghỉ), hoặc **Xóa (theo lịch tuần)** để bỏ phân ca và trả ngày về lịch tuần.
3. Chọn **Từ ngày**, **Đến ngày** (tối đa hai tháng mỗi lần), bấm **Lưu**.

## Địa điểm làm việc

Thẻ **Địa điểm làm việc** khai báo nơi nhân viên được chấm công bằng ứng dụng. Nếu chưa có địa điểm nào, chấm công ở đâu cũng được chấp nhận.

1. Mở khung **Thêm địa điểm làm việc**.
2. Nhập **Tên**, chọn **Pháp nhân**, **Địa chỉ**.
3. Khai báo vòng tròn: **Vĩ độ**, **Kinh độ**, **Bán kính (m)**. Có thể đặt **Bỏ qua vị trí kém chính xác hơn (m)**.
4. Và / hoặc khai báo **Mạng văn phòng**: mỗi dòng một địa chỉ IP công cộng, dải CIDR (ví dụ `203.0.113.0/24`) hoặc tên miền.
5. Chọn **Lần chấm hợp lệ khi**: **Trong vòng tròn hoặc dùng mạng văn phòng**, **Trong vòng tròn**, **Dùng mạng văn phòng**, hoặc **Trong vòng tròn và dùng mạng văn phòng**.
6. Chọn **Nếu không**: **Chấp nhận và chuyển xem xét** hoặc **Từ chối lần chấm**.
7. Bấm **Lưu**.

Một lần chấm hợp lệ khi thoả ít nhất một địa điểm của pháp nhân. Nếu không thoả, lần chấm được ghi và chuyển quản lý xem xét — trừ khi mọi địa điểm liên quan đều đặt **Từ chối lần chấm**.

> [!IMPORTANT]
> **Về mạng văn phòng**: hỏi bộ phận IT địa chỉ công cộng của văn phòng (kết quả "what is my IP" khi dùng Wi-Fi văn phòng). Nếu địa chỉ thay đổi (WAN IP động), cho router cập nhật qua Dynamic DNS và nhập tên miền thay vì địa chỉ. Không nhập đường truyền nằm sau NAT dùng chung của nhà mạng — khách hàng khác cũng đi ra qua cùng địa chỉ đó.

> [!TIP]
> Bắt đầu với chế độ **Chấp nhận và chuyển xem xét** trong vài tuần để xem có bao nhiêu lần chấm bị gắn cờ và vì sao, rồi mới cân nhắc **Từ chối lần chấm**. Chế độ từ chối khiến nhân viên không chấm được khi điện thoại định vị kém.

## Quy định

Thẻ **Quy định** chứa quy định nội bộ mà bảng công tuân theo. Mỗi quy định có phạm vi (một pháp nhân, hoặc **Mọi pháp nhân (mặc định tập đoàn)**) và ngày hiệu lực. Nếu chưa có quy định nào: tính đến từng phút, không châm chước, làm thêm phải được duyệt.

Các trường:

| Trường | Ý nghĩa |
| --- | --- |
| **Từ ngày** | Ngày phiên bản bắt đầu hiệu lực |
| **Khi cả hai nguồn đều có lượt chấm** | **Vào sớm nhất, ra muộn nhất giữa app và máy**, **Ưu tiên máy, dùng app khi máy không có**, hoặc **Ưu tiên app, dùng máy khi app không có** |
| **Châm chước đi muộn (phút)**, **Châm chước về sớm (phút)** | Muộn / sớm trong số phút này không bị tính |
| **Làm tròn lượt chấm (phút, 0 = không)** | Làm tròn giờ chấm theo bước phút |
| **Làm thêm tối thiểu được tính (phút)** | Làm thêm ít hơn số phút này không được tính |
| **Hai lượt gần nhau coi là một (phút)** | Gộp các lượt chấm sát nhau |
| **Số đơn bổ sung công mỗi tháng (trống = không giới hạn)** | Giới hạn đơn bổ sung công của mỗi nhân viên |
| **Giờ nghỉ không lương bắt đầu** | Vị trí giờ nghỉ giữa giờ trong ngày |
| **Lượt ra trước giờ này tính cho ngày hôm trước** | Mốc cắt ngày cho ca qua đêm |
| **Làm thêm chỉ tính khi có đơn được duyệt** | Bật: giờ ngoài lịch không có đơn là "ngoài giờ chưa duyệt" |

**Phiên bản:** mỗi lần lưu là một phiên bản mới (**Lưu thành phiên bản mới**). Lưu với ngày bắt đầu muộn hơn sẽ đóng phiên bản hiện tại vào ngày liền trước; các ngày trước đó giữ phiên bản cũ. Không chọn được ngày sớm hơn ngày bắt đầu của phiên bản hiện tại. Phiên bản đang áp dụng có nhãn **Đang hiệu lực**; dòng tóm tắt dạng "châm chước …′/…′ · làm tròn …′ · làm thêm từ …′".

> [!NOTE]
> Các giá trị theo luật — khung giờ làm đêm, hệ số và giới hạn làm thêm — **không** đặt ở đây. Chúng là tham số pháp định, quản lý tại **Quản trị** → **Tham số pháp định**.

## Máy chấm công

Thẻ **Máy chấm công** mở màn hình quản lý máy vân tay / thẻ, hồ sơ ánh xạ và nhập nhật ký. Xem trang **Máy chấm công**.

## Thứ tự thiết lập gợi ý khi bắt đầu

- [ ] Xác nhận các ngày lễ của năm trong **Lịch làm việc**.
- [ ] Tạo ít nhất một lịch tuần và đặt làm **Lịch mặc định**.
- [ ] Gán lịch riêng cho pháp nhân / phòng ban / nhân viên có giờ làm khác.
- [ ] Khai báo ca và phân ca (nếu có bộ phận làm theo ca).
- [ ] Khai báo **Địa điểm làm việc** cho từng văn phòng.
- [ ] Lưu **Quy định** cho tập đoàn và cho pháp nhân có thông lệ riêng.
- [ ] Khai báo máy chấm công (nếu có).
- [ ] Đảm bảo có loại **Nghỉ bù** trong phân hệ nghỉ phép.
