// Phase 4 demo data for the knowledge base, called from seed-demo.ts. Idempotent: skipped once any
// space exists. Written straight into the tables the way the use-cases write them (tsx cannot load
// server-only modules): a published page has an immutable version, its search columns are the
// accent-stripped published text, and a restricted page is the access root of everything below it.
// Week 1 lays the spaces and a handful of pages; the handbook's full set of policies and SOPs
// arrives with the Markdown importer.
import { eq } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { department, entity, kbAccess, kbPage, kbPageVersion, kbSpace, person } from "../src/lib/db/schema";
import { toSearchKey } from "../src/lib/text";
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

const SPACES: { key: string; name: string; icon: string; description: string; entity?: string; kind: "open" | "controlled"; access: Access[] }[] = [
  { key: "so-tay", name: "Sổ tay nhân viên", icon: "📘", kind: "controlled", description: "Những điều mọi người ở Suzu cần biết: văn hoá, nội quy, quyền lợi.", access: [["all", "view"], ["role:hr_admin", "edit"], ["role:hr_staff", "edit"]] },
  { key: "chinh-sach-nhan-su", name: "Chính sách nhân sự", icon: "⚖️", kind: "controlled", description: "Chính sách và quy định do phòng Hành chính – Nhân sự ban hành.", access: [["all", "view"], ["role:hr_admin", "edit"], ["role:hr_staff", "edit"]] },
  { key: "quy-trinh-tai-chinh", name: "Quy trình tài chính", icon: "🧾", kind: "controlled", description: "Tạm ứng, thanh toán, hoá đơn — dành cho phòng Tài chính – Kế toán.", access: [["role:finance", "edit"], ["role:payroll", "edit"], ["department:FIN", "view"]] },
  { key: "san-xuat-video", name: "Sản xuất Video", icon: "🎬", kind: "open", description: "SOP và kinh nghiệm của phòng Sản xuất Video.", access: [["department:VID", "edit"]] },
  { key: "cong-cu", name: "Công cụ & hướng dẫn", icon: "🛠️", kind: "open", description: "Mẹo dùng công cụ nội bộ. Ai cũng có thể viết và sửa.", access: [["all", "edit"]] },
];

const PAGES: DemoPage[] = [
  {
    key: "welcome", space: "so-tay", title: "Chào mừng đến với Suzu", owner: MAI, reviewBy: "2027-06-30",
    revisions: [
      {
        on: "2026-03-02", by: MAI, note: "Bản đầu tiên",
        content: doc(
          heading(1, "Chào mừng bạn"),
          paragraph("Suzu Group gồm ba công ty: ", bold("Suzu Group"), ", ", bold("Suzu Media"), " và ", bold("Suzu Creative"), ". Sổ tay này giúp bạn nắm nhanh cách chúng ta làm việc."),
          callout("info", "Tuần đầu tiên, hãy hoàn thành danh sách hội nhập trong mục Việc của tôi và đọc các chính sách được đánh dấu bắt buộc."),
          heading(2, "Giá trị cốt lõi"),
          bulletList("Tử tế với đồng nghiệp và khách hàng", "Làm đến nơi đến chốn", "Học mỗi ngày", "Nói thẳng, nói thật, nói sớm"),
          heading(2, "Bắt đầu từ đâu"),
          orderedList([paragraph("Đọc ", link("Nội quy lao động", "/kb"), " và ", link("Quy định nghỉ phép", "/kb"), ".")], "Cài ứng dụng Suzu One lên điện thoại để chấm công.", "Gặp quản lý trực tiếp để thống nhất mục tiêu 30 – 60 – 90 ngày."),
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
          orderedList("Tạo đơn trong mục Nghỉ phép trên Suzu One.", "Quản lý trực tiếp duyệt; nghỉ từ 5 ngày liên tục cần thêm trưởng phòng.", "Bàn giao công việc trước ngày nghỉ."),
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
          orderedList("Tạo đơn trong mục Nghỉ phép trên Suzu One.", "Quản lý trực tiếp duyệt; nghỉ từ 5 ngày liên tục cần thêm trưởng phòng.", "Bàn giao công việc trước ngày nghỉ."),
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

export async function seedKb(db: Db): Promise<string> {
  const [existing] = await db.select({ id: kbSpace.id }).from(kbSpace).limit(1);
  if (existing) return "0 knowledge-base spaces (already there)";

  const people = new Map((await db.select({ id: person.id, name: person.fullName }).from(person)).map((row) => [row.name, row.id]));
  const departments = new Map((await db.select({ id: department.id, code: department.code }).from(department)).map((row) => [row.code, row.id]));
  const entities = new Map((await db.select({ id: entity.id, code: entity.code }).from(entity)).map((row) => [row.code, row.id]));
  const who = (name: string) => people.get(name) ?? null;
  // "department:VID" in this file → "department:<uuid>" in the table.
  const subject = (key: string) => {
    const [type, code] = key.split(":");
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
    const [row] = await db.insert(kbSpace).values({ key: space.key, name: space.name, icon: space.icon, description: space.description, kind: space.kind, entityId: space.entity ? entities.get(space.entity)! : null, sortOrder: index, createdByPersonId: who(MAI) }).returning();
    spaceIds.set(space.key, row.id);
    await db.insert(kbAccess).values(space.access.map(([key, level]) => ({ spaceId: row.id, subjectKey: subject(key), level })));
  }

  const pageIds = new Map<string, string>();
  const roots = new Map<string, string | null>();
  let versions = 0;
  for (const [index, page] of PAGES.entries()) {
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
      versions++;
    }
    await db
      .update(kbPage)
      .set({ accessRootId: root, ...(published ? { publishedVersionId: published.id, publishedTitle: published.title, publishedAt: published.at, searchTitle: toSearchKey(published.title), searchBody: toSearchKey(published.text) } : {}) })
      .where(eq(kbPage.id, row.id));
  }
  return `${SPACES.length} knowledge-base spaces, ${PAGES.length} pages, ${versions} published versions`;
}
