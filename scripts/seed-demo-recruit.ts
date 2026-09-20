// Demo recruitment for the fake company (FR-REC-01..13) — and, above everything else, **the phase's
// exit criterion**: one opening that runs the whole way, application → interviews → offer →
// employee record, with nothing retyped.
//
// Written through the module's own tables rather than its services, for the same reason
// `seed-demo-assets.ts` is: a seed is a script with no session, and every service in `src/modules`
// imports `server-only`, which throws outside a server runtime. What is written here is exactly
// the shape the use-cases write — first stage from the pipeline, an `application_event` for every
// move, the offer number in the format `offers.ts` mints, the person row `hireInTransaction`
// creates — and the constraints that matter (one application per candidate and opening, one live
// offer, one person per application) are the database's either way.
//
// The arc, deliberately dated backwards from today so the funnel report has something to measure:
//   · a head asks for a video editor, the ask is approved and fulfilled by the opening;
//   · somebody applies through the careers page, with consent and a salary expectation;
//   · they are screened, phone-screened, interviewed twice — **two interviewers, both scorecards
//     submitted**, which is what makes the blind-feedback rule visible on screen;
//   · an offer is made, approved, sent and accepted;
//   · and it becomes a **pre-boarding** person whose name, mailbox, phone and town are the ones
//     the candidate typed and whose job, manager and start date are the ones the offer promised.
//
// Beside it: a second opening with somebody sitting at every stage, a rejection, a referral, a
// talent-pool candidate who survives the retention job, and one whose window has passed so that
// the job has something to do.
import { randomBytes } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import {
  applicationEvent,
  assignment,
  candidate,
  department,
  documentTemplate,
  employeeCodeScheme,
  employment,
  entity,
  hiringRequest,
  interview,
  interviewInterviewer,
  interviewScorecard,
  jobApplication,
  jobOffer,
  jobOpening,
  jobOpeningMember,
  person,
  personProfile,
  position,
  recruitPipeline,
  recruitPipelineStage,
  referral,
} from "../src/lib/db/schema";
import { normaliseEmail, normalisePhone } from "../src/modules/recruit/engine/duplicates";
import { CONSENT_VERSION, DEFAULT_INTERVIEW_KIT } from "../src/modules/recruit/enums";
import { toSearchKey } from "../src/lib/text";

type Db = ReturnType<typeof drizzle>;

export type RecruitSeedResult = { openings: number; candidates: number; applications: number; interviews: number; offers: number; referrals: number; hired: string | null };

