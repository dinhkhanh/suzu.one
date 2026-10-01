# Viết và sửa trang

Trang này dành cho **người biên tập**: những ai được cấp mức **Biên tập** trong một không gian (hoặc trên một nhánh trang), và người quản lý không gian. Bạn sẽ biết cách tạo trang, bắt đầu từ mẫu, nhập tài liệu có sẵn và dùng trình soạn thảo.

> [!NOTE]
> Nếu bạn không thấy nút **Trang mới** hay **Sửa**, bạn chỉ có quyền xem. Hãy nhờ người quản lý không gian thêm bạn vào danh sách **Ai được vào không gian này** ở mức **Biên tập**.

## Tạo trang mới

1. Mở không gian, bấm **Trang mới**. Hoặc mở một trang có sẵn và bấm **Thêm trang con** để tạo trang nằm ngay dưới nó.
2. Điền:
   - **Tiêu đề** (bắt buộc).
   - **Đường dẫn trang**: tự tạo từ tiêu đề (bỏ dấu, nối bằng gạch ngang), bạn có thể sửa. Chỉ gồm chữ thường, số và dấu gạch ngang.
   - **Trang cha**: chọn trang sẽ chứa trang mới, hoặc **(Cấp cao nhất)**.
   - **Bắt đầu từ mẫu**: **Trang trống** hoặc một mẫu có sẵn (xem bên dưới).
3. Bấm **Tạo và soạn thảo**. Trang được tạo ở dạng **Bản nháp** và mở thẳng vào trình soạn thảo.

> [!TIP]
> Nếu bạn chỉ được cấp quyền biên tập trên một nhánh trang (không phải cả không gian), bạn chỉ tạo được trang con bên dưới nhánh đó: hãy mở trang gốc của nhánh rồi bấm **Thêm trang con**.

### Các mẫu trang có sẵn

Hệ thống có sẵn các mẫu: **Quy trình (SOP)**, **Chính sách / quy định**, **Biên bản họp**, **Tổng kết chiến dịch (post-mortem)**, **Cẩm nang khách hàng (client playbook)**, **Hướng dẫn hội nhập**, **Brief dự án**, **Kịch bản video**, **Danh sách cảnh quay (shot list)**. Người quản lý tri thức có thể lưu thêm mẫu từ một trang bất kỳ (xem trang **Sắp xếp và chăm sóc trang**). Mẫu dùng chung cho mọi không gian.

Chọn mẫu chỉ sao chép nội dung khung vào trang mới; sửa trang sau đó không ảnh hưởng đến mẫu.

## Nhập từ Markdown, Word hoặc Google Docs

Khi đã có tài liệu sẵn, bạn không cần gõ lại:

1. Mở không gian, bấm **Trang mới**, rồi bấm liên kết **Hoặc nhập từ Markdown / Word / Google Docs**.
2. Ở màn hình **Nhập trang**, chọn một trong hai cách:
   - **Tệp**: chọn tệp `.md`, `.txt` hoặc `.docx` (tối đa 3,5 MB).
   - **Nội dung Markdown**: dán văn bản Markdown vào ô.
3. **Tiêu đề trang**: để trống thì hệ thống lấy tiêu đề cấp 1 đầu tiên trong tài liệu, hoặc tên tệp.
4. Chọn **Trang cha** rồi bấm **Nhập thành bản nháp**.
5. Trang mới mở ra trong trình soạn thảo để bạn xem lại trước khi xuất bản.

**Với Google Docs:** trong Google Docs chọn **Tệp → Tải xuống → Markdown (.md)**, rồi chọn tệp vừa tải.

Lưu ý khi nhập:

- Hình ảnh nằm trong tệp Word **không** được nhập. Hãy tải ảnh lên lại trong trình soạn thảo.
- Tiêu đề sâu hơn cấp 3 được đưa về cấp 3.
- Một trích dẫn bắt đầu bằng `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`, `[!WARNING]` hoặc `[!CAUTION]` trở thành khung ghi chú màu.
- Danh sách mà mọi dòng đều là ô tích (`- [ ]`, `- [x]`) trở thành danh sách việc cần làm.
- Liên kết hoặc ảnh không hợp lệ (không phải https) chỉ giữ lại phần chữ.

## Trình soạn thảo

Bấm **Sửa** trên một trang để mở trình soạn thảo. Phía trên cùng là ô **Tiêu đề**, bên dưới là vùng **Nội dung trang**.

### Thanh công cụ

Thanh công cụ luôn nằm trên đầu vùng soạn thảo (dính lại khi bạn cuộn). Rê chuột lên một biểu tượng để xem tên và phím tắt.

