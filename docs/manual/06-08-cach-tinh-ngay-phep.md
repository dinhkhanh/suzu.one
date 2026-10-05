# Cách tính ngày phép

Trang này giải thích bằng lời thường cách SuZu One tính số ngày phép: cộng phép, tính theo tỷ lệ, thâm niên, thử việc, chuyển năm, hết hạn và thanh toán khi nghỉ việc. Nhân viên đọc để hiểu số dư của mình; nhân sự đọc để đặt chính sách cho đúng (xem **Loại phép và chính sách**).

Mọi con số cụ thể — số ngày cơ sở, bậc thâm niên, mức chuyển năm, hạn dùng — đều do nhân sự cấu hình hoặc lấy theo **tham số pháp định đang hiệu lực**, không cố định trong hệ thống.

## Nguyên tắc chung

- **Năm phép là năm dương lịch** (1/1 – 31/12). Mỗi năm có số dư riêng.
- **Số dư = tổng các dòng trong sổ phép** của năm đó. Không có con số nào "từ trên trời rơi xuống": mỗi lần cộng, trừ, chuyển, hết hạn là một dòng có ngày và lý do.
- **Số dùng được = số dư − số ngày các đơn đang chờ duyệt.** Đơn chờ duyệt giữ chỗ cho đến khi được duyệt (trừ hẳn), bị từ chối hoặc rút (trả lại).
- **Mỗi đêm** hệ thống tự cập nhật mọi số dư đến hôm đó. Chạy nhiều lần cũng không cộng trùng.

## Số ngày của một năm làm việc đủ

Với loại phép có chính sách, số ngày cho **một năm làm đủ** gồm:

1. **Số ngày cơ sở** — theo luật (lấy từ Tham số pháp định) hoặc một số cố định do HR đặt;
2. cộng **ngày thêm của công ty** (nếu có);
3. cộng **ngày thâm niên** (nếu chính sách bật **Cộng ngày theo thâm niên (theo luật)**): cứ đủ một số năm làm việc theo tham số pháp định thì được thêm một ngày.

Thâm niên được đo **đến ngày 31/12** của năm đó (hoặc đến ngày nghỉ việc nếu sớm hơn), tính từ **ngày tính thâm niên** trong hồ sơ. Vì vậy ngày thâm niên được cộng ngay trong năm bạn đủ mốc, không phải chờ sang năm sau.

> [!NOTE]
> Chuyển công tác giữa các pháp nhân trong tập đoàn không làm "khởi động lại" việc cộng phép trong năm và không phát sinh thanh toán phép.

## Tháng nào được tính

Một tháng được tính khi bạn **làm việc ít nhất một nửa số ngày** (theo lịch) của tháng đó. Ví dụ vào làm ngày 10 của tháng 30 ngày: bạn làm 21 ngày, nhiều hơn một nửa, nên tháng đó được tính; vào làm ngày 20 thì tháng đó không được tính.

Nếu chính sách chọn thử việc **Không được cộng**, những ngày thử việc không được coi là ngày làm việc khi xét tháng.

## Tính theo tỷ lệ và làm tròn

- Bật **Tính theo tỷ lệ cho người mới vào / nghỉ việc**: số ngày cả năm = số ngày năm làm đủ × số tháng được tính ÷ 12, rồi làm tròn theo **Làm tròn khi không đủ năm** (**Không làm tròn**, **Đến nửa ngày**, **Đến cả ngày** — làm tròn đến mức gần nhất).
- Không bật: ai có ít nhất một tháng được tính trong năm đều được cả năm.

## Cộng dần hàng tháng hay cấp một lần

| Cách cấp | Cách hoạt động |
|---|---|
| **Cộng dần hàng tháng** | Vào **ngày đầu mỗi tháng** được tính, bạn nhận phần của tháng đó (với tháng đầu tiên đi làm: vào ngày bắt đầu làm). Phần của tháng cuối cùng được điều chỉnh để tổng cả năm khớp đúng số ngày đã làm tròn. Trong sổ phép là các dòng **Cộng hàng tháng**. |
| **Cấp một lần mỗi năm** | Toàn bộ số ngày của năm (đã tính tỷ lệ nếu có) được cấp vào ngày 1/1, hoặc vào ngày bắt đầu làm nếu bạn vào giữa năm. Trong sổ phép là dòng **Cấp phép**. |
| **Không tự cấp (chỉ qua bút toán)** | Hệ thống không tự cộng gì. Số dư chỉ thay đổi qua số dư đầu kỳ, điều chỉnh của HR, hoặc (với nghỉ bù) giờ làm thêm khi khoá bảng công. |

Cột lý do của mỗi dòng cộng phép ghi rõ cách tính, ví dụ số ngày cơ sở, số năm thâm niên, số tháng được tính và số ngày được hưởng — HR có thể dùng để giải thích cho nhân viên.

### Khi thông tin thay đổi giữa năm

Hệ thống luôn so "đến hôm nay lẽ ra phải được bao nhiêu" với "đã cộng bao nhiêu" và chỉ ghi **phần chênh lệch**. Vì vậy khi HR sửa ngày tính thâm niên, ngày nghỉ việc hay đổi chính sách, lần cập nhật kế tiếp tự ghi một dòng bù trừ; các dòng cũ không bị sửa.

### Khi có số dư đầu kỳ

