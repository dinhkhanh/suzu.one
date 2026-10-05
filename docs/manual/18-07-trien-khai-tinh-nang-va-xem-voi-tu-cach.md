# Triển khai tính năng & xem với tư cách người khác

Trang này gồm hai công cụ giúp đưa SuZu One tới người dùng một cách an toàn:

- **Triển khai tính năng** — mở một phân hệ cho một nhóm thử nghiệm trước, rồi mới mở cho toàn tập đoàn.
- **Xem với tư cách người khác** — để người hỗ trợ thấy đúng màn hình mà một đồng nghiệp đang thấy khi họ cần giúp đỡ.

## Phần 1 — Triển khai tính năng

### Ai dùng

**Quản trị nhân sự** phạm vi toàn tập đoàn và **Chủ sở hữu**. Mở **Quản trị** → [Triển khai tính năng](/admin/flags).

### Triển khai là gì — và không là gì

Triển khai chỉ quyết định **ai nhìn thấy một phân hệ** trên thanh bên và có thể mở nó. **Quyền hạn bên trong** phân hệ vẫn do vai trò quyết định: mở phân hệ cho một người không cho họ thêm quyền gì. **Quản trị nhân sự** và **Chủ sở hữu** luôn nhìn thấy mọi phân hệ.

### Các phân hệ có thể triển khai

| Phân hệ | Khi tắt |
| --- | --- |
| **Phân hệ Nhân sự** — danh bạ nội bộ và hồ sơ cá nhân | Chỉ bộ phận nhân sự (**Quản trị nhân sự**, **Chuyên viên nhân sự**) và quản trị viên nhìn thấy phân hệ để chuẩn bị dữ liệu. Nhân viên vẫn xem được hồ sơ của chính mình ở **Hồ sơ của tôi**. |

Các phân hệ khác hiện đã mở cho mọi người theo quyền của họ, không cần bật ở đây.

### Mở một phân hệ

Mỗi phân hệ là một khung với hai cách:

1. **Bật cho toàn tập đoàn** — tick ô này để mọi người thấy phân hệ.
2. **Hoặc chỉ bật cho các pháp nhân, phòng ban, cá nhân được chọn:** — tick những **Pháp nhân**, **Phòng ban** (đơn vị) và **Cá nhân** thuộc nhóm thử nghiệm. Chọn một đơn vị là gồm cả các đơn vị bên dưới.

Bấm **Lưu**. Thay đổi có hiệu lực ngay ở lần tải trang kế tiếp của mỗi người.

### Gợi ý quy trình mở phân hệ

1. Bộ phận nhân sự chuẩn bị dữ liệu khi phân hệ còn tắt (chỉ họ thấy).
2. Mở cho một nhóm nhỏ (ví dụ một phòng ban), thu góp ý qua **Góp ý**.
3. Sửa dữ liệu và hướng dẫn theo góp ý.
4. Tick **Bật cho toàn tập đoàn** và gửi thông báo cho mọi người.

## Phần 2 — Xem với tư cách người khác

### Ai dùng được

| Người dùng | Xem được với tư cách ai |
| --- | --- |
| **Hỗ trợ hệ thống** | Những người trong phạm vi được giao (một đơn vị, một pháp nhân hoặc toàn tập đoàn) **không giữ vai trò nào**. |
| **Chủ sở hữu** | Bất kỳ ai, kể cả người đang giữ vai trò. |

Không ai xem được với tư cách chính mình. Người đang giữ vai trò (nhân sự, kế toán, trưởng bộ phận…) chỉ Chủ sở hữu mới xem được với tư cách họ — nếu không, người hỗ trợ sẽ "mượn" được quyền mà họ không được cấp.

Vai trò **Hỗ trợ hệ thống** được cấp ở trang **Phân quyền** — xem trang **Phân quyền & vai trò**.

### Bắt đầu

1. Tìm người cần hỗ trợ trong **Nhân sự** và mở hồ sơ của họ.
2. Bấm **Xem với tư cách người này** (nút chỉ hiện nếu bạn được phép).
3. Bạn thấy ứng dụng đúng như người đó: trang của họ, thanh bên của họ, quyền của họ.

Suốt thời gian đó, đầu mỗi trang có dải: "Bạn đang xem với tư cách … Mọi thao tác được ghi nhận dưới tài khoản của bạn."

### Kết thúc

Bấm **Trở lại tài khoản của tôi** trên dải cảnh báo. Phiên xem thay cũng **tự kết thúc sau tối đa 8 giờ**.

### Những điều cần biết

- **Mọi thao tác** bạn làm trong lúc xem thay được ghi vào **Nhật ký hệ thống** dưới **tài khoản thật của bạn**.
- **Dữ liệu lương**: màn hình lương cần xác thực lại, và bạn **không xác thực lại được** khi đang xem thay ("Việc xác thực lại chỉ dành cho tài khoản của chính bạn — hãy trở lại tài khoản của mình trước"). Người hỗ trợ vì thế không thấy phiếu lương của người khác. Chỉ người mà quyền riêng của họ vốn đã xem được lương của người kia (như Chủ sở hữu) mới mang theo được lần xác thực của mình.
- **Quyền riêng tư của người kia**: khi đang xem thay, bạn không **Tải dữ liệu của tôi**, không trả lời hay rút lại thông báo vị trí khi chấm công, và không rút lại đồng ý chấm công bằng khuôn mặt thay người đó — những lựa chọn này chỉ chính chủ tài khoản làm được.
- Hãy coi xem thay như **vào nhà người khác**: chỉ xem những gì cần để hỗ trợ, tránh thao tác thay người đó trừ khi họ đề nghị.

> [!CAUTION]
> Không dùng xem thay để "kiểm tra" một nhân viên. Công cụ này dành cho hỗ trợ sử dụng ứng dụng; mọi phiên đều để lại dấu vết trong nhật ký.

## Mẹo

- Khi nhân viên báo "tôi không thấy nút X", xem thay là cách nhanh nhất để biết vấn đề là do quyền, do dữ liệu, hay do phân hệ chưa được triển khai cho họ.
- Nếu nguyên nhân là phân hệ chưa mở, kiểm tra **Triển khai tính năng**; nếu là quyền, kiểm tra **Phân quyền**.
