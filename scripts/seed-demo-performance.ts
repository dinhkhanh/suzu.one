// Phase 3.5 demo data for goals (OKRs), called from seed-demo.ts. Idempotent: skipped once any goal
// exists. Written straight into the tables the way the use-cases write them: a key result's current
// value and confidence are those of its latest check-in, and a closed goal carries the figure the
// pure engine gives at that moment. Two sets: 2026 (Q2 closed, Q3 running with weekly check-ins —
// so the screens are alive today) and 2027 (the company's tree, mostly at its start values).
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { department, entity, goal, goalCheckIn, keyResult, person } from "../src/lib/db/schema";
import { type GoalInput, goalProgress, weekStartOf } from "../src/modules/performance/engine/progress";
import { type Confidence, type GoalLevel, type GoalStatus, type MetricType, scaleOf, yearOfPeriod } from "../src/modules/performance/enums";

type Db = ReturnType<typeof drizzle>;
// [date, value (as people say it; for milestones: how many are done), confidence, note?]
type CheckIn = [string, number, Confidence, string?];
type Kr = { title: string; type: MetricType; start?: number; target?: number; milestones?: string[]; weight?: number; checkIns?: CheckIn[] };
type Demo = { key: string; level: GoalLevel; entity?: string; department?: string; person?: string; owner: string; parent?: string; title: string; description?: string; period: string; status?: GoalStatus; weight?: number; closedOn?: string; closedBy?: string; krs?: Kr[] };

const HA = "Nguyễn Thu Hà";
const LONG = "Đặng Hoàng Long";
const CHI = "Dương Thùy Chi";
const DUC = "Phan Văn Đức";
const MAI = "Lê Thị Mai";
const TUAN = "Võ Minh Tuấn";
const TAM = "Bùi Thanh Tâm";
const HUY = "Hồ Gia Huy";
const LINH = "Đỗ Khánh Linh";
const KHOI = "Lý Minh Khôi";
const BAO = "Phạm Quốc Bảo";

const weekly = (from: string, values: [number, Confidence, string?][]): CheckIn[] => values.map(([value, confidence, note], index) => [new Date(Date.parse(`${from}T00:00:00Z`) + index * 7 * 86_400_000).toISOString().slice(0, 10), value, confidence, note]);