Nếu HR nhập số dư đầu kỳ với **Tính đến ngày**, các tháng bắt đầu trước ngày đó được coi là đã nằm trong số dư đầu kỳ, hệ thống chỉ cộng từ các tháng sau. Với cách cấp một lần mỗi năm, nếu ngày chốt muộn hơn ngày cấp thì phần cấp của năm coi như đã nằm trong số dư đầu kỳ.

## Thời gian thử việc

| Lựa chọn trong chính sách | Kết quả |
|---|---|
| **Được cộng và được nghỉ** | Thử việc như nhân viên chính thức. |
| **Được cộng, hết thử việc mới nghỉ** | Ngày phép vẫn được cộng, nhưng đơn nghỉ bắt đầu trong thời gian thử việc bị chặn ("Chưa dùng được loại phép này trong thời gian thử việc."). |
| **Không được cộng** | Ngày thử việc không được tính khi xét tháng; thử việc cũng không dùng được loại phép này. |

Thời gian thử việc lấy từ hợp đồng thử việc trong hồ sơ. Người có hình thức làm việc **Thử việc** nhưng chưa có hợp đồng thử việc được coi là đang thử việc từ ngày đầu tiên cho đến khi HR đổi hình thức làm việc.

## Đặt trước ngày phép

Một đơn nghỉ không chỉ được xét trên số dư hôm nay. Theo chính sách của loại phép, đơn được tính cả:

- **Năm nay**: số ngày sẽ được cộng đến ngày nghỉ cuối cùng của đơn, trừ phần đã cộng rồi. Ví dụ phép cộng mỗi tháng: tháng 11 xin nghỉ một ngày tháng 12 thì phần của tháng 12 cũng được tính.
- **Năm sau**: số ngày năm sau sẽ được cộng hoặc cấp đến ngày nghỉ, cộng phần số dư năm nay dự kiến được chuyển năm (trong mức **Chuyển năm tối đa**) — miễn là ngày chuyển năm chưa hết hạn vào ngày nghỉ.
- Phần chuyển năm mà các đơn năm sau đã dựa vào thì không dùng lại được cho năm nay.

Không tính trước cho một năm đã chốt hoặc xa hơn năm sau. Người duyệt thấy cùng con số khi duyệt.

## Nghỉ vượt số dư (ứng trước)

Nếu chính sách có **Cho ứng trước (ngày)** lớn hơn 0, bạn được xin nghỉ khi số dùng được cộng mức ứng trước vẫn đủ cho đơn. Số dư khi đó có thể âm; phần âm được mang sang năm sau như một khoản nợ ngày phép.

## Chốt năm và chuyển năm

Sau ngày 31/12, lần cập nhật đầu tiên của năm mới chốt năm cũ:

1. Cộng nốt phần phép còn thiếu của năm cũ.
2. Nếu số dư cuối năm **dương**: phần không vượt quá **Chuyển năm tối đa** được chuyển sang năm mới (dòng **Chuyển năm** trừ ở năm cũ ngày 31/12 và cộng ở năm mới ngày 1/1); phần vượt quá **hết hạn** (dòng **Hết hạn** ngày 31/12). Để trống mức tối đa = chuyển hết; đặt 0 = không chuyển ngày nào.
3. Nếu số dư cuối năm **âm** (đã ứng trước): toàn bộ phần âm được chuyển sang năm mới.
4. Người đã nghỉ việc trước năm mới không được chuyển gì sang.

## Hạn dùng của ngày chuyển năm

Nếu chính sách có **Ngày chuyển năm hết hạn sau (MM-DD)**, ví dụ `03-31`:

- Khi bạn nghỉ trong năm mới, **ngày chuyển năm được dùng trước**.
- Sau ngày hết hạn, phần ngày chuyển năm còn lại chưa dùng sẽ **hết hạn** (dòng **Hết hạn**, lý do "Ngày phép chuyển năm hết hạn"). Phần hết hạn không bao giờ lớn hơn số dư hiện có.

> [!TIP]
> Nhân viên: nếu công ty có hạn dùng ngày chuyển năm, hãy lên kế hoạch dùng số ngày đó trong những tháng đầu năm.

## Khi nghỉ việc

- Nếu chính sách bật **Tính theo tỷ lệ cho người mới vào / nghỉ việc**, năm cuối chỉ tính những tháng bạn còn làm việc.
- Nếu chính sách bật **Thanh toán ngày chưa nghỉ khi nghỉ việc**, sau ngày làm việc cuối cùng, số dư còn lại (nếu dương) của năm đó được ghi dòng **Thanh toán** để tính vào lương kỳ cuối. Sau đó không cộng thêm phép nữa.
- Nếu không bật, số dư còn lại không được thanh toán.

## Một đơn nghỉ tốn bao nhiêu ngày

- Chỉ tính **ngày làm việc** theo lịch của chính bạn (lịch làm việc, ca, ngày lễ, ngày công ty cho nghỉ do phần Chấm công thiết lập). Ngày lễ, ngày nghỉ hằng tuần, ngày nghỉ bù lễ không bị tính.
- Ngày làm việc không chấm công (như Thứ Bảy làm tại nhà) chỉ bị tính với loại phép bật **Tính cả Thứ Bảy làm tại nhà**.
- Cả ngày = 1 ngày; buổi sáng hoặc buổi chiều = 0,5 ngày; theo giờ = số phút nghỉ ÷ số phút làm việc chuẩn của ngày đó.
- Đơn vắt qua hai năm trừ vào số dư của từng năm theo các ngày nằm trong năm đó.
