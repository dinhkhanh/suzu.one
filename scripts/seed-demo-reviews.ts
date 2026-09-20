// Phase 8 demo data for review cycles (FR-PRF-03), called from seed-demo.ts after the goals and
// KPIs. Idempotent: skipped once any review cycle exists. Rows are written the way the use-cases
// write them — the form is snapshotted onto the cycle, each participant carries the manager they
// had at launch, and every submitted form carries the figure the pure engine gives for its
// answers, so week 2's final yearly result reads exactly what a real cycle would have left.
//
// One 2026 annual cycle for Suzu Media (SZM), most of the way through:
//   · everyone has self-reviewed except one person (so the "waiting for the self review" path is live)
//   · their managers have written and submitted, except for that one
//   · two people are calibrated and released, one of them has acknowledged
//   · peer nominations are approved and one peer form is in (week 2 drives the rest)
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { entity, person, reviewCycle, reviewForm, reviewParticipant, reviewPeerNomination, reviewTemplate } from "../src/lib/db/schema";
import { scoreReviewForm } from "../src/modules/performance/engine/review-score";
import type { RatingPoint, ReviewAnswers, ReviewFormKind, ReviewFormShape, ReviewSection } from "../src/modules/performance/enums";

type Db = ReturnType<typeof drizzle>;

const HA = "Nguyễn Thu Hà";
const MAI = "Lê Thị Mai";
const BAO = "Phạm Quốc Bảo";
const LONG = "Đặng Hoàng Long";
const TAM = "Bùi Thanh Tâm";
const HUY = "Hồ Gia Huy";
const LINH = "Đỗ Khánh Linh";

/** "Đạt yêu cầu" is worth exactly 100 %: the company's choice, kept in the template, not in code. */
const SCALE: RatingPoint[] = [
  { value: 1, label: "Chưa đạt yêu cầu", labelEn: "Below expectations", scoreBp: 4000 },
  { value: 2, label: "Cần cải thiện", labelEn: "Needs improvement", scoreBp: 7000 },
  { value: 3, label: "Đạt yêu cầu", labelEn: "Meets expectations", scoreBp: 10000 },
  { value: 4, label: "Vượt mong đợi", labelEn: "Exceeds expectations", scoreBp: 11500 },
  { value: 5, label: "Xuất sắc", labelEn: "Outstanding", scoreBp: 13000 },
];

const SECTIONS: ReviewSection[] = [
  { key: "quality", title: "Chất lượng công việc", titleEn: "Quality of work", kind: "rating", weight: 30, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "ownership", title: "Tinh thần chủ động, trách nhiệm", titleEn: "Ownership", kind: "rating", weight: 25, required: true, askedOf: ["self", "manager"] },
  { key: "teamwork", title: "Phối hợp với đồng nghiệp", titleEn: "Teamwork", kind: "rating", weight: 25, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "growth", title: "Học hỏi và phát triển", titleEn: "Learning and growth", kind: "rating", weight: 20, required: true, askedOf: ["self", "manager"] },
  { key: "highlights", title: "Điểm nổi bật trong năm", titleEn: "Highlights of the year", kind: "text", weight: 0, required: true, askedOf: ["self", "manager", "peer"] },
  { key: "improve", title: "Điều cần cải thiện năm sau", titleEn: "What to improve next year", kind: "text", weight: 0, required: false, askedOf: ["self", "manager", "peer"] },
];

// [name, self answers + comment, manager answers + comment, how far it got]
type Fill = {
  who: string;
  self?: { answers: ReviewAnswers; comment: string };
  manager?: { by: string; answers: ReviewAnswers; comment: string };
  calibrate?: { bp: number; note: string; by: string };
  release?: string;
  acknowledge?: string;
  peers?: { by: string; answers: ReviewAnswers; comment: string }[];
};

