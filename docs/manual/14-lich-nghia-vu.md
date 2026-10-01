# Lịch nghĩa vụ

**Lịch nghĩa vụ** là sổ theo dõi các việc mà công ty *bắt buộc* phải làm đúng hạn: nộp tờ khai thuế, đóng bảo hiểm xã hội, báo tăng / giảm lao động, khóa bảng công, chi lương, gia hạn bản quyền phần mềm… Mỗi việc như vậy gọi là một **nghĩa vụ**. SuZu One tự sinh nghĩa vụ cho từng pháp nhân theo kỳ (tháng, quý, nửa năm, năm) hoặc khi có sự kiện nhân sự (tuyển mới, nghỉ việc, nghỉ dài ngày…), giao cho người phụ trách, nhắc trước hạn, báo lên cấp trên khi trễ và lưu lại chứng từ đã nộp để phục vụ thanh tra.

Bạn tìm thấy mục này trong menu **Quản lý → Lịch nghĩa vụ**.

> [!NOTE]
> Thư viện nghĩa vụ ban đầu chỉ là **bản nháp** về hạn nộp theo thực tế phổ biến ở Việt Nam, không phải tư vấn pháp lý. Kế toán trưởng và Trưởng phòng Nhân sự cần rà soát từng mẫu trước khi dựa vào đó. Nghĩa vụ sinh từ mẫu chưa rà soát mang nhãn **Quy tắc chưa rà soát**.

## Ai dùng trang này

| Bạn là | Bạn làm gì ở đây |
|---|---|
| Người được giao một nghĩa vụ (bất kỳ ai) | Xem hạn, các bước, hướng dẫn; đánh dấu từng bước, ghi số tham chiếu, ngày nộp, số tiền, tải chứng từ lên rồi **Đánh dấu hoàn thành**. |
| Người kiểm tra của một nghĩa vụ | Xem nghĩa vụ và chứng từ; nhận thông báo khi nghĩa vụ quá hạn. |
| Quản trị nhân sự, Chuyên viên nhân sự, C&B / Tiền lương, Tài chính – Kế toán | Xem toàn bộ nghĩa vụ của các pháp nhân trong phạm vi; làm thay, giao lại người phụ trách / người kiểm tra, đánh dấu **Không áp dụng**, **Mở lại**, bấm **Đồng bộ ngay**. |
| Ban điều hành, Giám đốc pháp nhân, Kiểm toán (chỉ xem) | Xem tổng quan, lịch, danh sách, lưu trữ và chứng từ; xuất CSV. Không thay đổi được gì. |
| Người được phân quyền quản lý nghĩa vụ cho *toàn tập đoàn* (thường là Quản trị nhân sự, Chủ sở hữu) | Thêm, sửa, bật / tắt mẫu trong **Thư viện**, đánh dấu mẫu đã rà soát. |

> [!TIP]
> Bạn không có vai trò nào ở trên nhưng được giao một nghĩa vụ? Nghĩa vụ đó nằm trong **Việc của tôi**, nhóm **Nghĩa vụ tuân thủ**. Bạn không thấy mục **Lịch nghĩa vụ** trên menu là bình thường.

## Bạn muốn… → Vào đâu

| Bạn muốn… | Vào đâu |
|---|---|
| Xem nghĩa vụ mình đang phụ trách | **Việc của tôi** → nhóm **Nghĩa vụ tuân thủ**, hoặc [Danh sách](/ops/list) |
| Nộp chứng từ và đóng một nghĩa vụ | Mở nghĩa vụ → điền phần **Chứng từ** → **Đánh dấu hoàn thành** (xem **Theo dõi & hoàn thành nghĩa vụ**) |
| Xem bức tranh chung của mọi pháp nhân theo tháng | [Tổng quan](/ops) |
| Xem nghĩa vụ theo ngày trên lịch tháng | [Lịch](/ops/calendar) |
| Lọc nghĩa vụ đang mở / đã đóng, theo pháp nhân, cơ quan, người phụ trách | [Danh sách](/ops/list) |
| Giao lại người phụ trách, hủy kỳ không áp dụng, mở lại | Mở nghĩa vụ (xem **Điều phối nghĩa vụ**) |
| Thêm hoặc sửa quy tắc tính hạn của một nghĩa vụ | [Thư viện](/ops/templates) (xem **Thư viện nghĩa vụ**) |
| Tra hồ sơ các kỳ đã qua, xuất CSV cho thanh tra | [Lưu trữ](/ops/history) (xem **Lưu trữ tuân thủ**) |
| Sinh ngay các nghĩa vụ mới sau khi sửa thư viện | Nút **Đồng bộ ngay** trên Tổng quan hoặc Danh sách |

## Các màn hình

Đầu mỗi trang có một dải thẻ: **Tổng quan**, **Danh sách**, **Lịch**, **Lưu trữ**, **Thư viện**. Người chỉ được giao việc (không có vai trò xem nghĩa vụ) chỉ thấy thẻ **Danh sách**, và danh sách chỉ gồm những nghĩa vụ họ phụ trách hoặc kiểm tra.

