# Công việc

Phân hệ **Công việc** là nơi cả công ty giao việc, theo dõi tiến độ và cộng tác hằng ngày: mỗi **nhóm** có quy trình riêng, mỗi **dự án** gom các công việc cho một khách hàng hay một mục tiêu, và mỗi **công việc** có người phụ trách, hạn, trao đổi, tệp, sản phẩm cần duyệt và lịch sử đầy đủ.

Chương này dành cho **mọi người**: nhân viên làm việc được giao, trưởng nhóm điều phối nhóm, người phụ trách khách hàng (account) lo phần làm việc với khách, và lãnh đạo theo dõi khối lượng chung. Phần kế hoạch, ngân sách giờ, nghiệm thu… của dự án nằm ở chương **Dự án**; kế hoạch buổi sáng, báo cáo cuối ngày và ghi giờ nằm ở chương **Báo cáo hằng ngày & bảng giờ**.

## Các khái niệm cần biết

- **Nhóm** — một đội làm việc chung (ví dụ nhóm Video, nhóm Social). Mỗi nhóm có một **mã** ngắn (ví dụ `VID`) dùng để đánh số công việc: `VID-12`, `VID-13`… Nhóm có **Trưởng nhóm** và **Thành viên**.
- **Dự án** — thuộc về một nhóm, gom các công việc cho một khách hàng / nhãn hàng hoặc một việc nội bộ. Dự án có người **Phụ trách dự án**, có thể có **Phụ trách khách hàng** (account), thành viên và người xem.
- **Việc tồn của nhóm** — công việc của nhóm nhưng không thuộc dự án nào.
- **Trạng thái** — các bước trong quy trình của nhóm (ví dụ *Brief → Lên ý tưởng → Thiết kế / Quay → Duyệt nội bộ → Khách duyệt → Đã đăng*). Mỗi trạng thái thuộc một **nhóm trạng thái**: **Tồn đọng**, **Cần làm**, **Đang làm**, **Đang duyệt**, **Hoàn thành**, **Đã hủy**. Báo cáo và **Việc của tôi** đếm theo nhóm trạng thái này.
- **Ai được mở dự án** — mỗi dự án chọn một trong ba mức:
  - **Mở cho cả công ty**: mọi nhân viên trong pháp nhân của dự án (dự án cấp tập đoàn: cả tập đoàn); cộng tác viên bên ngoài không thấy.
  - **Chỉ trong nhóm**: thành viên của nhóm sở hữu và thành viên dự án.
  - **Riêng tư cho thành viên (chủ sở hữu được xem)**: chỉ thành viên dự án và trưởng nhóm làm việc trong đó. Quyền quản lý công việc của lãnh đạo không mở được dự án riêng tư để làm việc; lãnh đạo có quyền xem danh mục dự án (**Ban điều hành**, **Giám đốc pháp nhân**, **Trưởng bộ phận**, **Tài chính – Kế toán**) chỉ được *đọc* dự án riêng tư trong phạm vi của mình — không sửa, không bình luận, và mỗi lần đọc đều được ghi vào nhật ký hệ thống.

> [!NOTE]
> Bạn chỉ thấy những nhóm, dự án và công việc mình được phép xem. Một công việc bạn không được mở thì cũng "không tồn tại" với bạn — kể cả khi có ai gửi đường dẫn.

## Ai làm được gì

