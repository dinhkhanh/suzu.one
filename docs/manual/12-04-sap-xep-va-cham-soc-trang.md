# Sắp xếp và chăm sóc trang

Kho tri thức chỉ có ích khi nội dung còn đúng và dễ tìm. Trang này dành cho người biên tập và người quản lý không gian: cách chuyển trang trong cây, đổi địa chỉ, giao người phụ trách và hạn rà soát, lưu trữ, gỡ xuất bản, xoá, và lưu trang làm mẫu.

Mọi thao tác dưới đây nằm trong mục **Quản lý trang** — một khung có thể mở ra ở cuối mỗi trang, chỉ hiện với người biên tập.

## Ai làm được gì?

| Thao tác | Ai làm được |
|---|---|
| Đặt **Người phụ trách**, **Rà soát trước ngày** | Người biên tập trang |
| Đổi **Địa chỉ trang** | Người biên tập trang |
| **Chuyển** trang sang trang cha khác, đổi thứ tự | Người biên tập của cả không gian |
| **Giới hạn người xem trang này** | Người biên tập của cả không gian |
| **Lưu trữ** / **Bỏ lưu trữ** | Trang chưa xuất bản: người biên tập. Trang đã xuất bản: người có quyền xuất bản trực tiếp (trong không gian có kiểm soát là người quản lý) |
| **Gỡ xuất bản** | Người có quyền xuất bản trực tiếp |
| **Xoá trang** | Bản nháp chưa từng xuất bản: người biên tập. Trang đã xuất bản: người biên tập của cả không gian có quyền xuất bản trực tiếp |
| **Lưu trang này làm mẫu** | Người quản lý không gian |
| **Bắt buộc đọc và xác nhận** | Người quản lý không gian (xem trang **Xác nhận đã đọc**) |

## Người phụ trách và hạn rà soát

Mỗi trang nên có một **Người phụ trách** — người chịu trách nhiệm giữ nội dung luôn đúng — và một ngày **Rà soát trước ngày**.

1. Mở trang, mở **Quản lý trang**.
2. Chọn **Người phụ trách** và ngày **Rà soát trước ngày**.
3. Bấm **Lưu**.

Ngày rà soát hiện trên đầu trang ("Rà soát trước …") để người đọc biết nội dung được kiểm tra tới khi nào.

**Điều gì xảy ra khi đến hạn:** mỗi sáng hệ thống kiểm tra các trang đã qua ngày rà soát và gửi cho người phụ trách **một** thông báo "Đến hạn rà soát: …", nhắc kiểm tra nội dung còn đúng không và đặt hạn rà soát mới. Khi bạn đặt một ngày mới, hệ thống sẽ nhắc lại vào ngày mới đó. Trang đã lưu trữ hoặc người phụ trách đã nghỉ việc thì không được nhắc.

> [!TIP]
> Với chính sách và quy trình, hãy đặt hạn rà soát 6–12 tháng. Khi rà soát xong mà không cần sửa, chỉ cần đặt ngày rà soát mới.

## Địa chỉ trang

Mỗi trang có địa chỉ dạng `/kb/spaces/<mã không gian>/<đường dẫn trang>`, tạo tự động từ tiêu đề khi bạn tạo trang.

Để đổi:

1. Mở **Quản lý trang**, tìm ô **Địa chỉ trang**.
2. Gõ đường dẫn mới (chữ thường, số và dấu gạch ngang, tối đa 100 ký tự), hoặc bấm **Tạo lại từ tiêu đề** để tạo theo tiêu đề hiện tại.
3. Bấm **Lưu**.

Đổi đường dẫn thì **các liên kết cũ vẫn dẫn về trang này**, nên bạn không làm hỏng liên kết đã gửi đi. Hệ thống từ chối đường dẫn đã có trang khác dùng trong cùng không gian, hoặc trùng với một đường dẫn mà không gian dùng riêng.