- **Tổng quan** — bảng *pháp nhân × tháng* (2 tháng trước đến 3 tháng sau tháng hiện tại). Mỗi ô đếm số nghĩa vụ theo trạng thái và tô màu theo việc nghiêm trọng nhất.
- **Danh sách** — mọi nghĩa vụ theo hạn, chia hai thẻ **Đang mở** / **Đã đóng**, lọc theo pháp nhân, **Cơ quan**, **Phân loại**, **Người phụ trách**.
- **Lịch** (*Lịch tuân thủ*) — lịch tháng, mỗi nghĩa vụ nằm ở ngày đến hạn; ngày cuối tuần và ngày nghỉ tô xám.
- **Lưu trữ** (*Lưu trữ tuân thủ*) — các kỳ đã qua: ai hoàn thành, ngày nộp, số tham chiếu, số tiền, chứng từ; có nút **Xuất CSV**.
- **Thư viện** (*Thư viện nghĩa vụ*) — các mẫu dùng để sinh nghĩa vụ, chia hai nhóm **Nội bộ** và **Với cơ quan nhà nước**.
- **Trang một nghĩa vụ** — thông tin, hướng dẫn, các bước, chứng từ và các nút xử lý.

## Màu trạng thái

| Nhãn | Ý nghĩa |
|---|---|
| **Sắp tới** | Còn mở, hạn còn hơn 7 ngày. |
| **Sắp đến hạn** | Còn mở, hạn trong vòng 7 ngày tới. |
| **Quá hạn** | Còn mở và đã qua ngày hạn. |
| **Hoàn thành** | Đã đóng đúng hạn. |
| **Hoàn thành trễ** | Đã đóng nhưng sau ngày hạn. |
| **Không áp dụng** | Đã hủy kèm lý do (ví dụ pháp nhân không có lao động nước ngoài). Không tính trên Tổng quan và Lịch. |

Ngoài ra còn hai nhãn đỏ cho việc quá hạn đã được báo lên: **Đã báo lên quản lý** và **Đã báo lên ban lãnh đạo**.

## Nghĩa vụ được sinh ra thế nào

- **Theo kỳ**: mỗi mẫu đang dùng có một chu kỳ (**Hằng tháng**, **Hằng quý**, **Nửa năm**, **Hằng năm**) và một quy tắc tính hạn. Hệ thống tạo trước các nghĩa vụ có hạn trong khoảng 100 ngày tới, mỗi pháp nhân áp dụng một nghĩa vụ cho mỗi kỳ.
- **Theo sự kiện nhân sự**: khi HR ghi nhận **Tuyển mới**, **Tái tuyển dụng**, **Chấm dứt hợp đồng**, **Bắt đầu nghỉ dài ngày**, **Đi làm lại sau nghỉ dài ngày** hay **Thay đổi lương**, các nghĩa vụ liên quan (ký hợp đồng, báo tăng / giảm BHXH, đăng ký mã số thuế…) được tạo cho đúng người đó. Nếu sự kiện bị hủy (ví dụ quyết định nghỉ việc được rút lại), các nghĩa vụ còn mở của nó tự chuyển sang **Không áp dụng**.
- **Gia hạn bản quyền / thuê bao**: mỗi kỳ đến hạn trong **Tài sản → Bản quyền & thuê bao** sinh một nghĩa vụ **Gia hạn hoặc hủy bản quyền / thuê bao**, hạn trước ngày đến hạn 14 ngày, giao cho người phụ trách bản quyền đó.
- Nếu hạn rơi vào cuối tuần hoặc ngày nghỉ của pháp nhân, hạn được dời sang ngày làm việc kế tiếp hoặc liền trước, tùy mẫu. Danh sách ghi chú **đã dời khỏi ngày nghỉ**.

## Việc hệ thống tự làm

- **Mỗi đêm và mỗi sáng**: sinh nghĩa vụ mới theo thư viện và theo các sự kiện nhân sự, gia hạn bản quyền mới ghi nhận. Người được giao nhận một thông báo gộp.
- **Mỗi sáng**: nhắc trước hạn, báo khi quá hạn, báo lên cấp trên theo số ngày trễ (xem **Theo dõi & hoàn thành nghĩa vụ**).
- **Tự đóng**: **Khóa bảng công tháng** tự hoàn thành khi bảng công tháng của pháp nhân được khóa trong Chấm công; **Lập và trình bảng lương tháng**, **Tổng Giám đốc ký duyệt bảng lương**, **Chi lương tháng**, **Phát hành phiếu lương** tự hoàn thành khi kỳ lương tháng đó đi tới bước tương ứng. Người hoàn thành hiển thị là **tự động**.

## Các trang trong chương này

- **Theo dõi & hoàn thành nghĩa vụ** — dành cho người được giao: tìm việc, điền chứng từ, đóng nghĩa vụ, nhắc hạn và báo lên cấp trên.
- **Tổng quan, lịch & danh sách** — đọc bảng tổng quan, dùng lịch và bộ lọc.
- **Điều phối nghĩa vụ** — dành cho HR / kế toán: giao lại, hủy kỳ không áp dụng, mở lại, đồng bộ.
- **Thư viện nghĩa vụ** — tạo, sửa và rà soát mẫu.
- **Lưu trữ tuân thủ** — tra cứu và xuất hồ sơ các kỳ đã qua.
