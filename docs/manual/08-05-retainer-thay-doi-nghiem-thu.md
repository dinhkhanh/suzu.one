# Retainer, thay đổi & nghiệm thu

Trang này hướng dẫn phần làm việc với khách hàng của một dự án: hợp đồng theo tháng (**Retainer**), thay đổi phạm vi đã thống nhất (**Thay đổi**), biên bản nghiệm thu (**Nghiệm thu**) và báo cáo định kỳ gửi khách (**Báo cáo KH**). Dành cho **người phụ trách khách hàng (account)**, **người phụ trách dự án** và **trưởng nhóm**; phần số tiền dành cho người có quyền xem thông tin thương mại (**Tài chính – Kế toán**, **Ban điều hành**, **Giám đốc pháp nhân**).

> [!IMPORTANT]
> Mọi số tiền trên các tab này (phí retainer tháng, thay đổi phí, số tiền thanh toán) chỉ hiện với người được xem phí; chỉ người có quyền thương mại mới sửa được. Phụ trách dự án và account của chính dự án xem được nhưng không sửa số tiền.

## Retainer

Tab **Retainer** chỉ có ở dự án loại **Retainer** (đổi loại ở phần thiết lập kế hoạch nếu đây là hợp đồng theo tháng).

### Thiết lập điều khoản

Account hoặc người điều hành dự án bấm **Thiết lập retainer** (hoặc **Sửa điều khoản**):

1. **Tháng bắt đầu** và **Tháng kết thúc** (bỏ trống nếu chạy *khi có thông báo*).
2. **Phần chưa dùng**: **Không cộng dồn (mỗi tháng tính lại)** hoặc **Cộng dồn sang tháng sau**.
3. **Hạng mục hằng tháng** — mỗi dòng gồm **Số lượng**, tên **Sản phẩm**, **Định dạng**, **Kênh** (ví dụ *12 × Bài đăng Facebook*, *2 × Video ngắn*). Mỗi tháng các dòng này xuất hiện trong danh sách sản phẩm của tháng. Tên dòng dùng để cộng dồn giữa các tháng, nên không đặt trùng tên.
4. **Số giờ mỗi tháng** (hạn mức giờ làm, nếu có) và **Phí mỗi tháng (VND)** (chỉ người có quyền thương mại).
5. Trạng thái **Đang chạy** / **Tạm dừng**, rồi **Lưu điều khoản**.

> [!NOTE]
> Đổi tháng bắt đầu, tháng kết thúc hay trạng thái chạy của retainer cần quyền thương mại ở pháp nhân của dự án. Sau khi duyệt khởi động, hạng mục hằng tháng, số giờ và phí mỗi tháng chỉ thay đổi qua tab **Thay đổi** (áp dụng từ tháng được tạo tiếp theo); tháng, cộng dồn và trạng thái chạy vẫn sửa trực tiếp.

### Theo dõi từng tháng

Phần **Tháng …** (tháng hiện tại) có bảng theo hạng mục: **Hạn mức**, **Cộng dồn**, **Đã dùng**, **Còn lại**, **Mức sử dụng**; dòng **Cả tháng**; **Giờ làm** (đã ghi / hạn mức giờ); và với người được xem phí: **Phí tháng** và trạng thái **Xuất hoá đơn** (**Chuyển kế toán khi hết tháng**, **Chờ xuất hoá đơn**, **Đã xuất hoá đơn**, **Không thu**).

Mỗi hạng mục của tháng hiện số **Đã giao**, **Đã duyệt** và các việc đã gắn. Người sửa được kế hoạch mở hạng mục để tạo việc cho phần còn thiếu, gỡ một việc, sửa hoặc rút hạng mục. Phần **Gắn việc vào sản phẩm cam kết** gắn một việc của dự án — kể cả việc đã xong — vào hạng mục của một tháng (tên hạng mục có kèm tháng, tháng này đứng đầu). Trên trang công việc, ô **Việc này thực hiện sản phẩm cam kết** làm cùng việc đó.

Phần **Báo cáo retainer các tháng** giữ lại các tháng đã qua (**Đang mở** / **Đã khoá**).

