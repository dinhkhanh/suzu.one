# Quản trị KPI

Trang này dành cho **Nhân sự** (vai trò **Quản trị nhân sự**, **Chuyên viên nhân sự**) và **Chủ sở hữu**. Bạn vào bằng thẻ **Quản trị KPI** trong phần **Mục tiêu & KPI**. Bên trong có các thẻ con:

- **Chốt kỳ** — chốt điểm KPI tháng cho từng pháp nhân, mở lại kỳ.
- **Chu kỳ đánh giá** và **Trọng số kết quả** — xem trang **Chu kỳ đánh giá & trọng số kết quả**.
- **Phân bổ** — ai được đo bằng KPI nào, trọng số và chỉ tiêu bao nhiêu.
- **Theo vị trí** — bộ KPI mặc định cho từng vị trí công việc.
- **Thư viện** — danh mục KPI dùng chung cho cả tập đoàn.
- **Nhập từ tệp** — nhập số thực đạt hàng loạt từ bảng tính.

> [!IMPORTANT]
> Trọng số, chỉ tiêu và số thực đạt quyết định điểm KPI, và điểm KPI đi vào thưởng cuối năm. Vì vậy mọi thay đổi đều được ghi nhật ký, và không ai — kể cả Nhân sự — tự phân bổ KPI hay tự nhập số cho chính mình.

## Phạm vi quyền

| Việc | Ai làm được |
|---|---|
| Sửa **Thư viện** KPI | Nhân sự có quyền trên **toàn tập đoàn**. Người khác chỉ xem ("Chỉ Nhân sự cấp tập đoàn mới sửa được thư viện."). |
| Sửa bộ KPI **chung** của một vị trí (Mọi pháp nhân) | Nhân sự toàn tập đoàn. |
| Sửa bộ KPI **riêng** của một pháp nhân | Nhân sự của pháp nhân đó. |
| Phân bổ KPI cho một người | Nhân sự phụ trách người đó, trừ chính mình. |
| Chốt tháng | Nhân sự của pháp nhân đó. |
| Mở lại tháng đã chốt | Chỉ Nhân sự toàn tập đoàn, có lý do. |
| Nhập số từ tệp | Nhân sự, cho những người mình được nhập số (không phải chính mình). |

## Thư viện KPI

[Thư viện](/performance/admin/library) liệt kê mọi KPI, mỗi dòng ghi tên, mã, đơn vị, chiều tốt, tần suất, trần/sàn và (nếu có) "lấy từ công việc: …". KPI ngừng dùng bị gạch ngang. Bấm vào một KPI để xem hoặc sửa.

### Thêm một KPI

Ở khung **KPI mới**:

1. **Mã** — mã ngắn, không dấu (ví dụ dùng trong tệp nhập số).
2. **Tên KPI**.
3. **Đơn vị**: **Số**, **Phần trăm** hoặc **Tiền (VND)**.
4. **Chiều tốt**: **càng cao càng tốt** hoặc **càng thấp càng tốt**.
5. **Tần suất**: **hằng tháng** hoặc **hằng quý** (KPI quý đến hạn ở tháng cuối quý).
6. **Trần mức đạt (%)** và **Sàn mức đạt (%)** — mức đạt vượt trần chỉ tính bằng trần; dưới sàn tính 0. Sàn không được cao hơn trần.
7. **Đang dùng** — bỏ chọn để ngừng dùng KPI (không gán mới được nữa).
8. **Lấy số liệu từ công việc** — chọn một chỉ số công việc nếu muốn hệ thống đề xuất số thực đạt hằng tháng, hoặc **Không — nhập tay**. Đơn vị KPI phải phù hợp với chỉ số (tỷ lệ phần trăm hoặc số lượng/tiền).
9. **Mô tả / cách đo** — ghi rõ nguồn số liệu và cách tính để người nhập số làm đúng.
10. Bấm **Thêm KPI**.

> [!WARNING]
> Khi KPI đã được gán cho ai đó, bạn **không đổi được** mã, đơn vị, chiều tốt và tần suất. Muốn đổi cách đo, hãy tạo KPI mới và ngừng dùng KPI cũ.

## Bộ KPI theo vị trí

[Theo vị trí](/performance/admin/positions) cho biết mỗi vị trí được đo bằng những KPI nào, với trọng số (kèm tỷ lệ phần trăm) và chỉ tiêu mặc định. Bộ riêng của một pháp nhân **thay cho** bộ chung của tập đoàn tại pháp nhân đó.

### Thêm hoặc sửa một dòng

Trong khung **Thêm / cập nhật một dòng**:

1. Chọn **Vị trí** và **Pháp nhân** (hoặc **Mọi pháp nhân** cho bộ chung).
2. Chọn **KPI**, nhập **Trọng số**, **Chỉ tiêu**, **Thứ tự**.
3. Bấm **Lưu dòng**. Lưu lại một KPI đã có trong bộ sẽ cập nhật trọng số và chỉ tiêu của dòng đó.

Nút **Bỏ** gỡ một KPI khỏi bộ của vị trí; các phân bổ đã tạo cho từng người không bị ảnh hưởng.

### Áp dụng bộ KPI cho người giữ vị trí

Trên mỗi bộ có ô chọn tháng và nút **Áp dụng cho người giữ vị trí**:

1. Chọn tháng bắt đầu (**Từ tháng**).
2. Bấm **Áp dụng cho người giữ vị trí**.
3. Hệ thống báo: "… người · tạo … phân bổ · giữ nguyên … · … người chưa có bộ KPI".

