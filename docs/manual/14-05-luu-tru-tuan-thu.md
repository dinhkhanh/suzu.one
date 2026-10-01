# Lưu trữ tuân thủ

**Lưu trữ tuân thủ** là hồ sơ các kỳ đã qua của từng nghĩa vụ: ai hoàn thành, khi nào, số tham chiếu, số tiền đã nộp và chứng từ đính kèm. Đây là nơi bạn tìm lại giấy tờ khi cơ quan thuế, bảo hiểm hay kiểm toán yêu cầu.

[Mở Lưu trữ](/ops/history)

## Ai xem được

Người có vai trò xem hoặc quản lý nghĩa vụ: Ban điều hành, Giám đốc pháp nhân, Kiểm toán (chỉ xem), Quản trị nhân sự, Chuyên viên nhân sự, C&B / Tiền lương, Tài chính – Kế toán, Chủ sở hữu — trong phạm vi pháp nhân được phân quyền.

## Những gì có trong lưu trữ

Lưu trữ gồm mọi nghĩa vụ **đã đóng** (Hoàn thành, Hoàn thành trễ, Không áp dụng) và mọi nghĩa vụ **đã qua hạn** mà vẫn còn mở (Quá hạn). Nghĩa vụ chưa đến hạn không có ở đây.

## Lọc

1. **Nghĩa vụ** — chọn một mẫu (hiện theo dạng "mã — tên") hoặc **Tất cả**.
2. **Pháp nhân** — một pháp nhân hoặc **Tất cả**.
3. **Đến hạn trong năm** — năm nay hoặc ba năm trước, hoặc **Tất cả**. Mặc định là năm nay.
4. Bấm **Lọc**.

Dòng tóm tắt cho biết số kỳ đã qua và số kỳ trễ hoặc còn mở, ví dụ "24 kỳ đã qua, 2 kỳ trễ hoặc còn mở."

> [!TIP]
> Từ trang một nghĩa vụ, bấm liên kết **Các kỳ trước** để mở ngay lưu trữ của đúng nghĩa vụ đó, đúng pháp nhân đó, mọi năm.

## Các cột

| Cột | Nội dung |
|---|---|
| **Pháp nhân** | Mã pháp nhân. |
| **Nghĩa vụ** | Tên mẫu (bấm để mở nghĩa vụ) và mã mẫu. |
| **Kỳ** | Ví dụ `03/2026`, `Q1/2026`; với nghĩa vụ theo sự kiện là tên nhân viên liên quan. |
| **Hạn** | Hạn sau khi dời khỏi ngày nghỉ. |
| **Trạng thái** | Hoàn thành, Hoàn thành trễ, Quá hạn, Không áp dụng. |
| **Người hoàn thành** | Người đóng và ngày đóng; **tự động** nếu hệ thống tự đóng. Với kỳ còn mở là tên người phụ trách (chữ mờ). |
| **Ngày nộp**, **Số tham chiếu**, **Số tiền (VND)** | Như đã ghi khi đóng. |
| **Chứng từ** | Các tệp đính kèm; bấm tên tệp để mở. |

Lưu trữ sắp xếp theo hạn, mới nhất trước.

## Xuất CSV

Bấm **Xuất CSV** để tải tệp gồm đúng những dòng đang hiển thị với bộ lọc hiện tại (có thêm cột **Mã**, **Người phụ trách**, **Ngày hoàn thành**). Tệp có tối đa 5.000 dòng; nếu nhiều hơn, bạn sẽ thấy cảnh báo "Chỉ xuất 5.000 dòng đầu tiên." — hãy thu hẹp theo năm hoặc pháp nhân rồi xuất nhiều lần.

> [!NOTE]
> Mỗi lần xuất tệp và mỗi lần mở chứng từ đều được ghi vào nhật ký hệ thống.

## Chuẩn bị cho một đợt thanh tra

- [ ] Lọc **Nghĩa vụ** theo các mẫu thuộc cơ quan đến thanh tra (ví dụ các tờ khai thuế), **Pháp nhân** đúng đơn vị, **Đến hạn trong năm** theo các năm được kiểm tra.
- [ ] Rà cột **Trạng thái**: kỳ nào **Hoàn thành trễ** hoặc **Quá hạn**, chuẩn bị giải trình.
- [ ] Kiểm tra mỗi kỳ có đủ **Số tham chiếu**, **Ngày nộp**, **Số tiền** và tệp **Chứng từ**.
- [ ] Kỳ nào thiếu chứng từ: nhờ người quản lý nghĩa vụ **Mở lại** kèm lý do, bổ sung, rồi đóng lại.
- [ ] Bấm **Xuất CSV** để có bảng tổng hợp gửi đoàn thanh tra.
