# Tham số pháp định

Mọi con số do pháp luật hoặc quy định công ty đặt ra — tỷ lệ bảo hiểm, biểu thuế thu nhập cá nhân, lương tối thiểu vùng, hệ số làm thêm giờ, số ngày phép năm, các ngưỡng kinh doanh… — được lưu trong **Tham số pháp định**. Không con số nào nằm cứng trong phần mềm. Mỗi giá trị có **ngày hiệu lực** và **căn cứ pháp lý**, nên khi luật thay đổi, bạn chỉ cần thêm phiên bản mới; các kỳ lương cũ vẫn tính theo giá trị cũ.

Thay đổi tuân theo nguyên tắc **bốn mắt**: nhân sự / C&B **đề xuất**, **Chủ sở hữu phê duyệt**.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem tham số | Người được đề xuất hoặc quyết định tham số, và người xem lương phạm vi toàn tập đoàn (**Quản trị nhân sự**, **C&B / Tiền lương**, **Tài chính – Kế toán**, **Ban điều hành**, **Kiểm toán (chỉ xem)** được giao toàn tập đoàn). |
| Đề xuất thay đổi | **Quản trị nhân sự**, **C&B / Tiền lương** phạm vi toàn tập đoàn. |
| **Phê duyệt** / **Từ chối** đề xuất; **Xác nhận đã kiểm tra** | Chỉ **Chủ sở hữu**. |

## Các tham số

| Tham số | Dùng cho |
| --- | --- |
| **Bảo hiểm – phần người lao động đóng** / **phần doanh nghiệp đóng** | Tính BHXH, BHYT, BHTN trên bảng lương. |
| **Mức tham chiếu (lương cơ sở)** và **Trần đóng bảo hiểm (số lần)** | Mức trần lương đóng bảo hiểm. |
| **Bảo hiểm – số ngày nghỉ không lương trong tháng thì không đóng** | Xác định tháng không phải đóng bảo hiểm. |
| **Kinh phí & đoàn phí công đoàn**, **Công đoàn – mức trần đoàn phí** | Khoản công đoàn. |
| **Lương tối thiểu vùng** | Kiểm tra lương tối thiểu theo vùng lương của pháp nhân. |
| **Giảm trừ gia cảnh**, **Biểu thuế TNCN lũy tiến**, **Thuế TNCN khấu trừ theo tỷ lệ cố định** | Tính thuế thu nhập cá nhân. |
| **Thuế TNCN – phần tiền làm thêm, làm đêm được miễn** | Phần thu nhập không chịu thuế. |
| **Hệ số lương tăng ca, làm đêm**, **Giới hạn giờ tăng ca**, **Giờ làm việc ban đêm** | Chấm công và tính lương làm thêm. |
| **Làm việc ngày lễ – hệ số 300% đã gồm hay chưa gồm lương ngày lễ** | Hệ số làm việc ngày lễ được trả thêm ngoài lương ngày lễ (giá trị cài sẵn) hay đã gồm lương ngày lễ — cần kế toán trưởng xác nhận. |
| **Phép năm** | Số ngày phép năm và cách cộng thâm niên. |
| **Tiền lương làm căn cứ thanh toán phép năm chưa nghỉ khi nghỉ việc** | Những khoản lương nào được tính khi trả tiền ngày phép chưa nghỉ cho người nghỉ việc (giá trị cài sẵn: lương cơ bản cộng phụ cấp đóng bảo hiểm, chưa xác nhận). |
| **Thử việc**, **Hợp đồng xác định thời hạn** | Giới hạn thời gian thử việc và hợp đồng. |
| **Số ngày nhắc trước các hạn nhân sự** | Nhắc hết thử việc, hết hợp đồng… |
| **Thuế GTGT trên dịch vụ bán ra** | Thuế suất mặc định và được phép trên báo giá, hoá đơn. |
| **CRM – cơ hội đứng yên, gia hạn, nhắc công nợ, hạn thanh toán, duyệt báo giá** | Các ngưỡng của phân hệ **Khách hàng & kinh doanh**. |

Ngày lễ không nằm ở đây: lịch ngày lễ, nghỉ bù được thiết lập trong phần chấm công (xem trang **Thiết lập chấm công**).

## Đọc trang Tham số pháp định

Mở **Quản trị** → [Tham số pháp định](/admin/rules).