const FILLS: Fill[] = [
  {
    who: HUY,
    self: { answers: { quality: 4, ownership: 3, teamwork: 4, growth: 5, highlights: "Rút thời gian dựng bản nháp đầu từ 14 giờ xuống 10,5 giờ và học xong khoá DaVinci Resolve.", improve: "Chủ động hỏi brief sớm hơn để đỡ phải sửa nhiều vòng." }, comment: "Một năm học được nhiều, nhất là phần color grading." },
    manager: { by: LONG, answers: { quality: 4, ownership: 3, teamwork: 4, growth: 5, highlights: "Tiến bộ rõ về tốc độ dựng; đã chia sẻ lại kiến thức color cho cả phòng.", improve: "Cần tự tin hơn khi trao đổi trực tiếp với khách." }, comment: "Đồng ý với phần tự đánh giá. Là người tiến bộ nhanh nhất phòng năm nay." },
    calibrate: { bp: 11200, note: "Cân đối theo mặt bằng chung của phòng Video: giữ ở mức vượt mong đợi.", by: HA },
    release: LONG,
    acknowledge: "Cảm ơn anh. Em sẽ chú ý phần trao đổi với khách.",
    peers: [{ by: LINH, answers: { quality: 4, teamwork: 5, highlights: "Anh Huy hướng dẫn em rất kỹ khi em mới vào.", improve: "" }, comment: "Rất dễ hỏi và sẵn sàng giúp." }],
  },
  {
    who: TAM,
    self: { answers: { quality: 4, ownership: 4, teamwork: 3, growth: 3, highlights: "Đạo diễn 6 TVC, 5 bàn giao đúng hạn; số vòng sửa trung bình giảm từ 3,5 xuống 2,4.", improve: "Giao việc lại cho đội nhiều hơn thay vì ôm." }, comment: "Quý 3 nặng nhưng giữ được chất lượng." },
    manager: { by: LONG, answers: { quality: 4, ownership: 4, teamwork: 3, growth: 4, highlights: "Giữ được chất lượng khi khối lượng tăng; khách hài lòng.", improve: "Phân việc cho Huy và Linh nhiều hơn để đỡ nghẽn ở một người." }, comment: "Trụ cột của phòng. Cần tập giao việc." },
    release: LONG,
  },
  {
    who: LONG,
    self: { answers: { quality: 4, ownership: 5, teamwork: 4, growth: 3, highlights: "Phòng Video đạt 95 % đúng hạn và giữ CSAT 4,25.", improve: "Xây quy trình hậu kỳ chuẩn hoá hơn." }, comment: "Một năm ổn định." },
    manager: { by: HA, answers: { quality: 4, ownership: 5, teamwork: 4, growth: 3, highlights: "Phòng chạy đều, không còn phụ thuộc vào một người.", improve: "Cần chuẩn bị người kế cận." }, comment: "Đồng ý." },
  },
  {
    who: BAO,
    self: { answers: { quality: 3, ownership: 3, teamwork: 4, growth: 4, highlights: "Hồ sơ nhân sự đúng hạn 95 %, hỗ trợ tốt cho kỳ lương.", improve: "Nắm chắc hơn phần bảo hiểm." }, comment: "Năm đầu phụ trách một pháp nhân riêng." },
    manager: { by: MAI, answers: { quality: 3, ownership: 4, teamwork: 4, growth: 4, highlights: "Chủ động hơn hẳn nửa cuối năm.", improve: "Phần bảo hiểm cần chắc tay hơn." }, comment: "Tiến bộ đều." },
  },
  // Linh joined in August and has not written hers: the manager review is blocked until the due
  // date passes, which is exactly the path the screen has to explain.
  { who: LINH, peers: [] },
];