| Nút | Phím tắt (Windows: Ctrl, Mac: ⌘) |
|---|---|
| **Hoàn tác** / **Làm lại** | Ctrl+Z / Ctrl+Shift+Z |
| **Kiểu đoạn**: **Văn bản thường**, **Tiêu đề 1**, **Tiêu đề 2**, **Tiêu đề 3** | — |
| **Đậm**, **Nghiêng**, **Gạch chân** | Ctrl+B, Ctrl+I, Ctrl+U |
| **Gạch ngang**, **Tô sáng** | Ctrl+Shift+S, Ctrl+Shift+H |
| **Mã trong dòng** | Ctrl+E |
| **Liên kết** | — |
| **Xoá định dạng** | Ctrl+\ |
| **Căn lề**: **Căn trái**, **Căn giữa**, **Căn phải**, **Căn đều** | — |
| **Danh sách**, **Danh sách đánh số**, **Danh sách việc cần làm** | Ctrl+Shift+8, Ctrl+Shift+7, Ctrl+Shift+9 |
| **Giảm thụt lề** / **Thụt lề** (trong danh sách) | Shift+Tab / Tab |
| **Trích dẫn** | Ctrl+Shift+B |
| **Khối mã** | Ctrl+Alt+C |
| **Đường kẻ** | — |
| **Khung ghi chú** | — |
| **Chèn bảng** (hoặc menu **Bảng** khi con trỏ đang ở trong bảng) | — |
| **Nhúng video / tài liệu**, **Ảnh từ địa chỉ https**, **Tải ảnh hoặc tệp lên** | — |

**Xoá định dạng** đưa đoạn đang chọn về văn bản thường: bỏ đậm, nghiêng, liên kết… và bỏ kiểu tiêu đề, danh sách, trích dẫn.

### Menu nổi khi bôi đen chữ

Khi bạn bôi đen một đoạn chữ, một thanh nhỏ hiện ngay trên vùng chọn với các nút **Đậm**, **Nghiêng**, **Gạch chân**, **Gạch ngang**, **Tô sáng**, **Mã trong dòng**, **Liên kết** và **Xoá định dạng**.

### Chèn khối bằng dấu "/"

Ở đầu một dòng trống, gõ `/` để mở danh sách khối. Gõ tiếp vài chữ để lọc (ví dụ `/bang`, `/table`, `/video`), dùng phím mũi tên và Enter để chọn. Các khối có thể chèn:

- **Văn bản thường**, **Tiêu đề 1**, **Tiêu đề 2**, **Tiêu đề 3**
- **Danh sách**, **Danh sách đánh số**, **Danh sách việc cần làm**
- **Trích dẫn**, **Khối mã**, **Đường kẻ**
- **Chèn bảng**
- Khung ghi chú: **Ghi chú**, **Lưu ý**, **Nên làm**, **Cảnh báo**
- **Ảnh từ địa chỉ https**, **Tải ảnh hoặc tệp lên**, **Nhúng video / tài liệu**

Nếu không có khối nào khớp, menu báo **Không có khối nào khớp**.

### Gõ tắt kiểu Markdown

Bạn có thể định dạng ngay khi gõ, không cần chuột:

