# Mẫu văn bản & mẫu checklist

Hai thư viện mẫu do bộ phận nhân sự quản lý, dùng chung cho nhiều phân hệ:

- **Mẫu văn bản** — hợp đồng, quyết định, giấy xác nhận, thư mời nhận việc, báo giá, biên bản nghiệm thu: văn bản có chỗ trống được điền tự động từ dữ liệu, xuất ra PDF.
- **Mẫu checklist** — các bước tiếp nhận nhân sự mới và thôi việc, tự giao cho đúng người khi có người vào hoặc nghỉ.

Trang này là phần tổng quan dành cho quản trị viên. Hướng dẫn từng thao tác có ở trang **Mẫu văn bản & cấp văn bản** và trang **Checklist tiếp nhận và thôi việc**.

## Ai làm được gì

| Việc | Ai |
| --- | --- |
| Xem thư viện mẫu văn bản, tạo và sửa mẫu | Người quản lý hồ sơ nhân sự: **Quản trị nhân sự**, **Chuyên viên nhân sự**, **Chủ sở hữu**. Mẫu của một pháp nhân cần phạm vi bao trùm pháp nhân đó; mẫu **dùng chung toàn nhóm** cần phạm vi toàn tập đoàn. |
| Soạn mẫu checklist tiếp nhận / thôi việc | Như trên. |
| Cấp văn bản cho một người | Nhân sự có quyền xem dữ liệu ở mức nhạy cảm mà mẫu yêu cầu. |

## Phần 1 — Mẫu văn bản

Mở **Quản trị** → [Mẫu văn bản](/admin/document-templates). Bảng liệt kê **Mã mẫu**, **Tên mẫu**, **Loại** (Hợp đồng, Quyết định, Giấy xác nhận, Thư mời nhận việc, Văn bản khác), **Pháp nhân**, **Mức nhạy cảm**, **Phiên bản**. Bấm **Tạo mẫu mới** để thêm.

### Mức nhạy cảm của mẫu — quy tắc quan trọng nhất

Mỗi trường có thể chèn vào mẫu thuộc một mức nhạy cảm:

| Nhóm trường | Ví dụ | Mức |
| --- | --- | --- |
| Công ty, văn bản | `{{company.name}}`, `{{document.number}}`, `{{document.date}}` | Nội bộ |
| Nhân sự, quan hệ lao động | `{{person.fullName}}`, `{{person.position}}`, `{{employment.startDate}}` | Cá nhân |
| Thông tin hạn chế | `{{person.dateOfBirth}}`, `{{person.gender}}` | Hạn chế |
| Lương | `{{salary.base}}`, `{{salary.total}}`, `{{salary.totalInWords}}` | Lương thưởng |
| Dự án, nghiệm thu, báo giá | `{{project.name}}`, `{{acceptance.items}}`, `{{quote.number}}` | Nội bộ |

**Mức nhạy cảm của mẫu phải đủ cao** cho những trường mà nội dung in ra. Trình soạn mẫu cho biết "Nội dung hiện tại cần mức nhạy cảm tối thiểu: …" và **từ chối lưu** nếu mức đang chọn thấp hơn. Nhờ vậy, một mẫu có in lương không bao giờ được cấp bởi người không được xem lương.

Hệ thống cũng từ chối lưu mẫu có trường gõ sai ("Không nhận diện được: …"). Danh sách đầy đủ các trường nằm trong mục **Danh sách trường có thể chèn** của trình soạn mẫu.

### Thông tin đầu thư

Mỗi mẫu có **Thông tin đầu thư**: **Tên công ty**, **Địa chỉ**, **Mã số thuế**, **Điện thoại**, **Người đại diện**, **Chức vụ người đại diện**, **Nơi lập văn bản**. Với các văn bản gửi khách (như báo giá), tên pháp lý, địa chỉ, mã số thuế và người đại diện lấy từ **pháp nhân** ký — vì vậy hãy điền đủ thông tin ở trang **Pháp nhân** (xem trang **Pháp nhân & cơ cấu tổ chức**).

### Các mẫu mà phân hệ khác dùng

Một số phân hệ dùng mẫu trong thư viện này. Bạn có thể sửa lời văn của chúng như mọi mẫu khác:

- **Thư mời nhận việc** (loại Thư mời nhận việc) — chọn khi soạn thư mời trong **Tuyển dụng**.
- **Báo giá** — dựng PDF báo giá gửi khách trong **Khách hàng & kinh doanh**.
- **Biên bản nghiệm thu** — dựng biên bản nghiệm thu của dự án.

> [!WARNING]
> Đừng bỏ tick **Đang sử dụng** ở các mẫu mà phân hệ khác đang dùng (báo giá, biên bản nghiệm thu): tài liệu tương ứng sẽ không dựng đúng nữa. Chỉ sửa lời văn. (Mã mẫu không đổi được sau khi tạo.)

### Phiên bản

Mỗi lần lưu, phiên bản của mẫu tăng thêm một. Mỗi văn bản đã cấp ghi lại mẫu và phiên bản đã dùng. Bỏ tick **Đang sử dụng** để ngừng cấp một mẫu mà không xoá nó.

## Phần 2 — Mẫu checklist tiếp nhận và thôi việc

Các mẫu này nằm ở [Checklist](/checklists) (thanh bên, phần **Công việc**), phần **Tiếp nhận & thôi việc** — chỉ hiện với nhân sự. Đường dẫn quản trị cũ cũng tự chuyển tới đây.

Điểm cần biết khi thiết kế:

- Mỗi mẫu dùng cho **Tiếp nhận nhân sự** hoặc **Thôi việc**, và áp dụng cho một **Pháp nhân**, **Phòng ban**, **Vị trí** (hoặc tất cả).
- Khi có người vào / nghỉ, hệ thống chọn **một** mẫu phù hợp nhất theo thứ tự **vị trí > phòng ban > pháp nhân > toàn tập đoàn**.
- Mỗi bước được giao cho **Chính nhân sự đó**, **Quản lý trực tiếp**, **Một người cụ thể** hoặc **Nhân sự phụ trách (HR)**, với hạn tính theo số ngày so với ngày mốc (ngày vào làm / ngày làm việc cuối).
- Khi một ứng viên được chuyển thành nhân viên từ thư mời nhận việc, checklist tiếp nhận được mở tự động.

Hướng dẫn chi tiết: trang **Checklist tiếp nhận và thôi việc**.

## Mẹo

- Nhờ bộ phận pháp chế rà soát mẫu hợp đồng và quyết định trước khi đưa vào dùng; các mẫu có sẵn chỉ là bản nháp tham khảo.
- Đặt mẫu ở **mức nhạy cảm thấp nhất có thể**: một giấy xác nhận công tác không cần in lương, nên để ở mức Cá nhân để nhiều người trong nhân sự cấp được.
- Gắn trang hướng dẫn trong **Tri thức** vào các bước checklist để người làm không phải hỏi lại.
