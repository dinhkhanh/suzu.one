// Phase 4 demo data for the knowledge base, called from seed-demo.ts. Idempotent: skipped once any
// space exists. Written straight into the tables the way the use-cases write them (tsx cannot load
// server-only modules): a published page has an immutable version, its search columns are the
// accent-stripped published text, and a restricted page is the access root of everything below it.
// The handbook's policies and SOPs (seed-demo-kb-pages.ts) are Markdown run through the importer.
// On top of the pages: two "must read" policies — the work rules about half confirmed and overdue
// for the rest, the security policy reset by a major revision — one revision waiting for review,
// and the chunks with their (fake) embeddings, as a publish would have left them.
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { addDays, todayInVietnam } from "../src/lib/dates";
import { approvalAssignee, approvalEvent, approvalRequest, approvalStep, orgUnit, entity, kbAckAudience, kbAcknowledgement, kbAckReminder, kbAccess, kbPage, kbPageChunk, kbPageVersion, kbSpace, person } from "../src/lib/db/schema";
import { toSearchKey } from "../src/lib/text";
import { chunkDoc, chunkEmbeddingText } from "../src/modules/kb/engine/chunk";
import { FAKE_EMBEDDING_MODEL, fakeEmbedding } from "../src/modules/kb/engine/fake-embedding";
import { markdownToDoc } from "../src/modules/kb/engine/markdown";
import { HANDBOOK_PAGES, REMOTE_DRAFT, SECURITY_V1, SECURITY_V2 } from "./seed-demo-kb-pages";
import { bold, bulletList, callout, doc, embed, heading, link, orderedList, paragraph, table } from "../src/modules/kb/engine/build";
import { type Doc, docToPlainText, validateDoc } from "../src/modules/kb/engine/doc";

type Db = ReturnType<typeof drizzle>;
type Access = [subject: string, level: "view" | "edit"];
type Revision = { title?: string; content: Doc; note?: string; major?: boolean; on: string; by: string };
type DemoPage = { key: string; space: string; parent?: string; title: string; owner: string; reviewBy?: string; revisions: Revision[]; draft?: { title?: string; content: Doc }; access?: Access[] };

const MAI = "Lê Thị Mai";
const BAO = "Phạm Quốc Bảo";
const TUAN = "Võ Minh Tuấn";
const LONG = "Đặng Hoàng Long";
const TAM = "Bùi Thanh Tâm";

const SPACES: { key: string; name: string; icon: string; description: string; entity?: string; unit?: string; kind: "open" | "controlled"; access: Access[] }[] = [
  { key: "so-tay", name: "Sổ tay nhân viên", icon: "📘", kind: "controlled", description: "Những điều mọi người ở SuZu cần biết: văn hoá, nội quy, quyền lợi.", access: [["all", "view"], ["role:hr_admin", "edit"], ["role:hr_staff", "edit"]] },
  { key: "chinh-sach-nhan-su", name: "Chính sách nhân sự", icon: "⚖️", kind: "controlled", description: "Chính sách và quy định do phòng Hành chính – Nhân sự ban hành.", access: [["all", "view"], ["role:hr_admin", "edit"], ["role:hr_staff", "edit"]] },
  { key: "quy-trinh-tai-chinh", name: "Quy trình tài chính", icon: "🧾", kind: "controlled", description: "Tạm ứng, thanh toán, hoá đơn — dành cho phòng Tài chính – Kế toán.", access: [["role:finance", "edit"], ["role:payroll", "edit"], ["department:FIN", "view"]] },
  { key: "san-xuat-video", name: "Sản xuất Video", icon: "🎬", kind: "open", description: "SOP và kinh nghiệm của phòng Sản xuất Video.", unit: "VID", access: [["unit:VID", "edit"]] },
  // A small team inside that department, with a space its own lead runs (FR-KB-13): the people in
  // "Hậu kỳ" reach it, the rest of the video department does not.
  { key: "hau-ky", name: "Nhóm Hậu kỳ", icon: "🎞️", kind: "open", description: "Ghi chú nội bộ của nhóm Hậu kỳ: preset, LUT, quy ước đặt tên file.", unit: "VID-POST", access: [["unit:VID-POST", "edit"]] },
  { key: "cong-cu", name: "Công cụ & hướng dẫn", icon: "🛠️", kind: "open", description: "Mẹo dùng công cụ nội bộ. Ai cũng có thể viết và sửa.", access: [["all", "edit"]] },
];

