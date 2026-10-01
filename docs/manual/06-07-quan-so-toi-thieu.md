# Quân số tối thiểu

**Quân số tối thiểu** là số người ít nhất của một nhóm hoặc phòng ban phải đi làm mỗi ngày. Khi một đơn nghỉ khiến nhóm xuống dưới mức này, hệ thống **cảnh báo** người xin nghỉ và người duyệt. Đơn **không bị chặn** — quyết định vẫn thuộc về người duyệt.

Trang dành cho nhân sự có quyền quản lý nghỉ phép. Vào [Quản lý nghỉ phép → Quân số tối thiểu](/leave/admin/staffing).

## Xem các quy định đang có

Mỗi dòng là một quy định, ghi phạm vi (nhóm · phòng ban · pháp nhân, hoặc **Mọi pháp nhân**) và mức "tối thiểu … người có mặt". Nếu chưa có gì, trang ghi **Chưa có quy định nào.**

## Thêm hoặc đổi một quy định

1. Trong khung **Thêm quy định**, chọn:
   - **Áp dụng cho** — một pháp nhân, hoặc **Mọi pháp nhân** (chỉ nhân sự được phân quyền toàn tập đoàn).
   - **Phòng ban** và/hoặc **Nhóm** — phải chọn ít nhất một ("Chọn phòng ban hoặc nhóm.").
   - **Tối thiểu có mặt** — số người tối thiểu.
2. Bấm **Lưu**.

Lưu lại một quy định với **cùng phạm vi** (cùng pháp nhân, phòng ban, nhóm) sẽ cập nhật con số thay vì tạo dòng mới. Muốn bỏ quy định, bấm **Xoá** ở dòng đó và xác nhận "Xoá dòng này?".

## Quy định nào áp dụng cho một người

Với mỗi người xin nghỉ, hệ thống tìm một quy định theo thứ tự:

1. Quy định của **nhóm** người đó, nếu có.
2. Nếu không, quy định của **phòng ban** người đó dành riêng cho **pháp nhân** của họ.
3. Nếu không, quy định của phòng ban đó áp dụng cho **Mọi pháp nhân**.

Nếu không có quy định nào khớp, không có cảnh báo.

## Hệ thống đếm thế nào

- "Nhóm" của người xin nghỉ là những người đang làm việc **cùng nhóm**; nếu người đó không thuộc nhóm nào thì là những người **cùng phòng ban trong cùng pháp nhân**.
- Với mỗi ngày bị tính trong đơn, số người có mặt = tổng số người của nhóm, trừ những người đã có kỳ nghỉ cả ngày hoặc nửa ngày (đã duyệt **hoặc đang chờ duyệt**) vào ngày đó, trừ chính người đang xin nghỉ.
- Nghỉ theo giờ không làm giảm số người có mặt.
- Nếu số có mặt nhỏ hơn mức tối thiểu, cảnh báo hiện: "Vào …, nhóm của bạn sẽ có dưới … người đi làm. Bạn vẫn gửi được đơn; quản lý cũng thấy cảnh báo này."

## Ai thấy cảnh báo

| Người | Thấy ở đâu |
|---|---|
| Người xin nghỉ | Sau khi bấm **Kiểm tra** trên trang [Xin nghỉ](/leave/new). |
| Người duyệt | Trên trang đơn nghỉ, trong khung **Cũng nghỉ trong những ngày này**. |
| Nhân sự nộp thay | Như người xin nghỉ. |

> [!TIP]
> Đặt quy định cho những bộ phận phải trực liên tục (lễ tân, vận hành, hỗ trợ khách hàng). Với nhóm nhỏ, mức tối thiểu quá cao sẽ khiến gần như mọi đơn đều có cảnh báo và người duyệt dần bỏ qua nó.
