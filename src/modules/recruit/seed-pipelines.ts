// Starter hiring pipelines (FR-REC-02). Editable configuration, not rules: a recruiter renames,
// reorders and removes stages, and every opening points at the pipeline it runs.
//
// Two are seeded because an agency hires two different ways. The standard one puts a paid
// assignment before the offer — for a designer or an editor, the portfolio is the interview. The
// short one is for roles where it would only waste everybody's time.
import type { StageCategory } from "./enums";

export type PipelineStageSeed = { key: string; name: string; nameEn: string; category: StageCategory };
export type PipelineSeed = { code: string; name: string; nameEn: string; description: string; isDefault: boolean; stages: PipelineStageSeed[] };

export const PIPELINE_SEED: PipelineSeed[] = [
  {
    code: "STANDARD",
    name: "Quy trình tuyển dụng chuẩn",
    nameEn: "Standard hiring pipeline",
    description: "Dùng cho hầu hết vị trí: sàng lọc hồ sơ, phỏng vấn, bài test, đề nghị nhận việc.",
    isDefault: true,
    stages: [
      { key: "applied", name: "Hồ sơ mới", nameEn: "Applied", category: "applied" },
      { key: "screening", name: "Sàng lọc hồ sơ", nameEn: "CV screening", category: "screening" },
      { key: "phone_screen", name: "Sơ vấn qua điện thoại", nameEn: "Phone screen", category: "screening" },
      { key: "interview", name: "Phỏng vấn chuyên môn", nameEn: "Interview", category: "interview" },
      { key: "assignment", name: "Bài test / Portfolio", nameEn: "Assignment", category: "assignment" },
      { key: "final_interview", name: "Phỏng vấn cuối", nameEn: "Final interview", category: "interview" },
      { key: "offer", name: "Đề nghị nhận việc", nameEn: "Offer", category: "offer" },
      { key: "hired", name: "Đã nhận việc", nameEn: "Hired", category: "hired" },
    ],
  },
  {
    code: "SHORT",
    name: "Quy trình rút gọn",
    nameEn: "Short pipeline",
    description: "Cho vị trí thời vụ, thực tập và cộng tác viên: sàng lọc, một vòng phỏng vấn, mời nhận việc.",
    isDefault: false,
    stages: [
      { key: "applied", name: "Hồ sơ mới", nameEn: "Applied", category: "applied" },
      { key: "screening", name: "Sàng lọc hồ sơ", nameEn: "CV screening", category: "screening" },
      { key: "interview", name: "Phỏng vấn", nameEn: "Interview", category: "interview" },
      { key: "offer", name: "Đề nghị nhận việc", nameEn: "Offer", category: "offer" },
      { key: "hired", name: "Đã nhận việc", nameEn: "Hired", category: "hired" },
    ],
  },
];

/** Every pipeline needs somewhere to put a new application and somewhere to end: the seed says so out loud. */
export function pipelineSeedProblems(seed: PipelineSeed): string[] {
  const problems: string[] = [];
  if (!seed.stages.some((stage) => stage.category === "applied")) problems.push("no applied stage");
  if (!seed.stages.some((stage) => stage.category === "hired")) problems.push("no hired stage");
  if (new Set(seed.stages.map((stage) => stage.key)).size !== seed.stages.length) problems.push("duplicate stage key");
  return problems;
}