| Gõ ở đầu dòng | Kết quả |
|---|---|
| `## ` (dấu thăng + khoảng trắng) | Tiêu đề (số dấu # = cấp tiêu đề) |
| `- ` | Danh sách |
| `1. ` | Danh sách đánh số |
| `[ ] ` | Danh sách việc cần làm |
| `> ` | Trích dẫn |
| ` ``` ` | Khối mã |

### Liên kết

1. Bôi đen chữ cần gắn liên kết, bấm **Liên kết** (trên thanh công cụ hoặc menu nổi).
2. Dán địa chỉ: `https://…`, `mailto:…`, hoặc một đường dẫn trong ứng dụng bắt đầu bằng `/` (ví dụ đường dẫn tới một trang tri thức khác).
3. Bấm **Áp dụng**. Để bỏ liên kết, bấm **Gỡ liên kết**; để thử, bấm **Mở liên kết**.

Địa chỉ không hợp lệ sẽ bị từ chối với thông báo **Chỉ nhận liên kết http(s), mailto hoặc đường dẫn nội bộ bắt đầu bằng /.**

### Khung ghi chú (callout)

Đặt con trỏ vào đoạn cần làm nổi bật, mở menu **Khung ghi chú** và chọn **Ghi chú** (xanh, thông tin), **Lưu ý** (vàng), **Nên làm** (xanh lá) hoặc **Cảnh báo** (đỏ). Chọn **Bỏ khung** để trả về đoạn thường.

### Bảng

- Bấm **Chèn bảng** (hoặc gõ `/` → **Chèn bảng**) để thêm một bảng.
- Khi con trỏ đang ở trong bảng, nút đó thành menu **Bảng** với: **Thêm hàng phía trên**, **Thêm hàng**, **Thêm cột bên trái**, **Thêm cột**, **Bật / tắt hàng tiêu đề**, **Gộp ô** / **Tách ô** (khi chọn nhiều ô hoặc một ô đã gộp), **Xoá hàng**, **Xoá cột**, **Xoá bảng**.

### Ảnh và tệp

Có ba cách đưa ảnh hoặc tệp vào trang:

- Bấm **Tải ảnh hoặc tệp lên** rồi chọn tệp.
- **Dán** ảnh hoặc tệp (Ctrl+V) vào vùng soạn thảo.
- **Kéo thả** tệp vào đúng chỗ muốn đặt.

Ảnh được hiện ngay trong trang; tệp khác hiện thành một dòng đính kèm có tên và dung lượng. Chấp nhận PDF, ảnh (JPG, PNG, WebP), Word (.docx), Excel (.xlsx) và CSV, tối đa 50 MB mỗi tệp. Trong lúc tải, dòng **Đang tải tệp lên…** hiện ở dưới; hãy chờ xong rồi mới lưu.

Muốn dùng ảnh đã có trên mạng, chọn **Ảnh từ địa chỉ https** và dán địa chỉ ảnh (phải bắt đầu bằng https).

> [!NOTE]
> Tệp tải lên thuộc về không gian và tuân theo quyền của không gian: ai đọc được trang thì mở được tệp. Tệp cũng hiện trong mục **Tài liệu** của không gian.

### Nhúng video và tài liệu

Chọn **Nhúng video / tài liệu**, dán địa chỉ YouTube, Google Drive / Docs / Sheets / Slides, Figma hoặc Canva, rồi bấm **Nhúng**. Chỉ các dịch vụ này (với địa chỉ https) được chấp nhận.

### Đếm từ, lưu và rời trang

- Dưới vùng soạn thảo hiển thị số từ và số ký tự.
- **Ctrl/⌘ + S** lưu nháp ngay khi đang gõ.
- Khi có thay đổi chưa lưu, dòng **Có thay đổi chưa lưu** hiện cạnh các nút; sau khi lưu bạn thấy **Đã lưu nháp lúc …**.
- Nếu bạn đóng tab hoặc rời trang khi còn thay đổi chưa lưu, trình duyệt sẽ hỏi lại trước khi rời.

## Lưu nháp, xuất bản hay gửi duyệt?

Cuối trình soạn thảo có:

- Ô **Ghi chú thay đổi (không bắt buộc)** — một câu ngắn mô tả bạn đã sửa gì; nó hiện trong **Lịch sử phiên bản**.
- Ô tích **Thay đổi lớn** — đánh dấu khi nội dung thay đổi đáng kể. Với trang bắt buộc xác nhận, chỉ thay đổi lớn mới yêu cầu mọi người xác nhận lại.
- Nút **Lưu nháp** — lưu mà người đọc chưa thấy gì.
- Nút **Xuất bản** (không gian mở, hoặc bạn là người quản lý) hoặc **Gửi duyệt** (không gian có kiểm soát).

Chi tiết xem trang **Xuất bản và duyệt**.

> [!WARNING]
> Khi trang đang **Đang duyệt**, bạn không sửa được cho tới khi người duyệt quyết định hoặc bạn rút yêu cầu. Màn hình **Sửa** sẽ báo **Trang đang chờ duyệt xuất bản nên tạm thời không sửa được.** kèm liên kết **Xem yêu cầu duyệt**.

## Ô soạn ghi chú ở các phần khác của ứng dụng

Nhiều ô nhập văn bản dài khác trong SuZu One (mô tả công việc, biên bản họp, báo cáo, góp ý, thông báo…) dùng một bộ soạn thảo gọn hơn với các nút **Đậm**, **Nghiêng**, **Gạch ngang**, **Mã trong dòng**, **Liên kết**, **Danh sách**, **Danh sách đánh số**, **Danh sách việc cần làm**, **Trích dẫn**, **Khối mã** và **Xoá định dạng**. Trong các ô này:

- **Ctrl/⌘ + K** mở hộp chèn liên kết.
- **Ctrl/⌘ + Enter** gửi biểu mẫu.
- Bạn gõ tắt kiểu Markdown như trên: `**đậm**`, `- danh sách`, `[ ] việc cần làm`.