const PAGES: DemoPage[] = [
  {
    key: "welcome", space: "so-tay", title: "Chào mừng đến với SuZu", owner: MAI, reviewBy: "2027-06-30",
    revisions: [
      {
        on: "2026-03-02", by: MAI, note: "Bản đầu tiên",
        content: doc(
          heading(1, "Chào mừng bạn"),
          paragraph("SuZu Group gồm ba công ty: ", bold("SuZu Group"), ", ", bold("SuZu Media"), " và ", bold("SuZu Creative"), ". Sổ tay này giúp bạn nắm nhanh cách chúng ta làm việc."),
          callout("info", "Tuần đầu tiên, hãy hoàn thành danh sách hội nhập trong mục Việc của tôi và đọc các chính sách được đánh dấu bắt buộc."),
          heading(2, "Giá trị cốt lõi"),
          bulletList("Tử tế với đồng nghiệp và khách hàng", "Làm đến nơi đến chốn", "Học mỗi ngày", "Nói thẳng, nói thật, nói sớm"),
          heading(2, "Bắt đầu từ đâu"),
          orderedList([paragraph("Đọc ", link("Nội quy lao động", "/kb"), " và ", link("Quy định nghỉ phép", "/kb"), ".")], "Cài ứng dụng SuZu One lên điện thoại để chấm công.", "Gặp quản lý trực tiếp để thống nhất mục tiêu 30 – 60 – 90 ngày."),
          heading(2, "Video giới thiệu"),
          embed("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ),
      },
    ],
  },
  {
    key: "leave", space: "chinh-sach-nhan-su", title: "Quy định nghỉ phép", owner: MAI, reviewBy: "2027-01-31",
    revisions: [
      {
        on: "2026-01-05", by: MAI, note: "Ban hành", major: true,
        content: doc(
          heading(1, "Phạm vi áp dụng"),
          paragraph("Áp dụng cho toàn bộ nhân viên chính thức, thử việc và bán thời gian của các công ty trong tập đoàn."),
          heading(1, "Số ngày nghỉ"),
          table(["Loại nghỉ", "Số ngày", "Hưởng lương"], ["Phép năm", "12 ngày / năm, cộng 1 ngày mỗi 5 năm thâm niên", "Có"], ["Kết hôn", "3 ngày", "Có"], ["Con kết hôn", "1 ngày", "Có"], ["Tang cha mẹ, vợ chồng, con", "3 ngày", "Có"], ["Nghỉ không lương", "Theo thoả thuận", "Không"]),
          heading(1, "Cách xin nghỉ"),
          orderedList("Tạo đơn trong mục Nghỉ phép trên SuZu One.", "Quản lý trực tiếp duyệt; nghỉ từ 5 ngày liên tục cần thêm trưởng phòng.", "Bàn giao công việc trước ngày nghỉ."),
          callout("warning", "Nghỉ phép năm từ 3 ngày trở lên cần báo trước ít nhất 5 ngày làm việc."),
        ),
      },
      {
        on: "2026-07-01", by: BAO, note: "Thêm quy định chuyển phép sang năm sau", major: true,
        content: doc(
          heading(1, "Phạm vi áp dụng"),
          paragraph("Áp dụng cho toàn bộ nhân viên chính thức, thử việc và bán thời gian của các công ty trong tập đoàn."),
          heading(1, "Số ngày nghỉ"),
          table(["Loại nghỉ", "Số ngày", "Hưởng lương"], ["Phép năm", "12 ngày / năm, cộng 1 ngày mỗi 5 năm thâm niên", "Có"], ["Kết hôn", "3 ngày", "Có"], ["Con kết hôn", "1 ngày", "Có"], ["Tang cha mẹ, vợ chồng, con", "3 ngày", "Có"], ["Nghỉ không lương", "Theo thoả thuận", "Không"]),
          heading(1, "Cách xin nghỉ"),
          orderedList("Tạo đơn trong mục Nghỉ phép trên SuZu One.", "Quản lý trực tiếp duyệt; nghỉ từ 5 ngày liên tục cần thêm trưởng phòng.", "Bàn giao công việc trước ngày nghỉ."),
          callout("warning", "Nghỉ phép năm từ 3 ngày trở lên cần báo trước ít nhất 5 ngày làm việc."),
          heading(1, "Chuyển phép sang năm sau"),
          paragraph("Tối đa ", bold("5 ngày"), " phép chưa dùng được chuyển sang năm sau và phải dùng trước ngày 31/3. Phần còn lại sẽ hết hạn."),
        ),
      },
    ],
    draft: {
      content: doc(
        heading(1, "Phạm vi áp dụng"),
        paragraph("Áp dụng cho toàn bộ nhân viên chính thức, thử việc và bán thời gian của các công ty trong tập đoàn."),
        callout("info", "Bản nháp 2027: đang cân nhắc tăng phép năm lên 14 ngày."),
      ),
    },
  },
  {
    key: "managers", space: "chinh-sach-nhan-su", title: "Dành cho quản lý", owner: MAI,
    access: [["role:department_head", "view"], ["role:entity_director", "view"], ["role:c_level", "view"]],
    revisions: [{ on: "2026-02-10", by: MAI, content: doc(paragraph("Tài liệu trong mục này chỉ dành cho cấp quản lý: hướng dẫn đánh giá, xử lý kỷ luật, trao đổi về lương.")) }],
  },
  {
    key: "managers-discipline", space: "chinh-sach-nhan-su", parent: "managers", title: "Hướng dẫn xử lý kỷ luật lao động", owner: MAI,
    revisions: [
      {
        on: "2026-02-12", by: MAI,
        content: doc(
          heading(1, "Nguyên tắc"),
          bulletList("Trao đổi riêng, có biên bản, có mặt đại diện nhân sự.", "Không xử lý kỷ luật khi người lao động đang nghỉ ốm, mang thai hoặc nuôi con dưới 12 tháng tuổi.", "Thời hiệu xử lý: 6 tháng kể từ ngày xảy ra vi phạm."),
          callout("danger", "Không tự ý yêu cầu nhân viên viết đơn nghỉ việc. Hãy liên hệ phòng Nhân sự trước."),
        ),
      },
    ],
  },
  {
    key: "advance", space: "quy-trinh-tai-chinh", title: "Quy trình tạm ứng và hoàn ứng", owner: TUAN,
    revisions: [
      {
        on: "2026-04-01", by: TUAN,
        content: doc(
          heading(1, "Tạm ứng"),
          orderedList("Người đề nghị lập phiếu tạm ứng, trưởng phòng ký duyệt.", "Kế toán kiểm tra ngân sách dự án và chuyển khoản trong 2 ngày làm việc.", "Khoản trên 20.000.000 đ cần giám đốc công ty duyệt."),
          heading(1, "Hoàn ứng"),
          paragraph("Hoàn ứng trong vòng ", bold("7 ngày"), " sau khi kết thúc công việc, kèm hoá đơn hợp lệ. Quá hạn, khoản tạm ứng được trừ vào lương tháng kế tiếp."),
        ),
      },
    ],
  },
  {
    key: "video-sop", space: "san-xuat-video", title: "SOP: từ brief đến bản dựng cuối", owner: LONG,
    revisions: [
      {
        on: "2026-05-15", by: LONG,
        content: doc(
          heading(1, "Các bước"),
          table(["Bước", "Người phụ trách", "Đầu ra"], ["Nhận brief", "Account + Producer", "Brief đã xác nhận"], ["Kịch bản & storyboard", "Content", "Kịch bản được khách duyệt"], ["Quay", "Đạo diễn, quay phim", "Footage + log"], ["Dựng & màu", "Editor", "Bản dựng v1"], ["Sửa theo phản hồi", "Editor", "Tối đa 2 vòng sửa"]),
          callout("success", "Đặt tên tệp theo mẫu: KHACH_DUAN_NGAY_vX.mp4"),
        ),
      },
    ],
    draft: { content: doc(heading(1, "Các bước"), paragraph("Đang cập nhật quy trình lưu trữ footage trên NAS.")) },
  },
  {
    key: "video-gear", space: "san-xuat-video", parent: "video-sop", title: "Mượn và trả thiết bị quay", owner: TAM,
    revisions: [],
    draft: { content: doc(paragraph("Bản nháp: đăng ký mượn thiết bị trước 24 giờ, kiểm tra pin và thẻ nhớ khi trả.")) },
  },
  {
    key: "drive", space: "cong-cu", title: "Đặt tên và sắp xếp tệp trên Google Drive", owner: BAO,
    revisions: [{ on: "2026-06-03", by: BAO, content: doc(paragraph("Mỗi dự án một thư mục theo mẫu ", bold("NĂM_KHÁCH HÀNG_DỰ ÁN"), ". Tài liệu cuối cùng để trong thư mục ", bold("FINAL"), ", không đặt tên kiểu “final_v2_sửa”."), bulletList("Chia sẻ theo nhóm Google, không chia sẻ cho từng người.", "Tệp của khách hàng không tải về máy cá nhân.")) }],
  },
];

const md = (markdown: string): Doc => markdownToDoc(markdown, { liftTitle: false }).doc;

export async function seedKb(db: Db): Promise<string> {
  const [existing] = await db.select({ id: kbSpace.id }).from(kbSpace).limit(1);
  if (existing) return "0 knowledge-base spaces (already there)";

  const today = todayInVietnam();
  const day = (offset: number) => addDays(today, offset);
  // A demo person's row was written a moment ago; the day they joined is the day that counts for
  // "who owes a confirmation since when". Demo only: real rows are created when people are hired.
  await db.execute(sql`update person set created_at = e.first_day from (select person_id, min(start_date)::timestamptz as first_day from employment group by person_id) e where e.person_id = person.id and e.first_day < person.created_at`);

  const staged: DemoPage[] = [
    ...HANDBOOK_PAGES.filter((page) => page.key !== "rules" && page.key !== "remote").map((page) => ({ key: page.key, space: page.space, parent: page.parent, title: page.title, owner: page.owner, reviewBy: page.reviewBy, revisions: [{ on: page.on, by: page.by, note: page.note, major: page.major, content: md(page.markdown) }] })),
    ...HANDBOOK_PAGES.filter((page) => page.key === "rules").map((page) => ({ key: page.key, space: page.space, title: page.title, owner: page.owner, reviewBy: page.reviewBy, revisions: [{ on: day(-27), by: page.by, note: page.note, major: true, content: md(page.markdown) }] })),
    { key: "security", space: "so-tay", title: "Bảo mật thông tin và thiết bị", owner: MAI, reviewBy: day(200), revisions: [{ on: day(-45), by: MAI, note: "Ban hành", major: true, content: md(SECURITY_V1) }, { on: day(-10), by: MAI, note: "Thêm quy định về công cụ AI và xử lý sự cố", major: true, content: md(SECURITY_V2) }] },
    ...HANDBOOK_PAGES.filter((page) => page.key === "remote").map((page) => ({ key: page.key, space: page.space, title: page.title, owner: page.owner, revisions: [{ on: page.on, by: page.by, content: md(page.markdown) }], draft: { content: md(REMOTE_DRAFT) } })),
  ];
  // The handbook reads in a sensible order: welcome, the rules, then the rest.
  const order = ["welcome", "rules", "hours", "overtime", "pay", "insurance", "contract", "conduct", "security", "remote"];
  const ALL = [...PAGES, ...staged].sort((a, b) => (order.indexOf(a.key) < 0 ? 99 : order.indexOf(a.key)) - (order.indexOf(b.key) < 0 ? 99 : order.indexOf(b.key)));

  const people = new Map((await db.select({ id: person.id, name: person.fullName }).from(person)).map((row) => [row.name, row.id]));
  const departments = new Map((await db.select({ id: orgUnit.id, code: orgUnit.code }).from(orgUnit)).map((row) => [row.code, row.id]));
  const entities = new Map((await db.select({ id: entity.id, code: entity.code }).from(entity)).map((row) => [row.code, row.id]));
  const who = (name: string) => people.get(name) ?? null;
  // "department:VID" in this file → "department:<uuid>" in the table.
  const subject = (key: string) => {
    const [type, code] = key.split(":");
    if (type === "unit") return `unit:${departments.get(code)}`;
    if (type === "department") return `department:${departments.get(code)}`;
    if (type === "entity") return `entity:${entities.get(code)}`;
    return key;
  };
  const checked = (content: Doc): Doc => {
    const result = validateDoc(content);
    if (!result.ok) throw new Error(`demo page content refused: ${result.problem} at ${result.path}`);
    return result.doc;
  };

  const spaceIds = new Map<string, string>();
  for (const [index, space] of SPACES.entries()) {
    const [row] = await db
      .insert(kbSpace)
      .values({ key: space.key, name: space.name, icon: space.icon, description: space.description, kind: space.kind, entityId: space.entity ? entities.get(space.entity)! : null, ownerUnitId: space.unit ? (departments.get(space.unit) ?? null) : null, sortOrder: index, createdByPersonId: who(MAI) })
      .returning();
    spaceIds.set(space.key, row.id);
    await db.insert(kbAccess).values(space.access.map(([key, level]) => ({ spaceId: row.id, subjectKey: subject(key), level })));
  }

  const pageIds = new Map<string, string>();
  const roots = new Map<string, string | null>();
  let versions = 0;
  const versionIds = new Map<string, string[]>();
  let chunkCount = 0;
  for (const [index, page] of ALL.entries()) {
    const spaceId = spaceIds.get(page.space)!;
    const parentId = page.parent ? pageIds.get(page.parent)! : null;
    const last = page.revisions.at(-1);
    const working = checked(page.draft?.content ?? last!.content);
    const workingTitle = page.draft?.title ?? last?.title ?? page.title;
    const [row] = await db
      .insert(kbPage)
      .values({ spaceId, parentId, title: workingTitle, content: working, contentText: docToPlainText(working), hasUnpublishedChanges: !!page.draft, sortOrder: index, status: last ? "published" : "draft", ownerPersonId: who(page.owner), reviewBy: page.reviewBy ?? null, createdByPersonId: who(page.owner), updatedByPersonId: who(page.owner), createdAt: new Date(`${page.revisions[0]?.on ?? "2026-09-01"}T02:00:00Z`) })
      .returning();
    pageIds.set(page.key, row.id);

    if (page.access) await db.insert(kbAccess).values(page.access.map(([key, level]) => ({ spaceId, pageId: row.id, subjectKey: subject(key), level })));
    const root = page.access ? row.id : page.parent ? (roots.get(page.parent) ?? null) : null;
    roots.set(page.key, root);

    let published: { id: string; title: string; text: string; at: Date } | null = null;
    for (const [number, revision] of page.revisions.entries()) {
      const content = checked(revision.content);
      const at = new Date(`${revision.on}T03:00:00Z`);
      const [version] = await db
        .insert(kbPageVersion)
        .values({ pageId: row.id, versionNo: number + 1, title: revision.title ?? page.title, content, contentText: docToPlainText(content), authorPersonId: who(revision.by), changeNote: revision.note ?? null, isMajor: !!revision.major, createdAt: at })
        .returning();
      published = { id: version.id, title: version.title, text: version.contentText, at };
      versionIds.set(page.key, [...(versionIds.get(page.key) ?? []), version.id]);
      versions++;
    }
    // What a publish leaves behind for the assistant: the passages of the published version, embedded by the local fake.
    if (published) {
      const chunks = chunkDoc(checked(page.revisions.at(-1)!.content), published.title);
      if (chunks.length) await db.insert(kbPageChunk).values(chunks.map((chunk) => ({ pageId: row.id, versionId: published!.id, chunkIndex: chunk.index, headingPath: chunk.headingPath, content: chunk.content, contentHash: createHash("sha256").update(`${chunk.headingPath}\n${chunk.content}`).digest("hex"), tokenEstimate: chunk.tokenEstimate, embedding: fakeEmbedding(chunkEmbeddingText(chunk)), embeddingModel: FAKE_EMBEDDING_MODEL, embeddedAt: published!.at })));
      chunkCount += chunks.length;
    }
    await db
      .update(kbPage)
      .set({ accessRootId: root, ...(published ? { publishedVersionId: published.id, publishedTitle: published.title, publishedAt: published.at, searchTitle: toSearchKey(published.title), searchBody: toSearchKey(published.text) } : {}) })
      .where(eq(kbPage.id, row.id));
  }

  // ── "Must read" ─────────────────────────────────────────────────────────────────────────────
  const at = (date: string, hour = 3) => new Date(`${date}T${String(hour).padStart(2, "0")}:00:00Z`);
  const audience = await db.select({ id: person.id, name: person.fullName, workforceType: person.workforceType, status: person.status, createdAt: person.createdAt }).from(person);
  const staff = audience.filter((row) => row.status === "active" && row.workforceType !== "collaborator");
  let confirmations = 0;
  const mustRead = async (key: string, since: string, dueDays: number, confirmed: [name: string, on: string][], earlier: [name: string, on: string][] = []) => {
    const pageId = pageIds.get(key)!;
    const versionsOf = versionIds.get(key)!;
    const current = versionsOf.at(-1)!;
    await db.update(kbPage).set({ ackRequired: true, ackVersionId: current, ackSince: at(since), ackDueDays: dueDays }).where(eq(kbPage.id, pageId));
    await db.insert(kbAckAudience).values({ pageId, subjectKey: "all" });
    const rows = [...earlier.map(([name, on]) => ({ name, on, versionId: versionsOf[0] })), ...confirmed.map(([name, on]) => ({ name, on, versionId: current }))].filter((row) => who(row.name));
    if (rows.length) await db.insert(kbAcknowledgement).values(rows.map((row) => ({ pageId, versionId: row.versionId, personId: who(row.name)!, acknowledgedAt: at(row.on, 2 + (row.name.length % 8)) })));
    confirmations += rows.length;
    // The notices the job would have sent: the first one to everybody, then every third day to whoever had not confirmed yet.
    const confirmedOn = new Map(confirmed.map(([name, on]) => [who(name), on]));
    const notices: (typeof kbAckReminder.$inferInsert)[] = [];
    for (const member of staff) {
      // Someone who joined after the requirement took effect is asked from their first day.
      const joined = todayInVietnam(member.createdAt);
      const from = joined > since ? joined : since;
      const until = confirmedOn.get(member.id) ?? today;
      const memberDue = addDays(from, dueDays);
      notices.push({ pageId, versionId: current, personId: member.id, sentOn: from, kind: "requested", createdAt: at(from, 1) });
      for (let sentOn = addDays(from, 3); sentOn < until; sentOn = addDays(sentOn, 3)) notices.push({ pageId, versionId: current, personId: member.id, sentOn, kind: sentOn > memberDue ? "overdue" : "reminder", createdAt: at(sentOn, 1) });
    }
    if (notices.length) await db.insert(kbAckReminder).values(notices);
  };
  // The work rules: in force for four weeks, half the staff confirmed — Huy only after the second reminder — and the rest are overdue.
  await mustRead("rules", day(-27), 14, [[MAI, day(-27)], [BAO, day(-26)], [LONG, day(-26)], [TUAN, day(-25)], ["Dương Thùy Chi", day(-24)], ["Nguyễn Thu Hà", day(-22)], ["Hồ Gia Huy", day(-20)]]);
  // The security policy: nearly everyone confirmed version 1; the major revision ten days ago asked everybody again.
  await mustRead(
    "security",
    day(-10),
    14,
    [[MAI, day(-10)], [BAO, day(-9)], [LONG, day(-8)], ["Hồ Gia Huy", day(-6)]],
    [MAI, BAO, LONG, TUAN, TAM, "Hồ Gia Huy", "Dương Thùy Chi", "Lý Minh Khôi", "Phan Văn Đức", "Nguyễn Thu Hà"].map((name, index) => [name, day(-44 + (index % 6))] as [string, string]),
  );

  // ── A revision waiting for review ───────────────────────────────────────────────────────────
  // Bảo (HR staff of one company) edits the group's handbook but may not publish there: Mai, the group's HR admin, is asked.
  const remoteId = pageIds.get("remote")!;
  const requestId = randomUUID();
  const filedAt = at(day(-1), 8);
  const flow = { steps: [{ key: "review", mode: "any", approvers: [{ rule: "permission", permission: "kb:manage" }] }] };
  await db.insert(approvalRequest).values({
    id: requestId,
    type: "kb_publish",
    entityId: null,
    requesterPersonId: who(BAO)!,
    subjectPersonId: null,
    subjectType: "kb_page",
    subjectId: remoteId,
    summary: "Làm việc từ xa — Tăng lên 3 ngày mỗi tuần, thêm mục làm việc từ xa dài ngày",
    payload: { pageId: remoteId, spaceId: spaceIds.get("so-tay")!, title: "Làm việc từ xa", changeNote: "Tăng lên 3 ngày mỗi tuần, thêm mục làm việc từ xa dài ngày", isMajor: false },
    status: "pending",
    currentStep: 0,
    flowSnapshot: { definition: flow, source: "default", resolved: [{ key: "review", mode: "any", applies: true, approverIds: [who(MAI)!] }] },
    link: `/approvals/kb-publish/${requestId}`,
    createdAt: filedAt,
  });
  const [step] = await db.insert(approvalStep).values({ requestId, stepIndex: 0, key: "review", mode: "any", status: "pending" }).returning();
  await db.insert(approvalAssignee).values({ stepId: step.id, requestId, approverPersonId: who(MAI)!, status: "pending" });
  await db.insert(approvalEvent).values({ requestId, type: "submitted", actorPersonId: who(BAO)!, stepIndex: 0, at: filedAt });
  await db.update(kbPage).set({ status: "in_review", reviewRequestId: requestId, updatedByPersonId: who(BAO) }).where(eq(kbPage.id, remoteId));

  return `${SPACES.length} knowledge-base spaces, ${ALL.length} pages, ${versions} published versions, ${chunkCount} chunks (${FAKE_EMBEDDING_MODEL}), ${confirmations} acknowledgements, 1 revision in review`;
}
