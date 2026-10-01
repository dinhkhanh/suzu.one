# Thư viện nghĩa vụ

**Thư viện nghĩa vụ** chứa các *mẫu* mà hệ thống dùng để sinh nghĩa vụ: tên, chu kỳ, cách tính hạn, ai phụ trách, các bước, chứng từ bắt buộc, hướng dẫn và cách nhắc. Sửa thư viện là cách đúng để thay đổi lâu dài cách công ty theo dõi tuân thủ.

[Mở Thư viện](/ops/templates)

## Ai làm được gì

- **Xem thư viện**: mọi người có vai trò xem hoặc quản lý nghĩa vụ. Bấm vào một mẫu để xem hướng dẫn, các bước và hậu quả nếu trễ.
- **Thêm, sửa, rà soát mẫu**: chỉ người được phân quyền quản lý nghĩa vụ cho **toàn tập đoàn** (không giới hạn ở một pháp nhân) — thường là Quản trị nhân sự và Chủ sở hữu. Thư viện dùng chung cho mọi pháp nhân, nên người chỉ quản lý một pháp nhân không sửa được.

## Đọc danh sách mẫu

Mẫu được chia hai nhóm **Nội bộ** và **Với cơ quan nhà nước**. Mỗi dòng ghi tên mẫu và một dòng phụ gồm: mã, chu kỳ, quy tắc tính hạn và cơ quan. Ví dụ "EXT-VAT-MONTHLY · Hằng tháng · ngày 20 của tháng thứ +1 sau kỳ · Cơ quan thuế".

Các nhãn bên phải:

- **Tắt** — mẫu không còn sinh nghĩa vụ mới (tên bị gạch).
- **Đã rà soát …** — ngày mẫu được xác nhận.
- **Quy tắc chưa rà soát** — mẫu chưa ai xác nhận. Đầu trang ghi "Còn …/… mẫu chưa được rà soát."

> [!IMPORTANT]
> Thư viện khởi tạo là **bản nháp** dựa trên thực tế phổ biến, không phải tư vấn pháp lý. Mỗi mẫu cần Kế toán trưởng (với nghĩa vụ thuế, tài chính) hoặc Trưởng phòng Nhân sự (với nghĩa vụ lao động, bảo hiểm) đối chiếu với quy định hiện hành rồi mới đánh dấu đã rà soát.

## Rà soát một mẫu

1. Bấm vào mẫu để mở.
2. Kiểm tra quy tắc tính hạn, người phụ trách, chứng từ bắt buộc, hướng dẫn.
3. Hoặc sửa rồi tích ô **Tôi đã kiểm tra quy tắc này — đánh dấu đã rà soát** trước khi bấm **Lưu**, hoặc nếu không cần sửa gì, bấm **Đánh dấu đã rà soát** ở góc trên của mẫu.

Muốn đưa mẫu về trạng thái cần xem lại, bấm **Trả về chưa rà soát**.

> [!NOTE]
> Mỗi lần bạn **Lưu** một mẫu mà không tích ô đánh dấu đã rà soát, mẫu tự trở về **Quy tắc chưa rà soát** — vì quy tắc đã đổi thì cần được xác nhận lại.

## Tạo hoặc sửa mẫu

Mẫu mới: dùng khung **Mẫu mới** ở cuối trang. Sửa mẫu: bấm vào mẫu để mở biểu mẫu của nó. Các ô:

### Thông tin chung

- **Mã** — viết hoa, chữ số và gạch nối, ví dụ `EXT-UNION-FEE`. Không được trùng mẫu khác.
- **Tên** — hiện trên mọi nghĩa vụ sinh ra (kèm kỳ / tên nhân viên và mã pháp nhân).
- **Nhóm** — **Nội bộ** hoặc **Với cơ quan nhà nước**.
- **Cơ quan** — Cơ quan thuế, Bảo hiểm xã hội, Sở Lao động, Cục Thống kê, Công đoàn, Cấp phép, Nội bộ, Khác.

### Chu kỳ và hạn

- **Chu kỳ** — **Hằng tháng**, **Hằng quý**, **Nửa năm**, **Hằng năm** (năm tài chính tính theo năm dương lịch), hoặc **Theo sự kiện nhân sự**.
- **Quy tắc tính hạn**:
  - **Sau khi kỳ kết thúc** — nhập **Số tháng sau khi kỳ kết thúc** (0–12) và **Ngày (1–31 hoặc "last")**. Ví dụ "ngày 20 của tháng sau" = 1 tháng, ngày 20. "Ngày cuối của tháng thứ 3 sau năm" = 3 tháng, `last`.
  - **Trong kỳ** — nhập **Tháng thứ mấy của kỳ** và **Ngày**. Ví dụ "ngày 30 tháng 1 hằng năm" = tháng 1, ngày 30; "ngày cuối của tháng" (theo tháng) = tháng 1, `last`.
  - **Sau sự kiện** (chỉ cho chu kỳ theo sự kiện) — chọn **Sự kiện nhân sự** và nhập **Số ngày sau sự kiện** (tối đa 366; số âm nghĩa là *trước* sự kiện, như mẫu gia hạn bản quyền đặt -14).
