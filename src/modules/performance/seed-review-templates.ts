// The starter review forms (FR-PRF-03), seeded by `pnpm db:seed`: one for the annual review, one
// for the mid-year check and one for the end of probation. A starting point — HR edits them on
// /performance/admin/templates before the first cycle is built. Re-seeding only adds the keys
// that do not exist yet, so a starter HR changed or archived never comes back as it was.
//
// What each scale point is worth is the company's choice, kept here and not in code (SRS D13):
// "Đạt yêu cầu" is worth exactly 100 %, so a person who meets every expectation lands on 100 %.
import type { RatingPoint, ReviewCycleKind, ReviewSection } from "./enums";

export type ReviewTemplateSeed = { seedKey: string; name: string; nameEn: string; description: string; kinds: ReviewCycleKind[]; sections: ReviewSection[]; ratingScale: RatingPoint[] };

const FIVE_POINTS: RatingPoint[] = [
  { value: 1, label: "Chưa đạt yêu cầu", labelEn: "Below expectations", scoreBp: 4000 },
  { value: 2, label: "Cần cải thiện", labelEn: "Needs improvement", scoreBp: 7000 },
  { value: 3, label: "Đạt yêu cầu", labelEn: "Meets expectations", scoreBp: 10000 },
  { value: 4, label: "Vượt mong đợi", labelEn: "Exceeds expectations", scoreBp: 11500 },
  { value: 5, label: "Xuất sắc", labelEn: "Outstanding", scoreBp: 13000 },
];

const PROBATION_POINTS: RatingPoint[] = [
  { value: 1, label: "Chưa đạt", labelEn: "Does not meet", scoreBp: 4000 },
  { value: 2, label: "Cần theo dõi thêm", labelEn: "Needs watching", scoreBp: 7000 },
  { value: 3, label: "Đạt", labelEn: "Meets", scoreBp: 10000 },
  { value: 4, label: "Tốt", labelEn: "Good", scoreBp: 11500 },
];

const STARTER_NOTE = "Biểu mẫu khởi đầu do hệ thống tạo sẵn — Nhân sự chỉnh sửa câu hỏi, trọng số và thang điểm cho phù hợp trước khi mở chu kỳ.";

