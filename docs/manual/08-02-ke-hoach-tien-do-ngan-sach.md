# Kế hoạch, tiến độ & ngân sách

Trang này hướng dẫn bốn tab giữ "xương sống" của một dự án: **Kế hoạch** (giai đoạn, mốc, baseline), **Tiến độ** (biểu đồ Gantt), **Sản phẩm bàn giao** (cam kết với khách) và **Ngân sách** (giờ đã dùng so với ngân sách). Mọi thành viên dự án đều xem được; **người điều hành dự án** — phụ trách dự án, trưởng nhóm sở hữu, lãnh đạo điều hành nhóm (với dự án không riêng tư) — là người sửa. Sau khi dự án đã đóng, các tab này chỉ còn xem.

## Tab Kế hoạch

### Baseline

Phần **Baseline khi khởi động** so sánh ngày **Bắt đầu**, **Hạn** và **Ngân sách (giờ)** hiện tại với baseline ghi lúc brief được duyệt, kèm nhãn *trễ … ngày* / *sớm … ngày*. Bên dưới là tóm tắt *Công việc so với baseline: … trễ, … đúng hạn, … sớm*, việc **Trễ nhiều nhất** và liên kết **Xem trên biểu đồ tiến độ**. Nếu brief chưa được duyệt, trang báo *Chưa có baseline*.

**Đặt lại baseline** (chỉ phụ trách dự án hoặc trưởng nhóm sở hữu): khi kế hoạch thay đổi lớn và đã được thống nhất (ví dụ *khách hàng dời lịch quay hai tuần*), mở **Đặt lại baseline**, ghi **Lý do**, bấm **Đặt lại baseline**. Ngày hiện tại của dự án, các mốc và mọi công việc trở thành baseline mới; baseline cũ vẫn được lưu trong nhật ký hệ thống.

### Giai đoạn

Mỗi giai đoạn có **Giai đoạn** (tên), **Bắt đầu**, **Kết thúc**, **Ngân sách (giờ)** và **Thứ tự**. Điền dòng trống cuối danh sách rồi bấm **Thêm giai đoạn**; sửa trực tiếp rồi **Lưu**; **Xóa** để bỏ (công việc đã gắn vẫn giữ nguyên).

### Mốc

1. Ở khung trống cuối phần **Mốc**, điền **Mốc**, **Hạn**, **Người chịu trách nhiệm**, **Giai đoạn**, **Thứ tự**.
2. Tích **Nghiệm thu với khách** nếu mốc là điểm khách nghiệm thu; tích **Mốc thanh toán** nếu mốc gắn với một đợt thanh toán — người được xem phí điền thêm **Số tiền thanh toán (VND)**.
3. Bấm **Thêm mốc**.

Mỗi mốc hiện hạn, nhãn **Đã xong** hoặc **Trễ hạn**, độ lệch so với baseline, giai đoạn, người chịu trách nhiệm, tiến độ các công việc đã gắn (*x/y việc xong*) và số dòng sản phẩm thuộc mốc. Mở **Sửa mốc** để sửa, **Đánh dấu xong** / **Mở lại**, hoặc **Xóa**.

> [!NOTE]
> Một **mốc thanh toán** được đánh dấu xong sẽ chuyển một khoản sang **Chờ xuất hoá đơn**. Với dự án có khách hàng, khoản đó chỉ được tạo khi khách đã ký biên bản nghiệm thu cho mốc (xem **Retainer, thay đổi & nghiệm thu**).

Người chịu trách nhiệm và trưởng dự án nhận thông báo buổi sáng khi mốc sắp đến hạn và khi mốc đã trễ.

### Gắn công việc vào kế hoạch

Phần **Gắn công việc vào kế hoạch** cho biết còn bao nhiêu công việc chưa gắn vào mốc, sản phẩm hay giai đoạn nào. Chọn một công việc đang mở, chọn **Mốc**, **Sản phẩm** và / hoặc **Giai đoạn**, bấm **Gắn**. Bấm **Gỡ** cạnh một công việc để bỏ liên kết.

## Tab Tiến độ

**Biểu đồ tiến độ** vẽ giai đoạn, mốc và công việc trên lịch làm việc của nhóm, kèm phụ thuộc và baseline. Mọi người đọc được kế hoạch đều xem được.

Các tùy chọn trên đầu biểu đồ:

- **Nhóm theo**: **Giai đoạn** hoặc **Người thực hiện**.
- **Thang thời gian**: **Ngày** hoặc **Tuần**.
- **Hiện baseline** — thanh viền đứt bên dưới mỗi việc là ngày theo baseline.
- **Đường găng** — làm nổi chuỗi việc quyết định ngày kết thúc dự án.

Cách đọc: ô xám là cuối tuần và ngày nghỉ theo lịch làm việc của nhóm; vạch đỏ đứt là hôm nay; hình thoi là mốc (vàng: sắp tới, đỏ: trễ, xanh: xong); mũi tên là việc phải xong trước, mũi tên đỏ là chỗ đang chồng lên nhau. Việc chưa có ngày không được vẽ (*… công việc chưa có ngày*).