| Ai | Làm được |
| --- | --- |
| Mọi nhân viên | Làm việc được giao, bình luận, đính kèm tệp, gửi yêu cầu qua **Biểu mẫu yêu cầu**, xem lịch nội dung |
| Thành viên nhóm / dự án | Tạo và sửa công việc trong nhóm, dự án của mình; tạo dự án mới trong nhóm |
| Trưởng nhóm | Toàn quyền với nhóm: thành viên, quy trình, nhãn, trường tùy chỉnh, biểu mẫu, phân loại, gói bàn giao, quy trình duyệt, tự động hóa, quy định báo cáo ngày; duyệt brief khởi động dự án của nhóm |
| Phụ trách dự án | Thiết lập và quản lý dự án của mình, duyệt sản phẩm mặc định |
| Phụ trách khách hàng (account) | Ghi nhận ý kiến khách, gửi đường dẫn duyệt cho khách, lo nghiệm thu và báo cáo khách hàng |
| Người xem (của dự án) | Chỉ xem |
| **Ban điều hành**, **Giám đốc pháp nhân**, **Trưởng bộ phận** | Tạo nhóm, quản lý danh sách khách hàng, điều hành mọi nhóm và dự án không riêng tư trong phạm vi của mình |
| **Tài chính – Kế toán** | Xem các dự án trong phạm vi (không làm việc trong đó); xem phí và xử lý hàng chờ xuất hoá đơn — xem chương **Dự án** |
| Cộng tác viên bên ngoài | Chỉ làm việc trong những dự án họ được thêm vào |

## Bạn muốn… → Vào đâu

| Bạn muốn… | Vào đâu |
| --- | --- |
| Xem mọi nhóm và dự án của mình | [Công việc](/work) |
| Xem mọi việc đang chờ mình (công việc, duyệt, bàn giao…) | [Việc của tôi](/tasks) |
| Tạo nhanh một công việc từ bất cứ đâu | Nhấn phím **C**, hoặc **Ctrl/⌘ K** → **Tạo công việc** |
| Tìm một công việc theo mã (ví dụ VID-12) | **Ctrl/⌘ K** rồi gõ mã |
| Nhờ một nhóm khác làm việc gì đó | [Biểu mẫu yêu cầu](/work/intake) |
| Xem lịch nội dung theo ngày đến hạn | [Lịch nội dung](/work/calendar) |
| Theo dõi việc người khác đang làm cho mình | [Góc nhìn trưởng nhóm](/work/leader) |
| Xem ai đang quá tải (trưởng nhóm) | [Khối lượng công việc](/work/workload) |
| Tạo dự án hoặc thêm việc từ mẫu | [Mẫu công việc](/work/templates) |
| Xem / sửa danh sách khách hàng và nhãn hàng | [Khách hàng và nhãn hàng](/work/clients) |
| Xem sản lượng, tỷ lệ đúng hạn theo nhóm, khách hàng | [Báo cáo công việc](/work/analytics) |

## Các màn hình chính

### Trang Công việc

Mở **Công việc** ở nhóm **Công việc** trên thanh bên. Đầu trang có các liên kết nhanh: **Việc của tôi**, **Lịch nội dung**, **Góc nhìn trưởng nhóm**, **Khối lượng công việc** (chỉ hiện với trưởng nhóm và lãnh đạo), **Biểu mẫu yêu cầu**, **Mẫu công việc**, **Khách hàng và nhãn hàng**.

Bên dưới là hai phần:

- **Dự án** — thẻ của mọi dự án bạn xem được, kèm số việc đang mở, đã xong và quá hạn. Nút **Bắt đầu dự án** nằm cạnh tiêu đề. Dự án **Tạm dừng** hoặc **Đã xong** được xếp riêng ở mục **Tạm dừng và đã xong**; dự án lưu trữ nằm trong mục gập **Dự án lưu trữ**.
- **Nhóm của tôi** và **Nhóm khác** — thẻ nhóm kèm mã, pháp nhân và số thành viên. Nút **Tạo nhóm** chỉ hiện với lãnh đạo có quyền. Nhóm ngừng hoạt động và nhóm lưu trữ cũng được xếp riêng.

### Trang nhóm

Mở một thẻ nhóm để xem: các dự án của nhóm, **Việc tồn của nhóm (chưa thuộc dự án)**, **Thành viên**, **Quy trình**, **Checklist theo bước**, **Nhãn**, **Trường tùy chỉnh**, **Biểu mẫu yêu cầu** và **Quy định báo cáo ngày**. Dòng liên kết dưới tên nhóm dẫn tới **Hàng chờ phân loại**, **Chu kỳ**, **Gói bàn giao**, **Quy trình duyệt** và **Tự động hóa**.

