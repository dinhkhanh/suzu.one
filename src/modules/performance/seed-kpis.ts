// The starter KPI library (FR-PRF-02), seeded by `pnpm db:seed`: the common measures for a
// marketing group, plus a few for HR, finance, account and management roles. A starting point —
// HR edits it on /performance/admin/library. Re-seeding only adds codes that do not exist yet, so
// nothing HR changed (or switched off) ever comes back.
import type { KpiDirection, KpiFrequency, KpiUnit } from "./enums";

export type KpiSeed = { code: string; name: string; description: string; unit: KpiUnit; direction: KpiDirection; frequency: KpiFrequency; capBp?: number; floorBp?: number };

export const KPI_LIBRARY_SEED: KpiSeed[] = [
  // Creative and marketing roles
  { code: "ON_TIME_DELIVERY", name: "Tỷ lệ giao việc đúng hạn", description: "Số đầu việc hoàn thành đúng hoặc trước hạn ÷ tổng số đầu việc đến hạn trong tháng (theo module Công việc).", unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 10500 },
  { code: "CONTENT_OUTPUT", name: "Sản lượng nội dung", description: "Số sản phẩm được duyệt trong tháng (bài viết, thiết kế, video — theo vị trí).", unit: "number", direction: "higher_better", frequency: "monthly" },
  { code: "ENGAGEMENT_RATE", name: "Tỷ lệ tương tác", description: "Tương tác ÷ lượt tiếp cận bình quân của các kênh phụ trách trong tháng.", unit: "percent", direction: "higher_better", frequency: "monthly" },
  { code: "CAMPAIGN_ROAS", name: "ROAS chiến dịch", description: "Doanh thu ghi nhận từ quảng cáo ÷ chi phí quảng cáo của các chiến dịch phụ trách. Tháng không chạy chiến dịch: đánh dấu không áp dụng.", unit: "number", direction: "higher_better", frequency: "monthly" },
  { code: "CLIENT_SATISFACTION", name: "Mức hài lòng của khách hàng", description: "Điểm khảo sát khách hàng cuối quý, thang 5.", unit: "number", direction: "higher_better", frequency: "quarterly", capBp: 11000 },
  { code: "REVISION_ROUNDS", name: "Số vòng sửa bình quân", description: "Số vòng sửa bình quân cho một sản phẩm trước khi được duyệt (theo bước duyệt của module Công việc). Càng thấp càng tốt.", unit: "number", direction: "lower_better", frequency: "monthly" },
  // Account
  { code: "ACC_REVENUE", name: "Doanh thu phụ trách", description: "Doanh thu ghi nhận trong tháng của các khách hàng phụ trách (VND).", unit: "currency", direction: "higher_better", frequency: "monthly" },
  { code: "ACC_RETENTION", name: "Tỷ lệ giữ khách hàng", description: "Khách hàng còn hợp đồng cuối quý ÷ khách hàng đầu quý.", unit: "percent", direction: "higher_better", frequency: "quarterly", capBp: 11000 },
  // HR
  { code: "HR_PAYROLL_ACCURACY", name: "Bảng lương không sai sót", description: "Số phiếu lương không phải điều chỉnh ÷ tổng số phiếu lương của kỳ.", unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 10500 },
  { code: "HR_RECORDS_ON_TIME", name: "Hồ sơ nhân sự hoàn tất đúng hạn", description: "Hợp đồng, bảo hiểm, thủ tục nhận việc / nghỉ việc hoàn tất đúng hạn ÷ tổng số đến hạn.", unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 10500 },
  { code: "HR_TIME_TO_HIRE", name: "Số ngày tuyển đủ một vị trí", description: "Số ngày bình quân từ khi mở yêu cầu tuyển đến khi ứng viên nhận việc. Càng thấp càng tốt.", unit: "number", direction: "lower_better", frequency: "quarterly" },
  // Finance
  { code: "FIN_CLOSE_DAYS", name: "Số ngày khóa sổ tháng", description: "Số ngày làm việc từ cuối tháng đến khi khóa sổ kế toán. Càng thấp càng tốt.", unit: "number", direction: "lower_better", frequency: "monthly" },
  { code: "FIN_FILING_ON_TIME", name: "Nghĩa vụ thuế, bảo hiểm nộp đúng hạn", description: "Số nghĩa vụ hoàn thành đúng hạn ÷ tổng số đến hạn trong tháng (theo module Tuân thủ).", unit: "percent", direction: "higher_better", frequency: "monthly", capBp: 10000, floorBp: 8000 },
  { code: "FIN_RECEIVABLE_DAYS", name: "Số ngày thu tiền bình quân", description: "Công nợ phải thu bình quân ÷ doanh thu × số ngày của quý. Càng thấp càng tốt.", unit: "number", direction: "lower_better", frequency: "quarterly" },
  // Management
  { code: "TEAM_KPI_AVERAGE", name: "Điểm KPI bình quân của đội", description: "Bình quân điểm KPI tháng của những người báo cáo trực tiếp (%).", unit: "percent", direction: "higher_better", frequency: "monthly" },
  { code: "GROUP_REVENUE", name: "Doanh thu", description: "Doanh thu quý của đơn vị phụ trách (VND).", unit: "currency", direction: "higher_better", frequency: "quarterly" },
  { code: "GROUP_PROFIT_MARGIN", name: "Biên lợi nhuận", description: "Lợi nhuận trước thuế ÷ doanh thu của quý.", unit: "percent", direction: "higher_better", frequency: "quarterly" },
];

export const kpiSeedRows = () => KPI_LIBRARY_SEED.map((seed) => ({ code: seed.code, name: seed.name, description: seed.description, unit: seed.unit, direction: seed.direction, frequency: seed.frequency, capBp: seed.capBp ?? 12000, floorBp: seed.floorBp ?? 0 }));