- Ngày mà tháng không có (ví dụ 30 tháng 2) được hiểu là ngày cuối tháng.
- **Nếu hạn rơi vào ngày nghỉ** — **Ngày làm việc kế tiếp**, **Ngày làm việc liền trước** (ví dụ chi lương phải trước ngày nghỉ) hoặc **Không dời**. Ngày nghỉ lấy theo lịch làm việc của từng pháp nhân.

### Phạm vi và người

- **Áp dụng cho** — tích các pháp nhân áp dụng. Không chọn = mọi pháp nhân.
- **Người phụ trách là** — **Người giữ một vai trò** (ví dụ Tài chính – Kế toán), **Người giữ một quyền**, hoặc **Một người cụ thể**. Với vai trò / quyền, chọn ở ô **Vai trò / quyền**; với một người, chọn ở ô **Một người cụ thể**. Danh sách quyền hiển thị theo mã quyền; nếu không chắc, hãy chọn theo vai trò.
- **Người kiểm tra là** — như trên, thêm lựa chọn **Không có**. Người kiểm tra luôn khác người phụ trách.

Khi sinh nghĩa vụ, hệ thống lấy người đang giữ vai trò / quyền đó *trong pháp nhân* trước, rồi đến người giữ cho toàn tập đoàn; bỏ qua người đã nghỉ việc và bỏ qua chính nhân viên mà sự kiện nói tới. Không tìm được ai thì nghĩa vụ **Chưa có người phụ trách**.

### Nội dung hướng dẫn

- **Các bước (mỗi dòng một bước)** — thành danh sách đánh dấu trên nghĩa vụ. Mọi bước phải được tích trước khi đóng.
- **Hướng dẫn** — cách làm, căn cứ, lưu ý.
- **Liên kết (Tiêu đề | https://…, mỗi dòng một liên kết)** — ví dụ `Cổng BHXH | https://...`. Liên kết phải bắt đầu bằng `https://`.
- **Hậu quả nếu trễ hạn** — hiện bằng chữ đỏ dưới dòng **Nếu trễ:**.

### Nhắc và báo lên cấp trên

- **Nhắc trước hạn (số ngày)** — các số cách nhau bằng dấu phẩy, ví dụ `7, 3, 1` (0–120).
- **Báo lên quản lý sau (ngày quá hạn)** — mặc định 3.
- **Báo lên Giám đốc tài chính / Chủ sở hữu sau (ngày quá hạn)** — mặc định 7; không được nhỏ hơn mốc báo lên quản lý.

### Chứng từ và trạng thái

- **Bắt buộc để đóng** — tích những gì phải có trước khi đóng: **Tệp chứng từ**, **Số tham chiếu**, **Ngày nộp**, **Số tiền đã nộp**.
- **Đang dùng** — bỏ tích để tắt mẫu.

Bấm **Tạo** (mẫu mới) hoặc **Lưu** (mẫu có sẵn).

## Thay đổi có ảnh hưởng gì tới nghĩa vụ đã sinh?

- **Hạn** và **người phụ trách** của các nghĩa vụ đã sinh **không đổi** khi bạn sửa mẫu. Muốn đổi người cho một nghĩa vụ đã có, giao lại trên chính nghĩa vụ đó (xem **Điều phối nghĩa vụ**).
- **Các bước**, **chứng từ bắt buộc**, **hướng dẫn**, **liên kết**, mốc **nhắc** và **báo lên cấp trên** được đọc từ mẫu hiện tại, nên áp dụng ngay cho cả các nghĩa vụ đang mở.
- **Tắt** mẫu chỉ dừng sinh kỳ mới; các nghĩa vụ đã sinh vẫn còn. Hủy các kỳ không cần bằng **Không áp dụng**.
- Mẫu mới hoặc quy tắc mới sinh nghĩa vụ ở lần chạy tự động kế tiếp, hoặc ngay khi bạn bấm **Đồng bộ ngay**.

> [!TIP]
> Một số mẫu trong thư viện khởi tạo được để **Tắt** sẵn vì chỉ áp dụng cho một số pháp nhân (ví dụ tờ khai thuế GTGT quý, báo cáo sử dụng hóa đơn, kiểm toán độc lập, rà soát giấy phép lao động người nước ngoài). Hãy bật và giới hạn **Áp dụng cho** đúng pháp nhân cần.