- Phía trên là mục **Đề xuất chờ duyệt** (nếu có): mỗi đề xuất ghi tham số, ngày hiệu lực, căn cứ pháp lý, ghi chú và bảng giá trị đề xuất.
- Bên dưới là từng tham số: tên, mã, ngày hiệu lực của phiên bản **đang áp dụng** hôm nay ("từ … → …"), căn cứ pháp lý, ghi chú, và bảng giá trị. Tỷ lệ được hiển thị dạng phần trăm, số tiền có dấu phân cách hàng nghìn.
- **… phiên bản khác** — mở ra để xem các phiên bản trước hoặc sắp có hiệu lực.
- Nhãn đỏ **Chưa được kế toán trưởng xác nhận** — giá trị đang áp dụng chưa được đối chiếu lại với văn bản pháp luật.
- Dòng đỏ **Chưa có giá trị đang hiệu lực.** — tham số chưa có phiên bản nào áp dụng cho hôm nay; các phép tính dùng tham số này sẽ không chạy đúng.

## Đề xuất thay đổi

1. Ở khung **Đề xuất thay đổi** cuối trang, chọn **Tham số**.
2. Chọn **Hiệu lực từ** — ngày bắt đầu áp dụng giá trị mới. Ngày này phải **sau** ngày bắt đầu của phiên bản đang áp dụng (lịch sử không được ghi đè), và không trùng với một phiên bản đã có.
3. Ô **Giá trị (JSON)** được điền sẵn giá trị hiện hành. Sửa các con số cần đổi, **giữ nguyên cấu trúc**:
   - Tiền là **số nguyên VND** (không dấu chấm, không đơn vị).
   - Tỷ lệ tính theo **điểm cơ bản**: 8% viết là `800`, 1,5% viết là `150`.
   - Hệ số tính theo **phần trăm**: 150% viết là `150`.
4. Ghi **Căn cứ pháp lý** (số hiệu nghị định, thông tư, điều luật) và **Ghi chú**.
5. Bấm **Gửi đề xuất**.

Chủ sở hữu nhận thông báo **Có đề xuất thay đổi tham số pháp định**. Đề xuất chỉ có hiệu lực sau khi được phê duyệt.

> [!WARNING]
> Hệ thống từ chối giá trị không đúng cấu trúc của tham số ("Giá trị không đúng cấu trúc của tham số này") hoặc không phải JSON hợp lệ. Nếu không chắc, hãy chỉ sửa con số, không xoá hay đổi tên các khoá.

## Phê duyệt (Chủ sở hữu)

Ở mục **Đề xuất chờ duyệt**, đối chiếu giá trị với văn bản pháp luật rồi bấm:

- **Phê duyệt** — phiên bản mới có hiệu lực từ ngày đã chọn và được tính là đã kiểm tra.
- **Từ chối** — đề xuất bị bỏ.

### Hủy bỏ một phiên bản đã duyệt nhưng sai

Nếu một phiên bản đã phê duyệt hoá ra sai, Chủ sở hữu bấm **Hủy bỏ** trên phiên bản đó và ghi **Lý do hủy bỏ**. Phiên bản không còn hiệu lực nhưng vẫn được lưu (gạch ngang, nhãn **Đã hủy bỏ**, kèm người hủy và lý do); phiên bản trước đó tiếp tục áp dụng cho những ngày này. Sau đó đề xuất phiên bản đúng như bình thường — được phép dùng cùng ngày hiệu lực.

- Không hủy bỏ được khi một kỳ lương đã chuẩn bị chi, đã chi hoặc đã khoá dùng phiên bản này: hãy điều chỉnh bằng khoản truy lĩnh, truy thu.
- Khi một kỳ lương đang chờ duyệt dùng phiên bản này, hãy trả kỳ lương về cho nhân sự trước. Kỳ lương còn ở C&B sẽ bị đánh dấu cần tính lại.

Với giá trị đang áp dụng có nhãn **Chưa được kế toán trưởng xác nhận** (thường là giá trị cài sẵn khi khởi tạo hệ thống), sau khi đối chiếu, bấm **Xác nhận đã kiểm tra**. Khi một kỳ lương dùng tham số chưa được xác nhận, trang kỳ lương hiện cảnh báo.

## Mẹo

- Khi luật mới được ban hành, **đề xuất sớm** với đúng ngày hiệu lực trong tương lai. Hệ thống tự chuyển sang giá trị mới vào đúng ngày; kỳ lương tháng đó tính đúng ngay lần đầu.
- Luôn ghi **Căn cứ pháp lý** — đó là thứ kiểm toán sẽ hỏi.
- Các ngưỡng kinh doanh (CRM, thuế GTGT) là quy định công ty, đi qua cùng quy trình đề xuất – phê duyệt.
- Cách các tham số đi vào bảng lương được mô tả ở trang **Quy tắc tính lương**.
