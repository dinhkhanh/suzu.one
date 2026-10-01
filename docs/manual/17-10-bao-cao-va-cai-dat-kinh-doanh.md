# Báo cáo & cài đặt kinh doanh

Trang này mô tả các báo cáo của phân hệ **Khách hàng & kinh doanh** — báo cáo kinh doanh, dự báo doanh thu, hiệu quả theo khách hàng — và phần cài đặt dành cho quản lý kinh doanh: giai đoạn cơ hội và các tham số kinh doanh.

## Phần 1 — Báo cáo kinh doanh

### Ai xem được

Tab [Báo cáo](/crm/reports) dành cho người bán hàng, người phụ trách khách hàng, người phụ trách cơ hội, nhóm phụ trách khách hàng, và người được xem chi phí. Mọi con số chỉ tính trên **những cơ hội bạn được xem giá trị** — nếu không có cơ hội nào như vậy, trang ghi "Không có cơ hội nào bạn được xem giá trị." Báo cáo không xếp hạng cá nhân trên toàn công ty.

### Bộ lọc

Chọn **Đội thực hiện** (hoặc **Mọi đội**) rồi bấm **Lọc**.

### Các chỉ số

- Ô tổng: **Cơ hội đang mở**, **Tỉ lệ chốt, 6 tháng**, **Giá trị chốt bình quân**, **Chu kỳ bán hàng bình quân** (số ngày), **Cơ hội đứng yên**.
- **Cơ hội đang mở theo giai đoạn**: số cơ hội, giá trị, giá trị có trọng số của từng giai đoạn.
- **Chốt và không thành công theo tháng**: số cơ hội đã chốt, giá trị chốt, số không thành công; bên dưới là thống kê **Lý do không thành công**.
- **Dự báo doanh thu** theo tháng: **Đã ký (retainer)** — doanh thu đã có hợp đồng hoặc retainer chưa xuất hoá đơn — và **Cơ hội có trọng số**.
- **Công nợ** (nếu bạn được xem): tổng còn phải thu, "trong đó quá hạn …", nút **Mở công nợ**.

## Phần 2 — Hiệu quả theo khách hàng

### Ai xem được

Chỉ người được xem **chi phí** (vai trò có quyền xem giá vốn nhân sự: **Tài chính – Kế toán**, **Ban điều hành**, **Chủ sở hữu**). Mở từ liên kết **Hiệu quả theo khách hàng** trên trang báo cáo, hoặc [Hiệu quả theo khách hàng](/crm/reports/profitability).

### Đọc báo cáo

Chọn khoảng **Từ** – **Đến** rồi **Lọc**. Với mỗi khách hàng:

| Cột | Ý nghĩa |
| --- | --- |
| **Doanh thu** | Số đã xuất hoá đơn của các dự án trong kỳ; nếu chưa có thì là phí retainer hoặc phí dự án trong kỳ (đánh dấu "ước tính"). |
| **Chi phí thực hiện** | Giờ công đã ghi × chi phí nhân sự của tháng theo bảng lương đã ký. |
| **Chi phí bán hàng** | Giờ công ghi vào các dự án pitch của khách. |
| **Lợi nhuận gộp** và **Tỉ suất %** | Doanh thu trừ hai loại chi phí. |
| **Giờ công** | Tổng giờ đã ghi. |

Mỗi dòng ghi số dự án và số pitch. Dòng **Tổng** ở cuối bảng. Các dự án riêng tư được gom vào một dòng **Riêng tư** (số dự án, chi phí, phí) để không lộ chi tiết.

> [!NOTE]
> Không con số nào trong báo cáo này thuộc về một cá nhân: chi phí được tính từ giờ công bình quân của bảng lương, không hiện lương của ai.

## Phần 3 — Cài đặt kinh doanh

### Ai dùng

Tab [Cài đặt](/crm/settings) dành cho quản lý kinh doanh có phạm vi **toàn tập đoàn** (**Ban điều hành**, **Chủ sở hữu**, hoặc **Giám đốc pháp nhân** được giao toàn tập đoàn).

### Giai đoạn cơ hội

Mục **Giai đoạn** liệt kê các giai đoạn theo thứ tự, mỗi giai đoạn có loại, xác suất và điều kiện ("cần …"); nhãn **Ngưng dùng** nếu đã tắt.

Để sửa một giai đoạn (hoặc **Thêm giai đoạn**):

1. Điền **Tên**, **Tên tiếng Anh**.
2. Chọn **Loại**: **Đang mở**, **Chốt thành công**, **Không thành công**.
3. **Xác suất %** mặc định và **Thứ tự**.
4. Tick các mục ở **Để vào giai đoạn, cơ hội cần có**: một đầu mối phía khách, ngày dự kiến chốt, giá trị, báo giá được chấp nhận, hợp đồng đã ký, dự án pitch.
5. Tick **Được mở dự án pitch ở giai đoạn này** nếu cần.
6. **Đang dùng**, rồi **Lưu**.

> [!WARNING]
> Không đổi được **Loại** của một giai đoạn khi đang có cơ hội ở giai đoạn đó. Muốn bỏ một giai đoạn, hãy chuyển các cơ hội đi trước, rồi bỏ tick **Đang dùng**.

### Quy định đang áp dụng

Mục **Quy định đang áp dụng** hiển thị (chỉ xem) các con số mà phân hệ đang dùng:

- Số ngày không hoạt động thì cơ hội bị coi là **đứng yên**.
- Số ngày trước khi hết hạn thì **mở cơ hội gia hạn**.
- Các mốc **nhắc công nợ quá hạn**.
- **Hạn thanh toán mặc định**.
- Số ngày **hiệu lực của báo giá**.
- Ngưỡng **chiết khấu** và mức sàn **biên lợi nhuận** khiến báo giá cần duyệt.
- **Thuế GTGT**: thuế suất mặc định và các thuế suất được dùng.

Các con số này là quy định của công ty, có ngày hiệu lực, nằm ở **Quản trị** → [Tham số pháp định](/admin/rules) (tham số "CRM – cơ hội đứng yên, gia hạn, nhắc công nợ, hạn thanh toán, duyệt báo giá" và "Thuế GTGT trên dịch vụ bán ra"). Muốn thay đổi, hãy đề xuất để chủ doanh nghiệp duyệt — xem trang **Tham số pháp định**.

### Bảng giá

Danh mục dịch vụ và giá niêm yết được quản lý ở tab **Bảng giá** — xem trang **Báo giá & bảng giá**.