const GOALS: Demo[] = [
  // ── 2026: what is running today ─────────────────────────────────────────────────────────
  {
    key: "g26", level: "group", owner: HA, period: "2026", title: "Tập đoàn tăng trưởng bền vững năm 2026",
    description: "Doanh thu tăng trưởng đi cùng biên lợi nhuận và sự hài lòng của khách hàng.",
    krs: [
      { title: "Doanh thu hợp nhất cả năm", type: "currency", start: 0, target: 48_000_000_000, weight: 3, checkIns: [["2026-04-06", 10_800_000_000, "on_track"], ["2026-07-06", 22_500_000_000, "on_track"], ["2026-09-07", 31_200_000_000, "at_risk", "Hai hợp đồng retainer lùi sang quý 4."]] },
      { title: "Biên lợi nhuận gộp", type: "percent", start: 16, target: 20, weight: 2, checkIns: [["2026-07-06", 17.5, "on_track"], ["2026-09-07", 18.2, "on_track"]] },
      { title: "Điểm hài lòng của khách hàng (CSAT)", type: "number", start: 4.1, target: 4.5, checkIns: [["2026-07-06", 4.3, "on_track"], ["2026-09-07", 4.25, "at_risk"]] },
    ],
  },
  { key: "szm26q3", level: "entity", entity: "SZM", owner: LONG, parent: "g26", period: "2026-Q3", weight: 2, title: "SuZu Media: giao video đúng hạn, ít vòng sửa (Q3/2026)" },
  { key: "vid26q3", level: "department", department: "VID", entity: "SZM", owner: LONG, parent: "szm26q3", period: "2026-Q3", title: "Phòng Video: quy trình hậu kỳ gọn hơn" },
  {
    key: "tam26q3", level: "individual", person: TAM, owner: TAM, parent: "vid26q3", period: "2026-Q3", weight: 2, title: "Đạo diễn 6 TVC đúng hạn, khách duyệt trong 2 vòng",
    krs: [
      { title: "Số TVC bàn giao đúng hạn", type: "number", start: 0, target: 6, weight: 2, checkIns: weekly("2026-07-13", [[1, "on_track"], [1, "on_track"], [2, "on_track"], [2, "at_risk", "Khách dời lịch quay."], [3, "at_risk"], [4, "on_track"], [4, "on_track"], [5, "on_track"], [5, "on_track"], [5, "on_track", "TVC cuối đang dựng."]]) },
      { title: "Số vòng sửa trung bình mỗi TVC", type: "number", start: 3.5, target: 2, checkIns: weekly("2026-07-27", [[3.2, "at_risk"], [3, "at_risk"], [2.8, "on_track"], [2.6, "on_track"], [2.5, "on_track"], [2.4, "on_track"], [2.4, "on_track"], [2.3, "on_track"]]) },
    ],
  },
  {
    key: "huy26q3", level: "individual", person: HUY, owner: HUY, parent: "vid26q3", period: "2026-Q3", title: "Dựng nhanh hơn và học color grading",
    krs: [
      { title: "Thời gian dựng bản nháp đầu (giờ/video)", type: "number", start: 14, target: 9, weight: 2, checkIns: weekly("2026-07-13", [[13.5, "on_track"], [13, "on_track"], [12, "on_track"], [12, "at_risk", "Dự án gấp, không kịp áp dụng template."], [11.5, "at_risk"], [11, "on_track"], [10.5, "on_track"], [10.5, "on_track"]]) },
      { title: "Khoá học DaVinci Resolve", type: "milestone", milestones: ["Đăng ký khoá học", "Hoàn thành 50% bài", "Hoàn thành khoá", "Áp dụng vào một dự án thật", "Chia sẻ lại cho cả phòng"], checkIns: [["2026-07-20", 1, "on_track"], ["2026-08-17", 2, "on_track"], ["2026-09-07", 3, "on_track", "Xong khoá, đang chọn dự án để áp dụng."]] },
    ],
  },
  {
    key: "linh26q3", level: "individual", person: LINH, owner: LINH, parent: "vid26q3", period: "2026-Q3", title: "Hoà nhập và tự dựng được video social",
    krs: [{ title: "Số video social tự dựng hoàn chỉnh", type: "number", start: 0, target: 12, checkIns: weekly("2026-08-10", [[1, "on_track"], [2, "on_track"], [3, "on_track"], [3, "off_track", "Nghỉ ốm một tuần."], [4, "at_risk"]]) }],
  },
  {
    key: "des26q3", level: "department", department: "DES", entity: "SZC", owner: CHI, parent: "g26", period: "2026-Q3", title: "Phòng Thiết kế: bộ nhận diện dùng chung cho mọi khách retainer",
    krs: [
      { title: "Khách retainer có brand kit hoàn chỉnh", type: "number", start: 2, target: 8, checkIns: weekly("2026-07-20", [[3, "on_track"], [3, "on_track"], [4, "on_track"], [5, "on_track"], [5, "at_risk"], [6, "on_track"], [6, "on_track"], [7, "on_track"]]) },
      { title: "Tỷ lệ thiết kế được duyệt ngay vòng đầu", type: "percent", start: 55, target: 75, checkIns: weekly("2026-08-03", [[58, "at_risk"], [60, "at_risk"], [63, "on_track"], [66, "on_track"], [68, "on_track"]]) },
    ],
  },
  {
    key: "khoi26q3", level: "individual", person: KHOI, owner: KHOI, parent: "des26q3", period: "2026-Q3", title: "Hoàn thiện brand kit cho 3 khách hàng",
    krs: [{ title: "Brand kit đã bàn giao", type: "number", start: 0, target: 3, checkIns: weekly("2026-07-27", [[0, "on_track"], [1, "on_track"], [1, "on_track"], [1, "at_risk"], [2, "on_track"], [2, "on_track"]]) }],
  },
  {
    key: "duc26q3", level: "individual", person: DUC, owner: DUC, parent: "g26", period: "2026-Q3", title: "Tăng tương tác các kênh social của khách retainer",
    krs: [
      { title: "Tỷ lệ tương tác trung bình", type: "percent", start: 2.1, target: 3.5, checkIns: weekly("2026-07-13", [[2.2, "on_track"], [2.4, "on_track"], [2.5, "on_track"], [2.4, "at_risk"], [2.7, "at_risk"], [2.9, "on_track"], [3, "on_track"], [3.1, "on_track"], [3.2, "on_track"]]) },
      { title: "Chi phí quảng cáo trên mỗi lượt tương tác", type: "currency", start: 1_800, target: 1_200, checkIns: weekly("2026-08-03", [[1_750, "at_risk"], [1_600, "at_risk"], [1_520, "on_track"], [1_450, "on_track"], [1_400, "on_track"]]) },
    ],
  },
  {
    key: "hr26q2", level: "department", department: "HR", owner: MAI, parent: "g26", period: "2026-Q2", status: "closed", closedOn: "2026-07-03", closedBy: MAI, title: "Nhân sự: chuẩn hoá hồ sơ và hợp đồng (Q2/2026)",
    krs: [
      { title: "Hồ sơ nhân viên đủ giấy tờ", type: "percent", start: 60, target: 100, weight: 2, checkIns: [["2026-04-20", 72, "on_track"], ["2026-05-18", 85, "on_track"], ["2026-06-29", 96, "on_track"]] },
      { title: "Hợp đồng được ký lại theo mẫu mới", type: "milestone", milestones: ["Mẫu hợp đồng được duyệt", "Ký lại SZM", "Ký lại SZC", "Ký lại SZG"], checkIns: [["2026-05-18", 2, "on_track"], ["2026-06-29", 3, "at_risk", "SZG dời sang tháng 7."]] },
    ],
  },
  { key: "bao26q4", level: "individual", person: BAO, owner: BAO, period: "2026-Q4", status: "draft", title: "Đưa chấm công và nghỉ phép của SZM lên SuZu One", krs: [{ title: "Nhân viên SZM chấm công trên ứng dụng", type: "percent", start: 0, target: 95 }] },

  // ── 2027: the company's tree ────────────────────────────────────────────────────────────
  {
    key: "g27rev", level: "group", owner: HA, period: "2027", weight: 3, title: "Doanh thu tập đoàn 2027 đạt 60 tỷ đồng với biên lợi nhuận 22%",
    krs: [
      { title: "Doanh thu hợp nhất", type: "currency", start: 0, target: 60_000_000_000, weight: 3 },
      { title: "Biên lợi nhuận gộp", type: "percent", start: 18, target: 22, weight: 2 },
      { title: "Khách hàng retainer mới", type: "number", start: 0, target: 10 },
    ],
  },
  {
    key: "g27people", level: "group", owner: HA, period: "2027", weight: 2, title: "SuZu là nơi người giỏi muốn ở lại",
    krs: [
      { title: "Tỷ lệ nghỉ việc tự nguyện", type: "percent", start: 14, target: 9 },
      { title: "eNPS", type: "number", start: 18, target: 35 },
      { title: "Vận hành nhân sự trên SuZu One", type: "milestone", milestones: ["Chấm công & nghỉ phép", "OKR & KPI", "Bảng lương chạy song song", "Bảng lương chính thức", "Đánh giá cuối năm & thưởng"] },
    ],
  },
  { key: "szm27", level: "entity", entity: "SZM", owner: LONG, parent: "g27rev", period: "2027", weight: 2, title: "SuZu Media: 24 tỷ doanh thu sản xuất video", krs: [{ title: "Doanh thu SuZu Media", type: "currency", start: 0, target: 24_000_000_000, weight: 2 }, { title: "Dự án bàn giao đúng hạn", type: "percent", start: 78, target: 92 }] },
  { key: "szc27", level: "entity", entity: "SZC", owner: HA, parent: "g27rev", period: "2027", weight: 3, title: "SuZu Creative: 36 tỷ doanh thu, 10 khách retainer mới", krs: [{ title: "Doanh thu SuZu Creative", type: "currency", start: 0, target: 36_000_000_000, weight: 2 }, { title: "Khách retainer mới", type: "number", start: 0, target: 10 }] },
  { key: "vid27", level: "department", department: "VID", entity: "SZM", owner: LONG, parent: "szm27", period: "2027", title: "Phòng Video: đúng hạn 92%, tối đa 2 vòng sửa" },
  { key: "des27", level: "department", department: "DES", entity: "SZC", owner: CHI, parent: "szc27", period: "2027", title: "Phòng Thiết kế: duyệt ngay vòng đầu đạt 80%", krs: [{ title: "Thiết kế được duyệt ngay vòng đầu", type: "percent", start: 68, target: 80 }, { title: "Thời gian ra concept (ngày)", type: "number", start: 5, target: 3 }] },
  { key: "soc27", level: "department", department: "SOC", entity: "SZC", owner: DUC, parent: "szc27", period: "2027", title: "Social: tương tác trung bình 4% trên các kênh retainer", krs: [{ title: "Tỷ lệ tương tác trung bình", type: "percent", start: 3.2, target: 4 }, { title: "Báo cáo tháng gửi khách trước ngày 5", type: "percent", start: 70, target: 100 }] },
  { key: "acc27", level: "department", department: "ACC", entity: "SZC", owner: HA, parent: "szc27", period: "2027", status: "draft", title: "Account: CSAT 4,5 và gia hạn 90% hợp đồng retainer", krs: [{ title: "CSAT", type: "number", start: 4.25, target: 4.5 }, { title: "Tỷ lệ gia hạn retainer", type: "percent", start: 80, target: 90 }] },
  { key: "hr27", level: "department", department: "HR", owner: MAI, parent: "g27people", period: "2027", title: "Nhân sự: giữ người và vận hành trên SuZu One", krs: [{ title: "Nhân viên có OKR hoặc KPI được giao", type: "percent", start: 0, target: 100 }, { title: "Thời gian tuyển một vị trí (ngày)", type: "number", start: 45, target: 30 }] },
  { key: "fin27", level: "department", department: "FIN", owner: TUAN, parent: "g27rev", period: "2027", title: "Tài chính: đóng sổ tháng trong 5 ngày làm việc", krs: [{ title: "Số ngày đóng sổ tháng", type: "number", start: 9, target: 5 }, { title: "Công nợ quá hạn trên 60 ngày", type: "currency", start: 1_450_000_000, target: 500_000_000 }] },

  { key: "long27", level: "individual", person: LONG, owner: LONG, parent: "szm27", period: "2027", title: "Xây đội sản xuất tự chủ, không phụ thuộc một người", krs: [{ title: "Đạo diễn có thể dẫn dự án độc lập", type: "number", start: 1, target: 3 }, { title: "Quy trình sản xuất được viết thành tài liệu", type: "milestone", milestones: ["Tiền kỳ", "Quay", "Hậu kỳ", "Bàn giao & lưu trữ"] }] },
  { key: "tam27", level: "individual", person: TAM, owner: TAM, parent: "vid27", period: "2027", weight: 2, title: "Đạo diễn 20 TVC đúng hạn với tối đa 2 vòng sửa", krs: [{ title: "TVC bàn giao đúng hạn", type: "number", start: 0, target: 20, weight: 2 }, { title: "Số vòng sửa trung bình", type: "number", start: 2.3, target: 2 }] },
  { key: "huy27", level: "individual", person: HUY, owner: HUY, parent: "vid27", period: "2027", title: "Dựng bản nháp đầu trong 8 giờ và làm chủ color grading", krs: [{ title: "Thời gian dựng bản nháp đầu (giờ/video)", type: "number", start: 10.5, target: 8, weight: 2 }, { title: "Dự án tự chỉnh màu hoàn chỉnh", type: "number", start: 0, target: 10 }] },
  { key: "linh27", level: "individual", person: LINH, owner: LINH, parent: "vid27", period: "2027-Q1", status: "draft", title: "Qua thử việc và nhận dự án dựng độc lập", krs: [{ title: "Video dựng độc lập được khách duyệt", type: "number", start: 0, target: 15 }] },
  { key: "chi27", level: "individual", person: CHI, owner: CHI, parent: "des27", period: "2027", title: "Phát triển đội thiết kế lên 5 người vững nghề", krs: [{ title: "Designer đạt chuẩn senior nội bộ", type: "number", start: 1, target: 3 }, { title: "Buổi review thiết kế hằng tuần được duy trì", type: "percent", start: 50, target: 90 }] },
  { key: "khoi27", level: "individual", person: KHOI, owner: KHOI, parent: "des27", period: "2027", title: "Dẫn dắt nhận diện cho 4 khách hàng mới", krs: [{ title: "Bộ nhận diện bàn giao", type: "number", start: 0, target: 4 }, { title: "Thiết kế được duyệt ngay vòng đầu", type: "percent", start: 66, target: 80 }] },
  { key: "duc27", level: "individual", person: DUC, owner: DUC, parent: "soc27", period: "2027", title: "Đưa 3 kênh khách hàng vượt 100 nghìn người theo dõi", krs: [{ title: "Kênh vượt 100 nghìn người theo dõi", type: "number", start: 0, target: 3 }, { title: "Chi phí trên mỗi lượt tương tác", type: "currency", start: 1_400, target: 1_000 }] },
  { key: "mai27", level: "individual", person: MAI, owner: MAI, parent: "hr27", period: "2027", title: "Hoàn tất chuyển đổi vận hành nhân sự sang SuZu One", krs: [{ title: "Phân hệ đã vận hành chính thức", type: "milestone", milestones: ["Chấm công & nghỉ phép", "OKR & KPI", "Bảng lương", "Đánh giá cuối năm"] }] },
  { key: "bao27", level: "individual", person: BAO, owner: BAO, parent: "hr27", period: "2027", title: "Hồ sơ và chấm công SZM sạch 100% mỗi tháng", krs: [{ title: "Bảng công SZM khoá trước ngày 2", type: "percent", start: 60, target: 100 }, { title: "Hồ sơ nhân viên SZM đủ giấy tờ", type: "percent", start: 96, target: 100 }] },
  { key: "tuan27", level: "individual", person: TUAN, owner: TUAN, parent: "fin27", period: "2027", title: "Tự động hoá báo cáo quản trị hằng tháng", krs: [{ title: "Báo cáo quản trị gửi trước ngày 7", type: "percent", start: 40, target: 100 }] },
];