### Dời việc trên biểu đồ

- Kéo thanh để dời cả việc; kéo hai mép để đổi ngày bắt đầu hoặc hạn.
- Bằng bàn phím: chọn một thanh rồi dùng phím mũi tên để dời từng ngày; giữ **Shift** để chỉ đổi hạn; **Enter** để mở việc.
- Nếu việc bạn dời có các việc khác đang chờ nó, hệ thống hỏi: **Dời theo … ngày làm việc** (dời cả chuỗi), **Chỉ dời việc này** (các việc phụ thuộc giữ ngày cũ và sẽ bắt đầu trước khi nó xong), hoặc **Hủy**.

Bạn chỉ kéo được thanh của những việc mình được sửa; nếu trong chuỗi có việc bạn không được sửa, hãy chỉ dời việc của mình hoặc nhờ người phụ trách. Trên điện thoại, biểu đồ chỉ để xem: chạm vào một thanh để mở công việc.

## Tab Sản phẩm bàn giao

**Danh mục sản phẩm bàn giao** là những gì đã hứa với khách, từng dòng một — ví dụ *12 × Bài đăng Facebook*, *2 × Video ngắn*. Đầu trang là tiến độ chung *Đã nghiệm thu x/y (%)*.

Mỗi dòng hiện: số lượng × tên, trạng thái, định dạng, kênh, mốc, hạn, *nghiệm thu x/y · … việc đã gắn*, và số đơn vị ở từng trạng thái: **Đã cam kết**, **Đang sản xuất**, **Xong nội bộ**, **Chờ khách duyệt**, **Đã nghiệm thu**, **Đã bàn giao**, **Đã đăng**, **Đã hủy**. Mỗi đơn vị tương ứng một công việc được gắn vào dòng, và trạng thái được tính từ công việc đó.

Việc đã xong trong nội bộ chưa phải là khách đã nhận: một đơn vị chỉ là **Đã nghiệm thu** khi có quyết định của khách được ghi nhận (hoặc đã giao, đã đăng); trước đó nó là **Xong nội bộ** (*… đã xong nội bộ, chờ khách duyệt*). **Chờ khách duyệt** chỉ khi phiên bản hiện tại đang ở bước khách duyệt hoặc đang có đường dẫn duyệt mở. Dự án nội bộ và pitch được tính nghiệm thu khi việc xong.

> [!NOTE]
> Sau khi duyệt khởi động, thêm hoặc bỏ sản phẩm, đổi số lượng, định dạng hay kênh của một dòng chỉ đi qua **Tạo yêu cầu thay đổi** (tab **Thay đổi**). Tên dòng, mốc và hạn vẫn sửa trực tiếp được.

Người điều hành dự án:

1. **Thêm sản phẩm cam kết**: **Số lượng**, **Sản phẩm** (ví dụ *Bài đăng Facebook*), **Định dạng**, **Kênh**, **Mốc**, **Hạn**, rồi **Thêm dòng**.
2. Mở **Quản lý dòng này** để:
   - **Tạo công việc** cho phần còn thiếu một lần: **Số việc**, **Giao cho**, **Hạn (bỏ trống = theo dòng / mốc)**.
   - Sửa thông tin dòng.
   - **Hủy cam kết** — dòng vẫn ở lại, gạch ngang, và không còn tính vào tiến độ; **Khôi phục** để dùng lại.

> [!TIP]
> Thêm hoặc bỏ sản phẩm sau khi brief đã được duyệt nên đi qua tab **Thay đổi**, để lịch sử *Ban đầu + thay đổi = hiện tại* luôn khớp với những gì khách đồng ý.

## Tab Ngân sách

Phần **Mức dùng ngân sách giờ** cho bốn con số: **Giờ đã ghi**, **Ước tính còn lại** (ước lượng của các việc đang mở), **Dự kiến tổng** và **Ngân sách (giờ)**, kèm thanh tiến độ có vạch mốc 80%. Nhãn màu cho biết mức: *… % ngân sách*, *Đã tới …% ngân sách* hoặc *Vượt ngân sách: …%*.

- Mức dùng = giờ đã ghi + ước tính còn lại của các việc đang mở.
- Trưởng dự án và account nhận cảnh báo khi đạt 80% và 100%, mỗi mức một lần.
- Nếu có, trang hiện **Ngân sách giờ theo vai trò** và **Ngân sách theo giai đoạn**.

Phần **Phí dự án** chỉ hiện với người được xem phí (*Chỉ người có quyền xem thông tin thương mại mới thấy phí dự án*); người có quyền thương mại sửa được **Phí dự án (VND)** tại đây cho đến khi duyệt khởi động; sau đó phí và tổng ngân sách giờ chỉ thay đổi qua yêu cầu thay đổi (vẫn chia lại được tổng giờ giữa các vai trò).

Người điều hành dự án sửa loại dự án, ngân sách giờ, chu kỳ cập nhật và thư mục Drive ở phần **Sửa ngân sách giờ** cuối trang (giống phần thiết lập trên tab **Tổng quan**).