"Áp dụng" **không đụng tới** KPI mà người đó đang có: KPI đã được gán thì giữ nguyên. Nếu tháng bắt đầu đã chốt, phân bổ mới bắt đầu từ tháng chưa chốt kế tiếp. Chỉ những người trong phạm vi của bạn được áp dụng.

## Phân bổ KPI cho từng người

[Phân bổ](/performance/admin/assignments) liệt kê mọi người trong phạm vi của bạn với số KPI và tổng trọng số của tháng hiện tại. Người **chưa có KPI** được tô vàng — đây là danh sách cần xử lý đầu kỳ.

Bấm tên một người để mở danh sách KPI của họ: mã, tần suất, khoảng tháng áp dụng, chỉ tiêu, trọng số. Link **Xem bảng điểm** mở bảng điểm KPI của người đó.

### Gán thêm một KPI

Trong khung **Thêm một KPI**: chọn **KPI**, nhập **Trọng số**, **Chỉ tiêu**, **Từ tháng**, rồi bấm **Gán KPI**. Một người không thể có cùng một KPI trong hai khoảng thời gian chồng nhau.

Hoặc dùng khung **Từ bộ KPI của vị trí** → chọn tháng → **Áp dụng bộ KPI của vị trí** để gán cả bộ theo vị trí hiện tại của người đó.

### Sửa trọng số, chỉ tiêu hoặc kết thúc

Mở **Sửa trọng số, chỉ tiêu hoặc kết thúc** dưới một KPI:

- Sửa **Trọng số**, **Chỉ tiêu**, bấm **Lưu**.
- Hoặc chọn **Tháng cuối** rồi bấm **Kết thúc sau tháng này** để ngừng đo KPI đó.

> [!NOTE]
> Khi phân bổ đã có tháng được chốt, trọng số và chỉ tiêu của nó **không sửa được nữa**: hãy kết thúc phân bổ đó và tạo phân bổ mới từ tháng chưa chốt kế tiếp. Không kết thúc được trước một tháng đã có số thực đạt.

## Chốt kỳ (chốt tháng)

Chốt tháng sẽ tính và **lưu** điểm KPI của mọi người trong pháp nhân. Điểm đã lưu không thay đổi; bảng điểm của từng người chuyển từ **Tạm tính** sang **Đã chốt**.

1. Vào [Chốt kỳ](/performance/admin/periods) và chọn tháng. Tháng chưa kết thúc thì chưa chốt được.
2. Mỗi pháp nhân bạn phụ trách là một khung với trạng thái **Tạm tính** / **Đã chốt**.
3. Nếu đủ số liệu: bấm **Chốt tháng** và xác nhận.
4. Nếu còn thiếu, khung ghi "Còn thiếu … số thực đạt". Bạn có hai lựa chọn:
   - Nhắc quản lý nhập cho đủ (hoặc tự nhập ở màn hình **Nhập số thực đạt** / **Nhập từ tệp**), rồi chốt.
   - Ghi **Lý do chốt khi còn thiếu số liệu (các dòng thiếu tính 0 điểm)** rồi bấm **Chốt dù còn thiếu**. Các dòng thiếu tính **0 điểm**; khung ghi lại số dòng thiếu và lý do.
5. Sau khi chốt, khung ghi "chốt ngày …".

### Mở lại kỳ đã chốt

Chỉ Nhân sự toàn tập đoàn: ghi **Lý do mở lại**, bấm **Mở lại kỳ** và xác nhận. Điểm đã lưu chuyển sang "đã thay thế" (người được chấm vẫn xem được trong mục **Các lần chốt trước (đã thay thế)**); lần chốt sau tạo bản mới.

> [!CAUTION]
> Tháng có nhãn **Đã dùng tính thưởng** đã được dùng để tính thưởng cuối năm và **không mở lại được**. Sai sót phải xử lý ở kỳ sau.

## Nhập số thực đạt từ tệp

[Nhập từ tệp](/performance/admin/import) dùng khi số liệu được tổng hợp sẵn trong bảng tính:

1. Bấm **Tải file mẫu**. Mỗi dòng là một người, một KPI, một kỳ, với các cột **Mã nhân viên**, **Mã KPI**, **Kỳ**, **Thực đạt**, **Ghi chú**.
2. Điền **Kỳ**: KPI tháng ghi dạng `2027-01`; KPI quý ghi dạng `2027-Q1`.
3. **Chọn file .xlsx hoặc .csv** rồi bấm **Kiểm tra file**. Hệ thống báo số dòng và các lỗi theo từng dòng; chưa có gì được ghi.
4. Sửa lỗi trong file nếu có, kiểm tra lại. Khi không còn lỗi, bấm **Ghi … dòng vào hệ thống**.

Lưu ý:

- Nhập lại sẽ **ghi đè** số của tháng chưa chốt.
- Tệp có dòng thuộc tháng **đã chốt** sẽ bị **từ chối toàn bộ**.
- Bạn chỉ nhập được cho người mình có quyền nhập số — không có dòng của chính bạn.

## Lịch làm việc gợi ý cho Nhân sự

- [ ] Đầu năm: rà **Thư viện** và bộ KPI **Theo vị trí**; **Áp dụng cho người giữ vị trí** từ tháng 1.
- [ ] Hằng tháng, khi có người mới hoặc đổi vị trí: vào **Phân bổ**, xử lý những người tô vàng.
- [ ] Đầu mỗi tháng: theo dõi số liệu còn thiếu, nhắc quản lý nhập số tháng trước.
- [ ] Sau hạn nhập số nội bộ: **Chốt tháng** cho từng pháp nhân.