const scaled = (type: MetricType, value: number) => Math.round(value * scaleOf(type));

export async function seedPerformance(db: Db): Promise<string> {
  if ((await db.select({ id: goal.id }).from(goal).limit(1)).length > 0) return "performance: goals already seeded, skipped";
  const people = new Map((await db.select().from(person)).map((row) => [row.fullName, row]));
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row.id]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row.id]));
  if (!people.has(HA)) return "performance: demo people missing, skipped";

  const ids = new Map<string, string>();
  const inputs = new Map<string, GoalInput>();
  let keyResults = 0;
  let checkIns = 0;

  await db.transaction(async (tx) => {
    for (const demo of GOALS) {
      const subject = demo.person ? people.get(demo.person) : undefined;
      const owner = people.get(demo.owner);
      if (!owner || (demo.person && !subject)) continue;
      const [row] = await tx
        .insert(goal)
        .values({
          level: demo.level,
          entityId: subject ? subject.primaryEntityId : demo.entity ? entities.get(demo.entity) : null,
          departmentId: subject ? subject.departmentId : demo.department ? departments.get(demo.department) : null,
          teamId: subject?.teamId ?? null,
          personId: subject?.id ?? null,
          ownerPersonId: owner.id,
          parentGoalId: demo.parent ? (ids.get(demo.parent) ?? null) : null,
          title: demo.title,
          description: demo.description ?? null,
          year: yearOfPeriod(demo.period),
          periodKey: demo.period,
          status: demo.status === "closed" ? "active" : (demo.status ?? "active"),
          weight: demo.weight ?? 1,
          createdByPersonId: owner.id,
          createdAt: new Date(`${demo.period.slice(0, 4) === "2027" ? "2026-09-14" : "2026-01-05"}T02:00:00Z`),
        })
        .returning();
      ids.set(demo.key, row.id);
      const input: GoalInput = { id: row.id, status: demo.status ?? "active", weight: demo.weight ?? 1, finalProgressBp: null, keyResults: [], childIds: [] };
      inputs.set(row.id, input);
      if (row.parentGoalId) inputs.get(row.parentGoalId)?.childIds.push(row.id);

      for (const [index, kr] of (demo.krs ?? []).entries()) {
        const milestones = kr.type === "milestone" ? (kr.milestones ?? []).map((title) => ({ title, done: false })) : null;
        const last = kr.checkIns?.at(-1);
        const doneAt = (count: number) => milestones!.map((milestone, position) => ({ ...milestone, done: position < count }));
        const values = {
          startValue: milestones ? 0 : scaled(kr.type, kr.start ?? 0),
          targetValue: milestones ? milestones.length : scaled(kr.type, kr.target ?? 0),
          currentValue: milestones ? (last?.[1] ?? 0) : scaled(kr.type, last?.[1] ?? kr.start ?? 0),
          milestones: milestones ? doneAt(last?.[1] ?? 0) : null,
        };
        const [saved] = await tx
          .insert(keyResult)
          .values({ goalId: row.id, title: kr.title, metricType: kr.type, weight: kr.weight ?? 1, sortOrder: index, ...values, confidence: last?.[2] ?? null, lastCheckInAt: last ? new Date(`${last[0]}T09:30:00+07:00`) : null })
          .returning();
        keyResults++;
        input.keyResults.push({ id: saved.id, metricType: kr.type, ...values, weight: kr.weight ?? 1, confidence: last?.[2] ?? null });
        for (const [date, value, confidence, note] of kr.checkIns ?? []) {
          await tx.insert(goalCheckIn).values({ keyResultId: saved.id, goalId: row.id, weekStart: weekStartOf(date), value: milestones ? value : scaled(kr.type, value), milestones: milestones ? doneAt(value) : null, confidence, note: note ?? null, authorPersonId: owner.id, createdAt: new Date(`${date}T09:30:00+07:00`) });
          checkIns++;
        }
      }
    }
    // Closed goals carry the engine's figure of that moment, as `moveGoal` would have written it.
    for (const demo of GOALS.filter((item) => item.status === "closed")) {
      const id = ids.get(demo.key);
      if (!id) continue;
      inputs.get(id)!.status = "active";
      const figure = goalProgress(id, inputs).progressBp;
      inputs.get(id)!.status = "closed";
      inputs.get(id)!.finalProgressBp = figure;
      await tx.update(goal).set({ status: "closed", finalProgressBp: figure, closedAt: new Date(`${demo.closedOn ?? "2026-07-01"}T10:00:00+07:00`), closedByPersonId: people.get(demo.closedBy ?? demo.owner)?.id ?? null }).where(eq(goal.id, id));
    }
  });
  return `performance: ${ids.size} goals (2026 running, 2027 tree), ${keyResults} key results, ${checkIns} check-ins`;
}