export async function seedReviews(db: Db): Promise<string> {
  const [already] = await db.select({ id: reviewCycle.id }).from(reviewCycle).limit(1);
  if (already) return "0 review cycles (already seeded)";

  const [szm] = await db.select().from(entity).where(eq(entity.code, "SZM")).limit(1);
  if (!szm) return "0 review cycles (no SZM entity)";
  const people = await db.select({ id: person.id, fullName: person.fullName, managerId: person.managerId, entityId: person.primaryEntityId, departmentId: person.departmentId, workforceType: person.workforceType, status: person.status }).from(person);
  const byName = new Map(people.map((row) => [row.fullName, row]));
  const mai = byName.get(MAI);
  if (!mai) return "0 review cycles (run the people seed first)";

  const shape: ReviewFormShape = { sections: SECTIONS, ratingScale: SCALE };
  const [template] = await db
    .insert(reviewTemplate)
    .values({ name: "Đánh giá năm — biểu mẫu chuẩn", nameEn: "Annual review — standard form", description: "Bốn nhóm năng lực chấm điểm và hai câu tự luận. Mức “Đạt yêu cầu” tương đương 100 %.", sections: SECTIONS, ratingScale: SCALE, isActive: true, createdByPersonId: mai.id })
    .returning();

  const [cycle] = await db
    .insert(reviewCycle)
    .values({
      entityId: szm.id,
      name: "Đánh giá năm 2026 — Suzu Media",
      kind: "annual",
      year: 2026,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      templateId: template.id,
      formSnapshot: shape,
      selfDueOn: "2026-12-05",
      managerDueOn: "2026-12-15",
      peerDueOn: "2026-12-10",
      calibrationOn: "2026-12-18",
      releaseOn: "2026-12-22",
      status: "active",
      peersEnabled: true,
      peerMin: 1,
      peerMax: 3,
      peerAnonymous: true,
      launchedAt: new Date("2026-11-25T02:00:00Z"),
      launchedByPersonId: mai.id,
      createdByPersonId: mai.id,
    })
    .returning();

  // Who the cycle covers, exactly as `launchReviewCycle` works it out.
  const participants = people.filter((row) => row.status === "active" && row.workforceType !== "collaborator" && row.entityId === szm.id);
  const rows = await db
    .insert(reviewParticipant)
    .values(participants.map((row) => ({ cycleId: cycle.id, personId: row.id, entityId: row.entityId, departmentId: row.departmentId, managerPersonId: row.managerId })))
    .returning();
  const participantOf = new Map(rows.map((row) => [row.personId, row]));

  let forms = 0;
  const writeForm = async (participantId: string, subjectPersonId: string, kind: ReviewFormKind, authorPersonId: string, answers: ReviewAnswers, comment: string, at: string) => {
    const trace = scoreReviewForm(shape, kind, answers);
    await db.insert(reviewForm).values({ cycleId: cycle.id, participantId, subjectPersonId, authorPersonId, kind, status: "submitted", answers, overallRatingBp: trace.scoreBp, scoreTrace: trace, comment, submittedAt: new Date(at) });
    forms++;
  };

  let released = 0;
  for (const fill of FILLS) {
    const subject = byName.get(fill.who);
    const participant = subject ? participantOf.get(subject.id) : null;
    if (!subject || !participant) continue;

    if (fill.self) await writeForm(participant.id, subject.id, "self", subject.id, fill.self.answers, fill.self.comment, "2026-12-03T03:00:00Z");
    if (fill.manager) {
      const author = byName.get(fill.manager.by);
      if (author) await writeForm(participant.id, subject.id, "manager", author.id, fill.manager.answers, fill.manager.comment, "2026-12-12T07:00:00Z");
    }
    for (const peer of fill.peers ?? []) {
      const author = byName.get(peer.by);
      if (!author) continue;
      await db.insert(reviewPeerNomination).values({ cycleId: cycle.id, participantId: participant.id, peerPersonId: author.id, nominatedByPersonId: subject.id, status: "approved", decidedByPersonId: participant.managerPersonId, decidedAt: new Date("2026-11-28T02:00:00Z") });
      await writeForm(participant.id, subject.id, "peer", author.id, peer.answers, peer.comment, "2026-12-09T04:00:00Z");
    }

    // The stage follows what was actually written, exactly as the use-case moves it.
    const managerBp = fill.manager ? scoreReviewForm(shape, "manager", fill.manager.answers).scoreBp : null;
    const stage = fill.acknowledge ? "acknowledged" : fill.release ? "released" : fill.calibrate ? "calibrated" : fill.manager ? "manager_done" : fill.self ? "self_done" : "pending";
    const calibratedBy = fill.calibrate ? byName.get(fill.calibrate.by) : null;
    const releasedBy = fill.release ? byName.get(fill.release) : null;
    await db
      .update(reviewParticipant)
      .set({
        stage,
        reviewScoreBp: fill.release ? (fill.calibrate?.bp ?? managerBp) : (fill.calibrate?.bp ?? null),
        calibrationNote: fill.calibrate?.note ?? null,
        calibratedAt: fill.calibrate ? new Date("2026-12-18T08:00:00Z") : null,
        calibratedByPersonId: calibratedBy?.id ?? null,
        releasedAt: fill.release ? new Date("2026-12-22T03:00:00Z") : null,
        releasedByPersonId: releasedBy?.id ?? null,
        acknowledgedAt: fill.acknowledge ? new Date("2026-12-23T02:30:00Z") : null,
        acknowledgementNote: fill.acknowledge ?? null,
      })
      .where(eq(reviewParticipant.id, participant.id));
    if (fill.release) released++;
  }

  return `1 review cycle (2026, ${rows.length} participants), ${forms} submitted forms, ${released} released`;
}