Nếu điều khoản được nhập sau khi hợp đồng đã chạy, các tháng trước đó chưa có kỳ: dùng **Tạo tháng còn thiếu** → chọn **Tháng** → **Tạo kỳ cho tháng này** để gắn việc, nghiệm thu và tính phí cho tháng ấy.

Tự động:

- Mỗi đêm hệ thống mở tháng mới cho các retainer đang chạy và khóa tháng vừa kết thúc.
- Khi tháng kết thúc, phí tháng được chuyển sang **Chờ xuất hoá đơn** — với dự án có khách hàng, chỉ sau khi khách đã ký biên bản nghiệm thu của tháng đó (trang ghi *Chưa chuyển kế toán: đang chờ biên bản nghiệm thu đã ký*).
- Khi một hạng mục dùng tới 80% hoặc 100% hạn mức trong tháng, trưởng dự án và account nhận cảnh báo *Hạn mức retainer* (mỗi mức một lần). Trưởng nhóm có thể thêm quy tắc tự động **Hạn mức retainer chạm mốc** (xem chương **Công việc**).
- Khi giờ đã ghi trong tháng chạm 80% và 100% **Số giờ mỗi tháng**, trưởng dự án và account nhận thông báo *Giờ retainer* (mỗi mức một lần mỗi tháng).

## Yêu cầu thay đổi

Sau khi brief đã duyệt, mọi thay đổi về sản phẩm, giờ, phí hay hạn đi qua tab **Thay đổi**, để luôn trả lời được câu hỏi "ban đầu hứa gì, đã đổi gì, giờ là gì".

Bảng **Ban đầu + thay đổi = hiện tại** cho thấy **Ngân sách giờ**, **Phí** (người được xem phí) và **Hạn dự án** ở mức **Ban đầu**, từng thay đổi đã duyệt, và **Hiện tại**. Nếu có số liệu bị sửa thẳng thay vì qua yêu cầu thay đổi, phần chênh lệch hiện thành một dòng riêng **Sửa trực tiếp, không qua yêu cầu thay đổi**. Với retainer, yêu cầu thay đổi còn có **Định mức hằng tháng của retainer**, **Giờ mỗi tháng** và **Phí mỗi tháng (VND)**.

### Tạo và gửi duyệt

Account hoặc người điều hành dự án:

1. Ở phần **Yêu cầu thay đổi mới**, nhập **Tiêu đề**, chọn **Ai yêu cầu**: **Khách hàng yêu cầu** hoặc **Nội bộ đề xuất**, viết **Mô tả**.
2. Nêu tác động (ít nhất một):
   - **Thêm sản phẩm** (số lượng, tên, định dạng, kênh) và / hoặc **Bỏ sản phẩm** (chọn dòng trong danh mục);
   - **Thay đổi giờ (+/−)**;
   - **Thay đổi phí (VND, +/−)** — chỉ người có quyền thương mại;
   - **Hạn mới của dự án**.
3. Với thay đổi do khách yêu cầu: đính kèm **Tệp bằng chứng** hoặc **Hoặc đường dẫn bằng chứng** (bản chụp email, tin nhắn, biên bản) — bắt buộc.
4. Bấm **Tạo bản nháp**. Có thể **Sửa bản nháp** rồi **Lưu bản nháp**.
5. Bấm **Gửi duyệt**.

### Duyệt

Yêu cầu đi vào hộp **Phê duyệt** của phụ trách dự án (nếu không có thì trưởng nhóm sở hữu). Thay đổi có động tới phí cần thêm một bước duyệt của người có quyền thương mại ở pháp nhân. Người duyệt không phải thành viên dự án chỉ thấy các yêu cầu được gửi tới họ.

Trạng thái: **Nháp**, **Chờ duyệt**, **Đã duyệt**, **Bị từ chối**, **Đã rút**. Khi chờ duyệt, người tạo có thể **Rút lại**; bị trả lại thì sửa và **Gửi duyệt lại**.

Khi được duyệt, thay đổi được **áp dụng ngay**: dòng sản phẩm được thêm (đánh dấu theo thay đổi) hoặc hủy, ngân sách giờ, phí và hạn dự án được cập nhật; yêu cầu ghi *đã áp dụng ngày …*. Người tạo nhận thông báo khi yêu cầu có quyết định.

## Nghiệm thu

