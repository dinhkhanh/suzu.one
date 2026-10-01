# Quản trị hệ thống

Chương này dành cho **quản trị viên**: những người thiết lập "khung" của SuZu One để mọi phân hệ khác chạy đúng — các pháp nhân, cây tổ chức, ai giữ vai trò gì, ai duyệt loại yêu cầu nào, các tham số pháp định, những phân hệ đang mở cho ai, và nơi theo dõi mọi thay đổi trong hệ thống.

Mọi mục quản trị nằm ở phần **Quản trị** cuối thanh bên. Bạn chỉ thấy những mục mình có quyền dùng; người không có quyền nào ở đây sẽ không thấy phần **Quản trị**.

## Ai là quản trị viên

Không có một vai trò "admin" duy nhất. Mỗi mục quản trị thuộc về người phù hợp:

| Vai trò | Phần việc quản trị |
| --- | --- |
| **Chủ sở hữu** | Mọi thứ. Là người **duy nhất** cấp và thu hồi vai trò, duyệt tham số pháp định, duyệt quy chế lương thưởng và hoa hồng, và xem với tư cách một người đang giữ vai trò. |
| **Quản trị nhân sự** | Pháp nhân, cơ cấu tổ chức, luồng phê duyệt, loại đề nghị, mẫu văn bản, triển khai tính năng (nếu được giao toàn tập đoàn); đề xuất tham số pháp định; đọc nhật ký hệ thống. |
| **Chuyên viên nhân sự** | Xem pháp nhân và cơ cấu; soạn mẫu văn bản và mẫu checklist. |
| **C&B / Tiền lương** | Đề xuất tham số pháp định. |
| **Kiểm toán (chỉ xem)** | Đọc nhật ký hệ thống và tác vụ tự động. |
| **Hỗ trợ hệ thống** | Xem với tư cách một nhân viên (không giữ vai trò) để hỗ trợ họ. |
| Các vai trò khác | Xem danh sách pháp nhân và cây tổ chức (chỉ xem). |

Phạm vi vẫn áp dụng: một **Quản trị nhân sự** được giao một pháp nhân chỉ quản trị được pháp nhân đó; những thứ dùng chung toàn tập đoàn (đơn vị dùng chung, luồng phê duyệt của cả tập đoàn, triển khai tính năng…) cần phạm vi toàn tập đoàn.

## Bạn muốn… → Vào đâu

| Bạn muốn… | Vào đâu |
| --- | --- |
| Thêm hoặc sửa một công ty trong tập đoàn | [Pháp nhân](/admin/entities) |
| Thêm phòng ban, nhóm; đổi cấp trên của một đơn vị | [Cơ cấu tổ chức](/admin/org) |
| Nhập phòng ban hàng loạt từ Excel / CSV | [Cơ cấu tổ chức](/admin/org) → **Nhập phòng ban từ Excel / CSV** |
| Cấp hoặc thu hồi vai trò cho một người | [Phân quyền](/admin/roles) |
| Đổi người duyệt của một loại yêu cầu | [Luồng phê duyệt](/admin/approval-flows) |
| Tạo một loại đề nghị mới (mua sắm, tạm ứng…) | [Loại đề nghị](/admin/request-types) |
| Soạn mẫu hợp đồng, quyết định, giấy xác nhận | [Mẫu văn bản](/admin/document-templates) |
| Soạn mẫu checklist tiếp nhận / thôi việc | [Checklist](/checklists) |
| Cập nhật lương tối thiểu vùng, biểu thuế, tỷ lệ bảo hiểm… | [Tham số pháp định](/admin/rules) |
| Mở một phân hệ cho nhóm thử nghiệm | [Triển khai tính năng](/admin/flags) |
| Xem ai đã thay đổi gì | [Nhật ký hệ thống](/admin/audit) |
| Kiểm tra các tác vụ chạy theo lịch | [Tác vụ tự động](/admin/jobs) |
| Xem màn hình như một nhân viên thấy để hỗ trợ họ | Hồ sơ người đó → **Xem với tư cách người này** |
| Xử lý góp ý về SuZu One | [Hộp thư góp ý](/feedback/inbox) — xem trang **Xử lý hộp thư góp ý** |

## Tổng quan các màn hình quản trị

| Màn hình (thanh bên) | Dùng để | Trang hướng dẫn |
| --- | --- | --- |
| **Pháp nhân** | Danh sách công ty trong tập đoàn: mã, tên pháp lý, MST, vùng lương, chi nhánh. | **Pháp nhân & cơ cấu tổ chức** |
| **Cơ cấu tổ chức** | Cây đơn vị: phòng ban, nhóm lớn, nhóm nhỏ, sâu bao nhiêu cấp cũng được. | **Pháp nhân & cơ cấu tổ chức** |
| **Triển khai tính năng** | Mở từng phân hệ cho một nhóm thử nghiệm rồi cho toàn tập đoàn. | **Triển khai tính năng & xem với tư cách người khác** |
| **Mẫu văn bản** | Hợp đồng, quyết định, giấy xác nhận, thư mời nhận việc. | **Mẫu văn bản & mẫu checklist** |
| **Luồng phê duyệt** | Ai duyệt từng loại yêu cầu, theo pháp nhân. | **Luồng phê duyệt & loại đề nghị** |
| **Loại đề nghị** | Thiết kế biểu mẫu và luồng duyệt cho đề nghị tự định nghĩa. | **Luồng phê duyệt & loại đề nghị** |
| **Phân quyền** | Cấp, thu hồi vai trò kèm phạm vi và thời hạn. | **Phân quyền & vai trò** |
| **Tham số pháp định** | Tỷ lệ bảo hiểm, thuế, lương tối thiểu… có ngày hiệu lực. | **Tham số pháp định** |
| **Nhật ký hệ thống** | Mọi thay đổi, mọi lần bị từ chối, mọi tác vụ tự động. | **Nhật ký hệ thống & tác vụ tự động** |
| **Tác vụ tự động** | Lịch sử các lần chạy tác vụ theo lịch. | **Nhật ký hệ thống & tác vụ tự động** |
| **Hộp thư góp ý** | Góp ý của người dùng về SuZu One. | **Xử lý hộp thư góp ý** |

## Nguyên tắc chung cần nhớ

- **Từ chối mặc định.** Không ai có quyền gì nếu không được cấp vai trò rõ ràng. Tên miền email (công ty nào) không tự cho quyền gì.
- **Ẩn khỏi menu không phải là chặn.** Mọi trang và mọi thao tác đều tự kiểm tra quyền lại; một đường dẫn bị chia sẻ cũng không mở được nếu người xem không có quyền.
- **Thu hồi có hiệu lực ngay** ở thao tác kế tiếp của người đó.
- **Không con số pháp định nào nằm trong mã nguồn.** Mọi tỷ lệ, mức trần, biểu thuế, ngày lễ đều là tham số có ngày hiệu lực.
- **Nhật ký chỉ ghi thêm.** Không ai sửa hay xoá được nhật ký hệ thống, kể cả chủ sở hữu.
- **Dữ liệu nhạy cảm theo bốn mức** — xem trang **Phân quyền & vai trò**.

## Các trang trong chương này

- **Pháp nhân & cơ cấu tổ chức**
- **Phân quyền & vai trò**
- **Luồng phê duyệt & loại đề nghị**
- **Mẫu văn bản & mẫu checklist**
- **Tham số pháp định**
- **Nhật ký hệ thống & tác vụ tự động**
- **Triển khai tính năng & xem với tư cách người khác**
