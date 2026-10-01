# Mẫu thư & báo cáo tuyển dụng

Trang này gồm hai công cụ của bộ phận tuyển dụng: **mẫu email gửi ứng viên** (lời lẽ chung của cả tập đoàn) và **báo cáo tuyển dụng** (phễu, thời gian tuyển, hiệu quả từng nguồn).

## Phần 1 — Mẫu email gửi ứng viên

### Ai sửa được

Mẫu thư là lời lẽ chung của cả tập đoàn, nên chỉ người làm tuyển dụng có phạm vi **toàn tập đoàn** mới vào được trang này (nút **Gửi email cho ứng viên** trên trang [Tuyển dụng](/recruit)). Người tuyển dụng của một pháp nhân dùng các mẫu để gửi thư, nhưng không sửa được nội dung.

### Các mẫu có sẵn

Hệ thống có sẵn ba mẫu, được viết như bản nháp để nhân sự chỉnh lại theo giọng văn của công ty:

| Mẫu | Loại | Dùng khi |
| --- | --- | --- |
| **Mời phỏng vấn** | Mời phỏng vấn | Báo ứng viên được mời vào một vòng tiếp theo. |
| **Từ chối sau khi xem hồ sơ** | Từ chối | Cảm ơn và báo ứng viên không phù hợp. |
| **Thư báo đề nghị tuyển dụng** | Đề nghị tuyển dụng | Báo ứng viên rằng công ty sắp gửi thư mời. |

### Sửa hoặc thêm một mẫu

1. Mở [Gửi email cho ứng viên](/recruit/emails).
2. Mỗi mẫu là một khung riêng với các ô **Mã**, **Tên**, **Loại** (Mời phỏng vấn, Từ chối, Đề nghị tuyển dụng, Chung), **Tiêu đề** và **Nội dung** bằng tiếng Việt (vi) và tiếng Anh (en), và ô **Đang dùng**.
3. Sửa nội dung rồi bấm **Lưu**.
4. Để thêm mẫu, điền khung **Thêm mẫu thư mới** ở cuối trang.

Bỏ tick **Đang dùng** để ẩn một mẫu khỏi danh sách chọn khi gửi thư mà không xoá nó.

### Trường thay thế

Trong tiêu đề và nội dung, bạn có thể chèn các trường sau, viết trong hai cặp ngoặc nhọn. Khi gửi, hệ thống thay bằng thông tin thật:

| Trường | Được thay bằng |
| --- | --- |
| `{{candidate_name}}` | Tên ứng viên |
| `{{job_title}}` | Tên vị trí |
| `{{company_name}}` | Tên công ty (pháp nhân của vị trí) |
| `{{stage_name}}` | Tên vòng hiện tại của hồ sơ |
| `{{sender_name}}` | Tên người gửi thư |
| `{{careers_url}}` | Đường dẫn trang tuyển dụng |

Hệ thống từ chối lưu mẫu có trường gõ sai (ví dụ `{{candidat_name}}`), để không có thư nào đến tay ứng viên với một chỗ trống kỳ lạ.

> [!NOTE]
> Không có trường nào cho **mức lương**: con số chỉ được nằm trong thư mời nhận việc, là văn bản có kiểm soát quyền xem. Đừng gõ mức lương vào mẫu thư.

Cách gửi thư từ một hồ sơ ứng tuyển được mô tả ở trang **Ứng viên & quy trình tuyển**.

## Phần 2 — Báo cáo tuyển dụng

### Ai xem được

Người làm tuyển dụng, và người có quyền xem báo cáo (Ban điều hành, Giám đốc pháp nhân, Trưởng bộ phận, Quản trị nhân sự, Kiểm toán…). Mỗi người chỉ thấy số liệu của **những vị trí mình được xem**: một trưởng bộ phận đang tuyển một vị trí thấy phễu của đúng vị trí đó; người không xem được vị trí nào thấy báo cáo trống.

Mở từ nút **Báo cáo tuyển dụng** trên trang [Tuyển dụng](/recruit), hoặc trực tiếp [Báo cáo tuyển dụng](/recruit/reports).

### Bộ lọc

- **Từ ngày** – **Đến ngày**: khoảng thời gian tính theo ngày ứng tuyển.
- **Vị trí**: một vị trí cụ thể, hoặc **Tất cả vị trí**.
- Bấm **Xem**.

### Các con số

- Ô tổng: số **Hồ sơ**, **Vị trí đang tuyển**, **Đã tuyển**, **Đang tiến hành**.
- **Phễu tuyển dụng**: với mỗi bước (Hồ sơ mới, Sàng lọc, Phỏng vấn, Bài test, Đề nghị, Nhận việc) — số hồ sơ **Đạt tới**, tỷ lệ **So với bước trước** và **So với tổng hồ sơ**. Một hồ sơ bị từ chối vẫn nằm ở bước nó dừng lại, nên bảng này cho biết ứng viên rơi ở đâu.
- **Thời gian tuyển**: số ngày từ lúc ứng tuyển tới lúc được tuyển — **Trung vị**, **Trung bình**, **Nhanh nhất**, **Chậm nhất**.
- **Hiệu quả theo nguồn**: với mỗi nguồn (Trang tuyển dụng, Giới thiệu nội bộ, Trang việc làm, Mạng xã hội…) — số hồ sơ, số **Vào phỏng vấn**, số **Đã tuyển**, **Tỷ lệ tuyển** và **Trung vị (ngày)**.

> [!NOTE]
> Chi phí trên mỗi lượt tuyển chưa được tính, vì hệ thống chưa ghi nhận chi phí tuyển dụng.

### Đọc báo cáo thế nào

- Tỷ lệ rơi lớn ở bước **Sàng lọc** thường là dấu hiệu tin tuyển dụng thu hút sai đối tượng — xem lại phần yêu cầu.
- Rơi lớn ở bước **Đề nghị** nghĩa là ứng viên từ chối thư mời — xem lý do từ chối trên từng thư mời.
- Nguồn có tỷ lệ tuyển cao và thời gian ngắn là nơi nên đầu tư thêm (ví dụ chương trình **Giới thiệu ứng viên**).
- Dữ liệu ứng viên đã bị ẩn danh vẫn được đếm trong báo cáo, nhưng không còn gắn với ai.