const day = (today: string, offset: number): string => {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

/** An instant on a given day, in Vietnam's working hours — 09:00 local is 02:00 UTC. */
const at = (isoDay: string, hour: number): Date => new Date(`${isoDay}T${String(hour - 7).padStart(2, "0")}:00:00Z`);

const slug = () => randomBytes(16).toString("base64url");

export async function seedRecruit(db: Db, today: string): Promise<RecruitSeedResult> {
  const result: RecruitSeedResult = { openings: 0, candidates: 0, applications: 0, interviews: 0, offers: 0, referrals: 0, hired: null };

  // Already seeded? The whole arc hangs off the first opening's code, so one look is enough.
  const [existing] = await db.select({ id: jobOpening.id }).from(jobOpening).where(eq(jobOpening.code, "SZM-2026-001")).limit(1);
  if (existing) return result;

  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row]));
  const people = new Map((await db.select().from(person)).map((row) => [row.workEmail ?? row.fullName, row]));
  const pipelines = new Map((await db.select().from(recruitPipeline)).map((row) => [row.code, row]));
  if (!pipelines.has("STANDARD")) throw new Error("Run `pnpm db:seed` first (no recruitment pipelines).");

  const stagesOf = async (pipelineId: string) => db.select().from(recruitPipelineStage).where(eq(recruitPipelineStage.pipelineId, pipelineId)).orderBy(asc(recruitPipelineStage.sortOrder));
  const standard = pipelines.get("STANDARD")!;
  const standardStages = await stagesOf(standard.id);
  const stageBy = (key: string) => standardStages.find((stage) => stage.key === key)!;

  const szm = entities.get("SZM")!;
  const szc = entities.get("SZC")!;
  const vid = departments.get("VID")!;
  const des = departments.get("DES")!;
  const hrLead = people.get("mai.le@suzu.group")!;
  const recruiter = people.get("bao.pham@suzu.group")!;
  const videoHead = people.get("long.dang@suzu.group")!;
  const editor = people.get("huy.ho@suzu.group")!;
  const director = people.get("tam.bui@suzu.group")!;
  const designLead = people.get("chi.duong@suzu.group")!;

  await db.transaction(async (tx) => {
    // ── The ask (FR-REC-01) ─────────────────────────────────────────────────────────────────
    const [ask] = await tx
      .insert(hiringRequest)
      .values({
        entityId: szm.id,
        departmentId: vid.id,
        positionTitle: "Chuyên viên Dựng phim",
        jobLevel: "Middle",
        headcount: 1,
        employmentType: "employee",
        workLocation: "Hà Nội",
        reason: "Khối lượng dự án quảng cáo tăng; hiện một dựng phim đang gánh hai tuyến công việc.",
        targetStartDate: day(today, 30),
        // The budget lives here and never in the approval payload.
        budgetMinVnd: 18_000_000,
        budgetMaxVnd: 24_000_000,
        requestedByPersonId: videoHead.id,
        hiringManagerPersonId: videoHead.id,
        status: "fulfilled",
        createdAt: at(day(today, -75), 9),
        updatedAt: at(day(today, -70), 15),
      })
      .returning();

    // ── The opening that runs end to end (FR-REC-02) ────────────────────────────────────────
    const [opening] = await tx
      .insert(jobOpening)
      .values({
        code: "SZM-2026-001",
        title: "Chuyên viên Dựng phim",
        titleEn: "Video Editor",
        entityId: szm.id,
        departmentId: vid.id,
        positionName: "Dựng phim",
        jobLevel: "Middle",
        employmentType: "employee",
        workMode: "onsite",
        workLocation: "Hà Nội",
        headcount: 1,
        description:
          "Suzu Media đang tìm một người dựng phim cho tuyến quảng cáo thương hiệu.\n\nBạn sẽ làm việc cùng đạo diễn và bộ phận sáng tạo từ lúc có kịch bản cho tới bản phát sóng: chọn take, dựng thô, dựng tinh, phối hợp với bộ phận âm thanh và màu.",
        requirements: "Ít nhất 2 năm dựng phim quảng cáo hoặc TVC.\nThành thạo Premiere Pro hoặc DaVinci Resolve.\nCó portfolio để xem.",
        benefits: "Bảo hiểm đầy đủ trên lương thực tế, 12 ngày phép, thiết bị do công ty cấp.",
        salaryMinVnd: 18_000_000,
        salaryMaxVnd: 24_000_000,
        salaryPublic: false,
        pipelineId: standard.id,
        hiringRequestId: ask.id,
        status: "open",
        publicSlug: slug(),
        questions: [
          { key: "portfolio", label: "Cho chúng tôi xem một sản phẩm bạn tự hào nhất và nói ngắn gọn vì sao.", labelEn: "Show us one piece of work you are proudest of, and say briefly why.", kind: "long_text", required: true, choices: [] },
          { key: "software", label: "Bạn dựng chủ yếu bằng phần mềm nào?", labelEn: "Which software do you mainly edit in?", kind: "choice", required: true, choices: ["Premiere Pro", "DaVinci Resolve", "Final Cut Pro", "Khác"] },
        ],
        interviewKit: [...DEFAULT_INTERVIEW_KIT],
        targetStartDate: day(today, 30),
        publishedAt: at(day(today, -70), 10),
        createdByPersonId: recruiter.id,
        createdAt: at(day(today, -70), 9),
      })
      .returning();
    await tx.update(hiringRequest).set({ openingId: opening.id }).where(eq(hiringRequest.id, ask.id));
    result.openings++;

    await tx.insert(jobOpeningMember).values([
      { openingId: opening.id, personId: recruiter.id, role: "recruiter" },
      { openingId: opening.id, personId: videoHead.id, role: "hiring_manager" },
      { openingId: opening.id, personId: editor.id, role: "interviewer" },
    ]);

    // ── The person who got the job ──────────────────────────────────────────────────────────
    const hire = {
      fullName: "Nguyễn Hoài Nam",
      email: "hoainam.nguyen@example.com",
      phone: "0912345678",
      location: "Hà Nội",
      currentTitle: "Video Editor",
      currentEmployer: "Hãng phim quảng cáo Sao Mai",
    };
    const [hired] = await tx
      .insert(candidate)
      .values({
        ...hire,
        searchName: toSearchKey(hire.fullName),
        emailKey: normaliseEmail(hire.email),
        phoneKey: normalisePhone(hire.phone),
        links: ["https://vimeo.com/hoainam", "https://www.behance.net/hoainam"],
        source: "careers_page",
        tags: ["video", "premiere"],
        consentAt: at(day(today, -60), 21),
        consentVersion: CONSENT_VERSION,
        talentPoolConsent: true,
        retainUntil: day(today, 305),
        createdAt: at(day(today, -60), 21),
      })
      .returning();
    result.candidates++;

    const appliedOn = day(today, -60);
    const [application] = await tx
      .insert(jobApplication)
      .values({
        candidateId: hired.id,
        openingId: opening.id,
        stageId: stageBy("hired").id,
        status: "hired",
        source: "careers_page",
        coverLetter: "Tôi theo dõi các TVC của Suzu Media đã lâu và muốn được dựng những sản phẩm như vậy.",
        answers: { portfolio: "TVC Tết cho một nhãn sữa — tôi dựng toàn bộ và tự làm phần chuyển cảnh.", software: "Premiere Pro" },
        portfolioLinks: ["https://vimeo.com/hoainam/tet"],
        salaryExpectationVnd: 22_000_000,
        salaryExpectationNote: "Có thể thương lượng nếu có phụ cấp thiết bị.",
        appliedAt: at(appliedOn, 21),
        stageEnteredAt: at(day(today, -12), 11),
        closedAt: at(day(today, -12), 11),
        decidedByPersonId: recruiter.id,
        createdAt: at(appliedOn, 21),
      })
      .returning();
    result.applications++;

    // Every move, in order, exactly as `moveApplicationStage` writes them.
    const journey: { type: string; from?: string; to?: string; on: number; actor: string | null; note?: string }[] = [
      { type: "applied", to: "applied", on: -60, actor: null },
      { type: "stage_moved", from: "applied", to: "screening", on: -58, actor: recruiter.id },
      { type: "emailed", on: -57, actor: recruiter.id, note: "INVITE_INTERVIEW" },
      { type: "stage_moved", from: "screening", to: "phone_screen", on: -56, actor: recruiter.id },
      { type: "stage_moved", from: "phone_screen", to: "interview", on: -50, actor: recruiter.id },
      { type: "interview_scheduled", on: -49, actor: recruiter.id },
      { type: "scorecard_submitted", on: -44, actor: videoHead.id },
      { type: "scorecard_submitted", on: -44, actor: editor.id },
      { type: "stage_moved", from: "interview", to: "final_interview", on: -40, actor: recruiter.id },
      { type: "interview_scheduled", on: -39, actor: recruiter.id },
      { type: "scorecard_submitted", on: -33, actor: director.id },
      { type: "stage_moved", from: "final_interview", to: "offer", on: -30, actor: recruiter.id },
      { type: "offer_made", on: -25, actor: hrLead.id },
      { type: "offer_accepted", on: -18, actor: recruiter.id },
      { type: "stage_moved", from: "offer", to: "hired", on: -12, actor: recruiter.id },
      { type: "converted", on: -12, actor: hrLead.id },
    ];
    for (const step of journey) {
      await tx.insert(applicationEvent).values({
        applicationId: application.id,
        type: step.type as "applied",
        fromStageId: step.from ? stageBy(step.from).id : null,
        toStageId: step.to ? stageBy(step.to).id : null,
        actorPersonId: step.actor,
        note: step.note ?? null,
        at: at(day(today, step.on), 10),
      });
    }

    // ── Two interviews, four scorecards, all submitted (FR-REC-06) ──────────────────────────
    const rounds = [
      { kind: "technical" as const, title: "Phỏng vấn chuyên môn — dựng phim", on: -45, hour: 14, panel: [videoHead, editor], stage: "interview" },
      { kind: "final" as const, title: "Phỏng vấn cuối — với đạo diễn", on: -34, hour: 10, panel: [director], stage: "final_interview" },
    ];
    const verdicts: Record<string, { ratings: Record<string, number>; recommendation: "yes" | "strong_yes"; strengths: string; concerns: string }> = {
      [videoHead.id]: { ratings: { craft: 4, problem_solving: 3, collaboration: 3, motivation: 4 }, recommendation: "strong_yes", strengths: "Dựng chắc tay, nhịp phim tốt. Hiểu brief nhanh.", concerns: "Chưa làm nhiều với âm thanh hậu kỳ." },
      [editor.id]: { ratings: { craft: 3, problem_solving: 3, collaboration: 4, motivation: 4 }, recommendation: "yes", strengths: "Rất dễ phối hợp, chủ động hỏi lại khi brief chưa rõ.", concerns: "Cần làm quen với quy trình đặt tên file của mình." },
      [director.id]: { ratings: { craft: 4, problem_solving: 4, collaboration: 3, motivation: 3 }, recommendation: "strong_yes", strengths: "Có gu. Đưa ra được lý do cho từng lựa chọn cắt.", concerns: "Kỳ vọng lương ở mức trên của khung." },
    };
    for (const round of rounds) {
      const start = at(day(today, round.on), round.hour);
      const [row] = await tx
        .insert(interview)
        .values({
          applicationId: application.id,
          openingId: opening.id,
          stageId: stageBy(round.stage).id,
          kind: round.kind,
          round: 1,
          title: round.title,
          startAt: start,
          endAt: new Date(start.getTime() + 60 * 60 * 1000),
          mode: "onsite",
          location: "Phòng họp Studio, tầng 3",
          status: "completed",
          notesForCandidate: "Mang theo laptop nếu bạn muốn mở dự án để nói rõ hơn.",
          criteria: [...DEFAULT_INTERVIEW_KIT],
          // No Google credentials on a developer's machine: the local driver, saying so honestly.
          calendarDriver: "local",
          calendarStatus: "simulated",
          scheduledByPersonId: recruiter.id,
          createdAt: at(day(today, round.on - 4), 9),
        })
        .returning();
      result.interviews++;
      for (const [index, panellist] of round.panel.entries()) {
        await tx.insert(interviewInterviewer).values({ interviewId: row.id, personId: panellist.id, isLead: index === 0 });
        const verdict = verdicts[panellist.id];
        await tx.insert(interviewScorecard).values({
          interviewId: row.id,
          interviewerPersonId: panellist.id,
          ratings: verdict.ratings,
          recommendation: verdict.recommendation,
          strengths: verdict.strengths,
          concerns: verdict.concerns,
          // Submitted: the blind is lifted for everybody on this panel, which is the state worth showing.
          submittedAt: at(day(today, round.on + 1), 11),
        });
      }
    }

    // ── The offer, approved, sent and accepted (FR-REC-08) ──────────────────────────────────
    const [offerTemplate] = await tx.select({ id: documentTemplate.id }).from(documentTemplate).where(eq(documentTemplate.code, "TM-NHAN-VIEC")).limit(1);
    const startDate = day(today, 18);
    await tx.insert(jobOffer).values({
      applicationId: application.id,
      openingId: opening.id,
      candidateId: hired.id,
      entityId: szm.id,
      number: "SZM-TM-2026-0001",
      positionName: "Dựng phim",
      jobLevel: "Middle",
      departmentId: vid.id,
      managerPersonId: videoHead.id,
      employmentType: "employee",
      workLocation: "Hà Nội",
      startDate,
      probationMonths: 2,
      probationSalaryPercent: 85,
      baseSalaryVnd: 21_000_000,
      allowancesVnd: 1_500_000,
      status: "accepted",
      expiresOn: day(today, -18),
      letterTemplateId: offerTemplate?.id ?? null,
      sentAt: at(day(today, -24), 16),
      respondedAt: at(day(today, -18), 9),
      note: "Chốt ở giữa khung, cộng phụ cấp thiết bị.",
      createdByPersonId: hrLead.id,
      decidedByPersonId: hrLead.id,
      createdAt: at(day(today, -25), 14),
    });
    result.offers++;

    // ── The colleague (FR-REC-09): nothing retyped ──────────────────────────────────────────
    const [scheme] = await tx.select().from(employeeCodeScheme).where(eq(employeeCodeScheme.entityId, szm.id)).limit(1);
    const number = scheme?.nextNumber ?? 1;
    const employeeCode = `${szm.code}-${String(number).padStart(4, "0")}`;
    const [colleague] = await tx
      .insert(person)
      .values({
        // The candidate's own name and mailbox, as they typed them on the careers page.
        fullName: hire.fullName,
        searchName: toSearchKey(hire.fullName),
        workEmail: null,
        workforceType: "employee",
        // A future start date: Phase 1's daily roll-over turns this into `active` on the day.
        status: "preboarding",
        primaryEntityId: szm.id,
        departmentId: vid.id,
        managerId: videoHead.id,
      })
      .returning();
    await tx.insert(personProfile).values({ personId: colleague.id, nationality: "Việt Nam", phone: hire.phone, personalEmail: hire.email });
    const [job] = await tx
      .insert(position)
      .values({ name: "Dựng phim", searchName: toSearchKey("Dựng phim") })
      .onConflictDoUpdate({ target: position.searchName, set: { name: "Dựng phim" } })
      .returning();
    const [contract] = await tx.insert(employment).values({ personId: colleague.id, entityId: szm.id, employeeCode, startDate, seniorityDate: startDate }).returning();
    await tx.insert(assignment).values({ employmentId: contract.id, workforceType: "employee", departmentId: vid.id, positionId: job.id, managerId: videoHead.id, validFrom: startDate });
    await tx.insert(employeeCodeScheme).values({ entityId: szm.id, prefix: `${szm.code}-`, nextNumber: number + 1 }).onConflictDoUpdate({ target: employeeCodeScheme.entityId, set: { nextNumber: number + 1 } });
    await tx.update(jobApplication).set({ hiredPersonId: colleague.id }).where(eq(jobApplication.id, application.id));
    result.hired = employeeCode;

    // ── A second opening, with somebody at every stage (and one turned down) ─────────────────
    const [designOpening] = await tx
      .insert(jobOpening)
      .values({
        code: "SZC-2026-001",
        title: "Thiết kế đồ hoạ",
        titleEn: "Graphic Designer",
        entityId: szc.id,
        departmentId: des.id,
        positionName: "Thiết kế đồ họa",
        jobLevel: "Junior",
        employmentType: "employee",
        workMode: "hybrid",
        workLocation: "Hà Nội",
        headcount: 2,
        description: "Suzu Creative tìm hai bạn thiết kế cho tuyến social và ấn phẩm thương hiệu.\n\nBạn sẽ làm việc trực tiếp với trưởng nhóm thiết kế và bộ phận nội dung.",
        requirements: "Portfolio rõ ràng.\nThành thạo Figma và bộ Adobe.\nBiết lắng nghe góp ý.",
        benefits: "Bảo hiểm đầy đủ, 12 ngày phép, hai ngày làm việc tại nhà mỗi tuần.",
        salaryMinVnd: 12_000_000,
        salaryMaxVnd: 17_000_000,
        salaryPublic: true,
        pipelineId: standard.id,
        status: "open",
        publicSlug: slug(),
        questions: [{ key: "portfolio", label: "Liên kết portfolio của bạn", labelEn: "A link to your portfolio", kind: "text", required: true, choices: [] }],
        interviewKit: [],
        targetStartDate: day(today, 45),
        publishedAt: at(day(today, -40), 10),
        createdByPersonId: recruiter.id,
        createdAt: at(day(today, -41), 9),
      })
      .returning();
    result.openings++;
    await tx.insert(jobOpeningMember).values([
      { openingId: designOpening.id, personId: recruiter.id, role: "recruiter" },
      { openingId: designOpening.id, personId: designLead.id, role: "hiring_manager" },
    ]);

    // One at each rung of the pipeline, so the board has a card in every column.
    const queue: { name: string; email: string; phone: string; stage: string; appliedOn: number; source: "careers_page" | "job_board" | "social" | "agency" }[] = [
      { name: "Trần Bảo Ngọc", email: "baongoc.tran@example.com", phone: "0921000001", stage: "applied", appliedOn: -4, source: "careers_page" },
      { name: "Lê Hữu Phước", email: "huuphuoc.le@example.com", phone: "0921000002", stage: "screening", appliedOn: -11, source: "job_board" },
      { name: "Phạm Diệu Linh", email: "dieulinh.pham@example.com", phone: "0921000003", stage: "phone_screen", appliedOn: -16, source: "social" },
      { name: "Vũ Đăng Khoa", email: "dangkhoa.vu@example.com", phone: "0921000004", stage: "interview", appliedOn: -22, source: "careers_page" },
      { name: "Hoàng Mỹ Hạnh", email: "myhanh.hoang@example.com", phone: "0921000005", stage: "assignment", appliedOn: -27, source: "agency" },
      { name: "Đinh Tuấn Kiệt", email: "tuankiet.dinh@example.com", phone: "0921000006", stage: "final_interview", appliedOn: -31, source: "careers_page" },
      { name: "Ngô Thanh Vân", email: "thanhvan.ngo@example.com", phone: "0921000007", stage: "offer", appliedOn: -35, source: "job_board" },
    ];
    for (const row of queue) {
      const [made] = await tx
        .insert(candidate)
        .values({
          fullName: row.name,
          searchName: toSearchKey(row.name),
          email: row.email,
          phone: row.phone,
          emailKey: normaliseEmail(row.email),
          phoneKey: normalisePhone(row.phone),
          currentTitle: "Graphic Designer",
          location: "Hà Nội",
          links: [`https://www.behance.net/${row.email.split("@")[0]}`],
          source: row.source,
          consentAt: at(day(today, row.appliedOn), 20),
          consentVersion: CONSENT_VERSION,
          retainUntil: day(today, 365 + row.appliedOn),
          createdAt: at(day(today, row.appliedOn), 20),
        })
        .returning();
      const [made2] = await tx
        .insert(jobApplication)
        .values({
          candidateId: made.id,
          openingId: designOpening.id,
          stageId: stageBy(row.stage).id,
          status: "active",
          source: row.source,
          answers: { portfolio: `https://www.behance.net/${row.email.split("@")[0]}` },
          salaryExpectationVnd: 13_000_000 + queue.indexOf(row) * 500_000,
          appliedAt: at(day(today, row.appliedOn), 20),
          stageEnteredAt: at(day(today, Math.min(row.appliedOn + 3, -1)), 11),
          createdAt: at(day(today, row.appliedOn), 20),
        })
        .returning();
      await tx.insert(applicationEvent).values({ applicationId: made2.id, type: "applied", toStageId: stageBy("applied").id, actorPersonId: null, at: at(day(today, row.appliedOn), 20) });
      if (row.stage !== "applied") {
        await tx.insert(applicationEvent).values({ applicationId: made2.id, type: "stage_moved", fromStageId: stageBy("applied").id, toStageId: stageBy(row.stage).id, actorPersonId: recruiter.id, at: at(day(today, Math.min(row.appliedOn + 3, -1)), 11) });
      }
      result.candidates++;
      result.applications++;
    }

    // Turned down at the interview — the stage is kept, which is what the funnel counts.
    const rejected = { name: "Bùi Gia Hân", email: "giahan.bui@example.com", phone: "0921000008" };
    const [rejectedCandidate] = await tx
      .insert(candidate)
      .values({
        fullName: rejected.name,
        searchName: toSearchKey(rejected.name),
        email: rejected.email,
        phone: rejected.phone,
        emailKey: normaliseEmail(rejected.email),
        phoneKey: normalisePhone(rejected.phone),
        currentTitle: "Junior Designer",
        location: "Hải Phòng",
        links: [],
        source: "social",
        consentAt: at(day(today, -33), 19),
        consentVersion: CONSENT_VERSION,
        retainUntil: day(today, 332),
        createdAt: at(day(today, -33), 19),
      })
      .returning();
    const [rejectedApplication] = await tx
      .insert(jobApplication)
      .values({
        candidateId: rejectedCandidate.id,
        openingId: designOpening.id,
        stageId: stageBy("interview").id,
        status: "rejected",
        source: "social",
        answers: { portfolio: "https://www.behance.net/giahan" },
        rejectionReason: "experience",
        rejectionNote: "Portfolio tốt nhưng chưa đủ kinh nghiệm với ấn phẩm thương hiệu.",
        appliedAt: at(day(today, -33), 19),
        stageEnteredAt: at(day(today, -26), 11),
        closedAt: at(day(today, -20), 16),
        decidedByPersonId: designLead.id,
        createdAt: at(day(today, -33), 19),
      })
      .returning();
    await tx.insert(applicationEvent).values([
      { applicationId: rejectedApplication.id, type: "applied", toStageId: stageBy("applied").id, actorPersonId: null, at: at(day(today, -33), 19) },
      { applicationId: rejectedApplication.id, type: "stage_moved", fromStageId: stageBy("applied").id, toStageId: stageBy("interview").id, actorPersonId: recruiter.id, at: at(day(today, -26), 11) },
      { applicationId: rejectedApplication.id, type: "rejected", fromStageId: stageBy("interview").id, actorPersonId: designLead.id, note: "Chưa đủ kinh nghiệm ấn phẩm thương hiệu.", at: at(day(today, -20), 16) },
    ]);
    result.candidates++;
    result.applications++;

    // ── A referral from a colleague (FR-REC-10) ─────────────────────────────────────────────
    const referred = { name: "Trương Nhật Minh", email: "nhatminh.truong@example.com", phone: "0921000009" };
    const [referredCandidate] = await tx
      .insert(candidate)
      .values({
        fullName: referred.name,
        searchName: toSearchKey(referred.name),
        email: referred.email,
        phone: referred.phone,
        emailKey: normaliseEmail(referred.email),
        phoneKey: normalisePhone(referred.phone),
        currentTitle: "Motion Designer",
        currentEmployer: "Freelance",
        links: ["https://vimeo.com/nhatminh"],
        source: "referral",
        referredByPersonId: editor.id,
        // Nobody asked them anything yet: a colleague passed the details on.
        retainUntil: day(today, 358),
        createdByPersonId: editor.id,
        createdAt: at(day(today, -7), 15),
      })
      .returning();
    const [referredApplication] = await tx
      .insert(jobApplication)
      .values({
        candidateId: referredCandidate.id,
        openingId: designOpening.id,
        stageId: stageBy("screening").id,
        status: "active",
        source: "referral",
        portfolioLinks: ["https://vimeo.com/nhatminh"],
        appliedAt: at(day(today, -7), 15),
        stageEnteredAt: at(day(today, -5), 10),
        createdAt: at(day(today, -7), 15),
      })
      .returning();
    await tx.insert(applicationEvent).values([
      { applicationId: referredApplication.id, type: "applied", toStageId: stageBy("applied").id, actorPersonId: editor.id, at: at(day(today, -7), 15) },
      { applicationId: referredApplication.id, type: "stage_moved", fromStageId: stageBy("applied").id, toStageId: stageBy("screening").id, actorPersonId: recruiter.id, at: at(day(today, -5), 10) },
    ]);
    await tx.insert(referral).values({
      referredByPersonId: editor.id,
      candidateId: referredCandidate.id,
      openingId: designOpening.id,
      applicationId: referredApplication.id,
      note: "Làm chung một dự án freelance năm ngoái. Nhanh, kỷ luật, nhận góp ý tốt.",
      createdAt: at(day(today, -7), 15),
    });
    result.candidates++;
    result.applications++;
    result.referrals++;

    // ── Two for the retention job (FR-REC-13) ───────────────────────────────────────────────
    // One who asked to stay on file: the window has passed and the job must leave them alone.
    const pool = { name: "Đặng Khánh Chi", email: "khanhchi.dang@example.com", phone: "0921000010" };
    const [poolCandidate] = await tx
      .insert(candidate)
      .values({
        fullName: pool.name,
        searchName: toSearchKey(pool.name),
        email: pool.email,
        phone: pool.phone,
        emailKey: normaliseEmail(pool.email),
        phoneKey: normalisePhone(pool.phone),
        currentTitle: "Art Director",
        location: "TP. Hồ Chí Minh",
        links: ["https://www.behance.net/khanhchi"],
        source: "careers_page",
        tags: ["talent_pool", "art_direction"],
        notes: "Quá giỏi cho vị trí junior, nhưng đáng nhớ khi mở vị trí Art Director.",
        consentAt: at(day(today, -400), 20),
        consentVersion: CONSENT_VERSION,
        talentPoolConsent: true,
        retainUntil: day(today, -35),
        createdAt: at(day(today, -400), 20),
      })
      .returning();
    const [poolApplication] = await tx
      .insert(jobApplication)
      .values({
        candidateId: poolCandidate.id,
        openingId: designOpening.id,
        stageId: stageBy("final_interview").id,
        status: "rejected",
        source: "careers_page",
        rejectionReason: "position_filled",
        appliedAt: at(day(today, -400), 20),
        stageEnteredAt: at(day(today, -380), 11),
        closedAt: at(day(today, -375), 16),
        decidedByPersonId: designLead.id,
        createdAt: at(day(today, -400), 20),
      })
      .returning();
    await tx.insert(applicationEvent).values({ applicationId: poolApplication.id, type: "applied", toStageId: stageBy("applied").id, actorPersonId: null, at: at(day(today, -400), 20) });

    // And one who did not: the job has something to do on its very first night.
    const lapsed = { name: "Lâm Tuấn Anh", email: "tuananh.lam@example.com", phone: "0921000011" };
    const [lapsedCandidate] = await tx
      .insert(candidate)
      .values({
        fullName: lapsed.name,
        searchName: toSearchKey(lapsed.name),
        email: lapsed.email,
        phone: lapsed.phone,
        emailKey: normaliseEmail(lapsed.email),
        phoneKey: normalisePhone(lapsed.phone),
        currentTitle: "Designer",
        currentEmployer: "Một agency nhỏ",
        location: "Đà Nẵng",
        links: ["https://dribbble.com/tuananh"],
        source: "job_board",
        sourceDetail: "TopCV",
        notes: "Không phản hồi sau vòng sàng lọc.",
        consentAt: at(day(today, -420), 20),
        consentVersion: CONSENT_VERSION,
        talentPoolConsent: false,
        retainUntil: day(today, -55),
        createdAt: at(day(today, -420), 20),
      })
      .returning();
    const [lapsedApplication] = await tx
      .insert(jobApplication)
      .values({
        candidateId: lapsedCandidate.id,
        openingId: designOpening.id,
        stageId: stageBy("screening").id,
        status: "rejected",
        source: "job_board",
        coverLetter: "Tôi muốn ứng tuyển vị trí thiết kế.",
        answers: { portfolio: "https://dribbble.com/tuananh" },
        portfolioLinks: ["https://dribbble.com/tuananh"],
        salaryExpectationVnd: 14_000_000,
        rejectionReason: "no_response",
        appliedAt: at(day(today, -420), 20),
        stageEnteredAt: at(day(today, -410), 11),
        closedAt: at(day(today, -400), 16),
        decidedByPersonId: recruiter.id,
        createdAt: at(day(today, -420), 20),
      })
      .returning();
    await tx.insert(applicationEvent).values({ applicationId: lapsedApplication.id, type: "applied", toStageId: stageBy("applied").id, actorPersonId: null, at: at(day(today, -420), 20) });
    result.candidates += 2;
    result.applications += 2;

    // A third opening standing closed, so the openings list is not all green.
    await tx.insert(jobOpening).values({
      code: "SZC-2026-002",
      title: "Chuyên viên Nội dung",
      titleEn: "Content Writer",
      entityId: szc.id,
      departmentId: departments.get("CON")?.id ?? null,
      positionName: "Content Writer",
      employmentType: "part_time",
      workMode: "remote",
      headcount: 1,
      description: "Đã tuyển xong qua giới thiệu nội bộ.",
      requirements: "",
      benefits: "",
      pipelineId: pipelines.get("SHORT")?.id ?? standard.id,
      status: "closed",
      publicSlug: slug(),
      questions: [],
      interviewKit: [],
      publishedAt: at(day(today, -120), 10),
      closedAt: at(day(today, -80), 17),
      closeReason: "Đã có người nhận việc qua giới thiệu nội bộ.",
      createdByPersonId: recruiter.id,
      createdAt: at(day(today, -121), 9),
    });
    result.openings++;
  });

  return result;
}

/** Used by the caller to say what happened in one line. */
export const describeRecruitSeed = (result: RecruitSeedResult): string =>
  result.openings === 0
    ? "recruitment demo data (already present, left untouched)"
    : `${result.openings} job openings, ${result.candidates} candidates, ${result.applications} applications, ${result.interviews} interviews with submitted scorecards, ${result.offers} accepted offer` +
      `${result.hired ? ` becoming pre-boarding employee ${result.hired}` : ""}, ${result.referrals} referral, and two candidates for the retention job`;