Tab **Nghiệm thu** lập **biên bản nghiệm thu** với khách. Việc của khách chỉ được xuất hoá đơn sau khi khách ký biên bản.

### Tạo biên bản

Account hoặc người điều hành dự án:

1. Ở phần **Tạo biên bản nghiệm thu**, chọn **Phạm vi**:
   - **Theo mốc** — chọn một **Mốc (với khách hàng)** (mốc đã tích **Nghiệm thu với khách**);
   - **Theo tháng retainer** — chọn **Tháng**;
   - **Toàn dự án** — mỗi dự án chỉ có một biên bản toàn dự án chưa hủy.
2. Nếu phạm vi chưa có sản phẩm cam kết nào, ghi **Nội dung nghiệm thu** — khách nghiệm thu những gì (khi đã có sản phẩm, đây là ghi chú thêm in trên biên bản).
3. Bấm **Tạo biên bản**.

Biên bản chụp lại danh sách sản phẩm tại thời điểm tạo: mỗi **Hạng mục** với số **Cam kết**, **Đã giao**, **Đã duyệt**, kèm đường dẫn bàn giao và bài đăng. Khi còn là **Nháp**, bấm **Cập nhật số liệu** để chụp lại.

### Gửi, ký, hủy

1. **Tải biên bản (PDF)** — biên bản được dựng từ mẫu văn bản của công ty, có tiêu đề pháp nhân.
2. Gửi cho khách, rồi bấm **Đánh dấu đã gửi** (**Đã gửi khách**). Lúc này bản PDF được phát hành và lưu lại: từ đó **Tải biên bản đã phát hành (PDF)** luôn mở đúng bản đã gửi, kể cả khi mẫu văn bản đổi sau đó. Muốn gửi lại bản mới, bấm **Cập nhật và phát hành lại**.
3. Khi khách ký: mở **Ghi nhận khách đã ký**, tải **Bản scan đã ký**, điền **Ngày ký** (không sau hôm nay) và **Người ký phía khách hàng**, bấm **Xác nhận đã ký**.
4. Biên bản sai trước khi ký: **Huỷ biên bản** (biên bản đã hủy không dùng lại được).
5. Đính nhầm bản scan, ghi sai người ký hay ngày ký sau khi đã ký: mở **Sửa thông tin đã ký**, chọn **Bản scan thay thế (nếu đính nhầm)** nếu cần, ghi **Lý do chỉnh sửa**, bấm **Lưu chỉnh sửa**. Thông tin và bản scan cũ còn trong **Lịch sử chỉnh sửa**. Không sửa được sau khi kế toán đã xuất hoá đơn.

Khi biên bản **Đã ký**, hệ thống chuyển ngay khoản tương ứng sang **Chờ xuất hoá đơn**: khoản của mốc thanh toán, phí của tháng retainer, hoặc — với biên bản toàn dự án — phần phí chưa được xuất theo mốc và tháng. Trưởng dự án, account và kế toán của pháp nhân nhận thông báo *Biên bản nghiệm thu đã ký*.

Phần **Các khoản chuyển kế toán** cuối tab liệt kê các khoản của dự án và trạng thái của chúng. Người có quyền thương mại có thể **Thêm khoản thủ công** tại đây.

## Báo cáo khách hàng

Tab **Báo cáo KH** soạn báo cáo định kỳ gửi khách.

1. Bấm **Báo cáo mới**, chọn **Từ ngày** – **Đến ngày** (kỳ báo cáo); tiêu đề mặc định *Báo cáo … tháng …*.
2. Bấm **Tạo báo cáo**. Số liệu được lấy tự động: **Sản phẩm bàn giao** (*Đã duyệt x/y*, từng dòng), **Bài đã đăng**, **Tiếp cận**, **Tương tác**, **Mốc đã hoàn thành**.
3. Viết **Tóm tắt** và **Kế hoạch kỳ tới**. Tích **Hiện giờ làm trong báo cáo** nếu muốn đưa tổng giờ làm vào.
4. **Lưu báo cáo**; **Sửa báo cáo** khi cần; **Tải PDF** để gửi khách.

> [!NOTE]
> Báo cáo khách hàng không bao giờ có phí; giờ làm chỉ hiện khi bạn chọn. Biên bản nghiệm thu và báo cáo khách hàng vẫn làm được sau khi dự án đã đóng.
