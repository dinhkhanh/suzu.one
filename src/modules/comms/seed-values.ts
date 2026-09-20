// Placeholder company values for kudos. Configuration: `pnpm db:seed` adds the keys that are
// missing and never touches a row HR has edited. The owner replaces them with the real ones.
export const STARTER_COMPANY_VALUES = [
  { key: "customer_first", nameVi: "Khách hàng là trọng tâm", nameEn: "Customer first", description: "Hiểu và làm đúng điều khách hàng thật sự cần.", sortOrder: 1 },
  { key: "ownership", nameVi: "Làm chủ công việc", nameEn: "Ownership", description: "Nhận việc là làm đến nơi đến chốn, không đổ lỗi.", sortOrder: 2 },
  { key: "teamwork", nameVi: "Đồng đội", nameEn: "Teamwork", description: "Giúp nhau để cả nhóm cùng thắng.", sortOrder: 3 },
  { key: "creativity", nameVi: "Sáng tạo", nameEn: "Creativity", description: "Dám thử cách làm mới, ý tưởng mới.", sortOrder: 4 },
  { key: "integrity", nameVi: "Chính trực", nameEn: "Integrity", description: "Nói thật, làm thật, giữ lời.", sortOrder: 5 },
] as const;