### Trang dự án (tab Công việc)

Mở một dự án từ trang **Công việc** để xem các công việc của dự án. Thanh tab ở đầu trang đi qua mọi phần của dự án (**Công việc**, **Bảng Kanban**, **Tổng quan**, **Kế hoạch**, **Tiến độ**…) — các tab kế hoạch được mô tả ở chương **Dự án**. Công việc có bốn cách xem: **Danh sách**, **Bảng**, **Lịch**, **Dạng bảng**. Cuối trang có hai mục gập: **Việc lặp lại và mẫu** và **Thành viên và thiết lập**.

### Trang công việc

Mỗi công việc có trang riêng: tiêu đề, mô tả (brief), checklist, việc con, phụ thuộc, liên kết; cột bên phải chứa trạng thái, người phụ trách, hạn, ưu tiên…; bên dưới là trường tùy chỉnh, vướng mắc, tệp đính kèm, duyệt sản phẩm, giao cho khách, nhật ký đăng bài, bàn giao và phần **Trao đổi**.

## Bảng lệnh và phím tắt

- **Ctrl/⌘ K** mở **Bảng lệnh**: gõ để đi tới một trang, tìm công việc theo mã hoặc tiêu đề, hoặc tạo công việc.
- **C** (khi không đang gõ trong ô nhập) mở ngay hộp tạo công việc: nhập tiêu đề, chọn **Dự án hoặc nhóm**, hạn, và tích **Giao cho tôi** nếu cần.
- Trên trang công việc, **Ctrl/⌘ + Enter** gửi bình luận.
- Có thể dán mã công việc vào đường dẫn, ví dụ `/work/tasks/VID-12` — kể cả mã cũ của một việc đã chuyển nhóm.

## Thông báo bạn sẽ nhận

- Được giao một công việc, được nhắc tên (@) trong bình luận; có bình luận, tệp mới hoặc công việc đổi trạng thái — nếu bạn là người phụ trách, người cùng làm, người yêu cầu hoặc đang theo dõi việc đó.
- Mỗi sáng: việc **đến hạn ngày mai** và việc **quá hạn** — gộp thành một thông báo.
- Có phiên bản chờ bạn duyệt, quyết định duyệt của bạn bị quá hạn, sản phẩm của bạn được duyệt hoặc cần chỉnh sửa.
- Có bàn giao chờ bạn nhận, bàn giao bị trả lại, có người nhờ bạn làm thay khi họ nghỉ.
- Trưởng nhóm: có việc mới vào hàng chờ phân loại, có yêu cầu gửi qua biểu mẫu.

Cách nhận (trong ứng dụng, email, điện thoại…) chỉnh ở **Cài đặt thông báo**.

## Các trang trong chương này

- **Làm việc với công việc** — tạo, xem, lọc, sửa công việc; bình luận, tệp, vướng mắc.
- **Duyệt sản phẩm & giao khách** — nộp phiên bản, duyệt nhiều bước, ý kiến khách, đường dẫn duyệt cho khách, giao và đăng bài.
- **Bàn giao & làm thay** — chuyển bước có gói bàn giao, gửi sang nhóm khác, làm thay khi nghỉ, bàn giao khi nghỉ việc.
- **Thiết lập nhóm** — dành cho trưởng nhóm: thành viên, quy trình, checklist, nhãn, trường tùy chỉnh, quy trình duyệt, gói bàn giao, lưu trữ.
- **Phân loại, chu kỳ & tự động hóa** — hàng chờ phân loại, biểu mẫu yêu cầu, chu kỳ, quy tắc tự động.
- **Yêu cầu, mẫu & khách hàng** — gửi yêu cầu cho nhóm khác, mẫu công việc, việc lặp lại, danh sách khách hàng.
- **Theo dõi & điều phối** — góc nhìn trưởng nhóm, khối lượng công việc, lịch nội dung, báo cáo công việc.