export const REVIEW_TEMPLATE_SEED: ReviewTemplateSeed[] = [
  {
    seedKey: "annual",
    name: "Đánh giá năm",
    nameEn: "Annual review",
    description: `Sáu nhóm năng lực chấm điểm và năm câu tự luận; mức “Đạt yêu cầu” tương đương 100 %. ${STARTER_NOTE}`,
    kinds: ["annual"],
    ratingScale: FIVE_POINTS,
    sections: [
      { key: "results", title: "Kết quả công việc so với mục tiêu (OKR, KPI)", titleEn: "Results against goals (OKR, KPI)", kind: "rating", weight: 30, required: true, askedOf: ["self", "manager"] },
      { key: "quality", title: "Chất lượng và tiến độ công việc", titleEn: "Quality and timeliness of work", kind: "rating", weight: 20, required: true, askedOf: ["self", "manager", "peer"] },
      { key: "expertise", title: "Năng lực chuyên môn", titleEn: "Professional expertise", kind: "rating", weight: 15, required: true, askedOf: ["self", "manager"] },
      { key: "ownership", title: "Tinh thần trách nhiệm và chủ động", titleEn: "Ownership and initiative", kind: "rating", weight: 15, required: true, askedOf: ["self", "manager"] },
      { key: "teamwork", title: "Phối hợp, giao tiếp với đồng nghiệp và khách hàng", titleEn: "Collaboration and communication", kind: "rating", weight: 10, required: true, askedOf: ["self", "manager", "peer"] },
      { key: "growth", title: "Học hỏi và phát triển bản thân", titleEn: "Learning and growth", kind: "rating", weight: 10, required: true, askedOf: ["self", "manager"] },
      { key: "achievements", title: "Thành tích nổi bật trong năm", titleEn: "Highlights of the year", kind: "text", weight: 0, required: true, askedOf: ["self", "manager"] },
      { key: "strengths", title: "Điểm mạnh nên phát huy", titleEn: "Strengths to build on", kind: "text", weight: 0, required: false, askedOf: ["self", "manager", "peer"] },
      { key: "improve", title: "Điểm cần cải thiện", titleEn: "What to improve", kind: "text", weight: 0, required: true, askedOf: ["self", "manager", "peer"] },
      { key: "next_goals", title: "Mục tiêu và kế hoạch phát triển năm tới", titleEn: "Goals and development plan for next year", kind: "text", weight: 0, required: true, askedOf: ["self", "manager"] },
      { key: "support", title: "Đề xuất, hỗ trợ cần từ quản lý hoặc công ty", titleEn: "Support needed from the manager or the company", kind: "text", weight: 0, required: false, askedOf: ["self"] },
    ],
  },
  {
    seedKey: "mid_year",
    name: "Đánh giá giữa năm",
    nameEn: "Mid-year review",
    description: `Nhìn lại sáu tháng đầu năm và điều chỉnh mục tiêu cho nửa cuối năm: ba nhóm chấm điểm, bốn câu tự luận. ${STARTER_NOTE}`,
    kinds: ["mid_year"],
    ratingScale: FIVE_POINTS,
    sections: [
      { key: "progress", title: "Tiến độ thực hiện mục tiêu sáu tháng đầu năm", titleEn: "Progress on the first half's goals", kind: "rating", weight: 40, required: true, askedOf: ["self", "manager"] },
      { key: "quality", title: "Chất lượng và tiến độ công việc", titleEn: "Quality and timeliness of work", kind: "rating", weight: 30, required: true, askedOf: ["self", "manager"] },
      { key: "teamwork", title: "Phối hợp với đồng nghiệp", titleEn: "Teamwork", kind: "rating", weight: 30, required: true, askedOf: ["self", "manager"] },
      { key: "done_well", title: "Những việc đã làm tốt", titleEn: "What went well", kind: "text", weight: 0, required: true, askedOf: ["self", "manager"] },
      { key: "obstacles", title: "Khó khăn, vướng mắc đang gặp", titleEn: "Obstacles", kind: "text", weight: 0, required: false, askedOf: ["self"] },
      { key: "adjustments", title: "Mục tiêu cần điều chỉnh cho sáu tháng cuối năm", titleEn: "Goals to adjust for the second half", kind: "text", weight: 0, required: true, askedOf: ["self", "manager"] },
      { key: "support", title: "Hỗ trợ cần từ quản lý hoặc công ty", titleEn: "Support needed", kind: "text", weight: 0, required: false, askedOf: ["self"] },
    ],
  },
  {
    seedKey: "probation",
    name: "Đánh giá hết thử việc",
    nameEn: "End-of-probation review",
    description: `Năm tiêu chí chấm điểm, nhận xét và đề xuất của quản lý trực tiếp trước khi hết thời gian thử việc; mức “Đạt” tương đương 100 %. ${STARTER_NOTE}`,
    kinds: ["probation"],
    ratingScale: PROBATION_POINTS,
    sections: [
      { key: "job_fit", title: "Mức độ đáp ứng yêu cầu công việc", titleEn: "Meets the requirements of the role", kind: "rating", weight: 30, required: true, askedOf: ["self", "manager"] },
      { key: "expertise", title: "Kiến thức, kỹ năng chuyên môn", titleEn: "Knowledge and skills", kind: "rating", weight: 25, required: true, askedOf: ["self", "manager"] },
      { key: "attitude", title: "Thái độ làm việc, tinh thần trách nhiệm", titleEn: "Attitude and sense of responsibility", kind: "rating", weight: 20, required: true, askedOf: ["self", "manager"] },
      { key: "culture", title: "Hoà nhập với đội nhóm và văn hoá công ty", titleEn: "Fit with the team and the company's culture", kind: "rating", weight: 15, required: true, askedOf: ["self", "manager"] },
      { key: "discipline", title: "Chấp hành nội quy, giờ giấc", titleEn: "Follows the rules and working hours", kind: "rating", weight: 10, required: true, askedOf: ["manager"] },
      { key: "learned", title: "Kết quả đạt được và điều đã học được trong thời gian thử việc", titleEn: "Results and what was learned during probation", kind: "text", weight: 0, required: true, askedOf: ["self"] },
      { key: "difficulties", title: "Khó khăn gặp phải và hỗ trợ mong muốn", titleEn: "Difficulties and support wanted", kind: "text", weight: 0, required: false, askedOf: ["self"] },
      { key: "assessment", title: "Nhận xét của quản lý trực tiếp", titleEn: "The line manager's assessment", kind: "text", weight: 0, required: true, askedOf: ["manager"] },
      { key: "proposal", title: "Đề xuất sau thử việc (ký hợp đồng lao động hoặc không tiếp tục) và lý do", titleEn: "Proposal after probation (sign a labour contract or not) and why", kind: "text", weight: 0, required: true, askedOf: ["manager"] },
      { key: "next_goals", title: "Mục tiêu ba tháng tiếp theo nếu ký hợp đồng", titleEn: "Goals for the next three months if a contract is signed", kind: "text", weight: 0, required: false, askedOf: ["self", "manager"] },
    ],
  },
];

export const reviewTemplateSeedRows = () => REVIEW_TEMPLATE_SEED.map((seed) => ({ seedKey: seed.seedKey, name: seed.name, nameEn: seed.nameEn, description: seed.description, kinds: seed.kinds, sections: seed.sections, ratingScale: seed.ratingScale, isActive: true }));