> [!NOTE]
> Đổi tiêu đề trang không tự đổi địa chỉ. Nếu muốn địa chỉ khớp tiêu đề mới, bấm **Tạo lại từ tiêu đề** rồi **Lưu**.

## Chuyển trang và sắp xếp thứ tự

1. Mở trang cần chuyển, mở **Quản lý trang**.
2. Chọn **Trang cha** mới (hoặc **(Cấp cao nhất)**).
3. Ô **Vị trí**: số thứ tự giữa các trang cùng cấp (1 = đầu tiên). Để trống = **Cuối**.
4. Bấm **Chuyển**.

Trang được chuyển cùng toàn bộ trang con bên dưới. Bạn không thể chuyển một trang vào chính nó hoặc vào trang con của nó. Chỉ chuyển được trong cùng một không gian.

> [!WARNING]
> Nếu bạn chuyển trang vào dưới một nhánh có **Giới hạn người xem**, trang đó sẽ theo giới hạn của nhánh mới. Hãy kiểm tra lại ai còn đọc được.

## Lưu trữ, gỡ xuất bản và xoá

| Thao tác | Người đọc | Tìm kiếm | Lịch sử | Khôi phục |
|---|---|---|---|---|
| **Gỡ xuất bản** | Không thấy nữa | Không còn | Giữ nguyên | Xuất bản lại |
| **Lưu trữ** | Không thấy nữa | Không còn | Giữ nguyên | **Bỏ lưu trữ** |
| **Xoá trang** | Không thấy nữa | Không còn | — | Không tự khôi phục được |

- **Gỡ xuất bản**: hệ thống hỏi "Gỡ trang khỏi người đọc? Lịch sử phiên bản vẫn được giữ." Trang trở thành bản nháp chỉ người biên tập thấy.
- **Lưu trữ**: dùng cho tài liệu đã hết hiệu lực nhưng cần giữ lại để tra cứu. Trên cây trang của người biên tập, trang lưu trữ bị gạch ngang. Trang lưu trữ không gửi duyệt được: hãy **Bỏ lưu trữ** trước.
- **Xoá trang**: hệ thống hỏi "Xoá trang này?". Trang còn trang con thì không xoá được: hãy chuyển hoặc xoá các trang con trước.

> [!CAUTION]
> Với chính sách đã ban hành, hãy ưu tiên **Lưu trữ** thay vì **Xoá trang**, để còn bằng chứng về nội dung đã từng áp dụng.

## Giới hạn người xem một trang

Bạn có thể giới hạn một trang (và mọi trang con) chỉ cho một nhóm người, dù cả không gian mở cho nhiều người hơn. Xem cách làm ở trang **Không gian và quyền truy cập**, mục "Giới hạn người xem trang này".

## Lưu trang làm mẫu (người quản lý không gian)

Khi bạn đã có một trang trình bày tốt mà muốn mọi người dùng lại cấu trúc:

1. Mở trang, mở **Quản lý trang**.
2. Trong **Lưu trang này làm mẫu**, đặt **Tên mẫu**.
3. Bấm **Lưu làm mẫu**.

Mẫu được lưu theo nội dung hiện tại (bản nháp mới nhất) của trang và xuất hiện trong ô **Bắt đầu từ mẫu** khi bất kỳ ai tạo trang mới, ở mọi không gian. Vì vậy, đừng để thông tin riêng tư hay số liệu cụ thể trong trang trước khi lưu làm mẫu.

## Tài liệu đính kèm trong không gian

Mục **Tài liệu** trên trang không gian gom các tệp đã tải lên các trang, kèm dung lượng, trang chứa tệp và người tải lên, mới nhất trước.

- Người đọc chỉ thấy những tệp đang nằm trong **phiên bản đã xuất bản** của các trang họ đọc được.
- Người biên tập thấy mọi tệp đã tải lên các trang, kể cả tệp chỉ có trong bản nháp.

Muốn người đọc không còn thấy một tệp, hãy mở trang chứa nó, bấm **Sửa**, xoá khối tệp khỏi nội dung rồi xuất bản (hoặc gửi duyệt) lại.
