// The two ladders a job title ("chức danh") is read from: how experienced a person is in their
// craft, and where they sit in the chain of authority. Two fields of data, one title on screen —
// "Senior Manager". The position ("chức vụ") is a third thing: the post a person is appointed to,
// typed by HR (`position`) or held in a project (lead, account manager).
// A plain module: core HR, recruitment, the pages and the client forms all read it.
export const SENIORITY_LEVELS = ["intern", "junior", "mid", "senior"] as const;
export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number];

export const POSITION_LEVELS = ["executive", "leader", "manager", "director", "c_level"] as const;
export type PositionLevel = (typeof POSITION_LEVELS)[number];

export type JobLevels = { seniorityLevel: SeniorityLevel | null; positionLevel: PositionLevel | null };

const known = <Value extends string>(values: readonly Value[], value: unknown): Value | null => (values.includes(value as Value) ? (value as Value) : null);

/**
 * The job title: seniority then position level, either alone when the other is not set, null with
 * neither. `label` turns a message key into words — pass the translator of `people`
 * (`seniorityLevel.senior`, `positionLevel.manager`).
 */
export function jobTitle(label: (key: `seniorityLevel.${SeniorityLevel}` | `positionLevel.${PositionLevel}`) => string, levels: { seniorityLevel?: string | null; positionLevel?: string | null } | null | undefined): string | null {
  const seniority = known(SENIORITY_LEVELS, levels?.seniorityLevel);
  const position = known(POSITION_LEVELS, levels?.positionLevel);
  return [seniority ? label(`seniorityLevel.${seniority}`) : null, position ? label(`positionLevel.${position}`) : null].filter(Boolean).join(" ") || null;
}

// The spellings a spreadsheet may use for each level (the import's `oneOf`), beside the code itself.
export const SENIORITY_SPELLINGS: Record<SeniorityLevel, readonly string[]> = {
  intern: ["Intern", "Thực tập sinh", "Thực tập", "TTS"],
  junior: ["Junior", "Jr", "Fresher"],
  mid: ["Mid-level", "Mid level", "Middle"],
  senior: ["Senior", "Sr"],
};
export const POSITION_SPELLINGS: Record<PositionLevel, readonly string[]> = {
  executive: ["Executive", "Staff", "Nhân viên", "Chuyên viên"],
  leader: ["Leader", "Lead", "Team leader", "Trưởng nhóm"],
  manager: ["Manager", "Quản lý", "Trưởng phòng"],
  director: ["Director", "Giám đốc"],
  c_level: ["C-level", "C level", "CEO", "COO", "CFO", "CMO", "CTO", "Tổng giám đốc"],
};
