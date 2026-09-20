// Demo data for internal comms (Phase 4 week 3): announcements in every state, kudos across the
// entities, a few birthdays inside the home feed's window, a new joiner with an onboarding
// checklist, and checklist steps that link to the handbook pages the KB seed wrote.
// Idempotent: announcements by title, kudos only into an empty table, the joiner by email.
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { addDays, todayInVietnam } from "../src/lib/dates";
import { announcement, announcementAudience, announcementRead, assignment, companyValue, department, employment, entity, kbPage, kbSpace, kudos, lifecycleEvent, person, personProfile, position, task, taskTemplate, taskTemplateItem } from "../src/lib/db/schema";
import { toSearchKey } from "../src/lib/text";
import { planChecklist } from "../src/modules/platform/tasks-engine/engine/checklist";

type Db = ReturnType<typeof drizzle>;
const HOUR = 3_600_000;
const ago = (days: number, hours = 0) => new Date(Date.now() - days * 24 * HOUR - hours * HOUR);

export async function seedComms(db: Db): Promise<string> {
  const today = todayInVietnam();
  const people = await db.select().from(person);
  const byEmail = (email: string) => people.find((row) => row.workEmail === email);
  const id = (email: string) => byEmail(email)?.id;
  const entities = await db.select().from(entity);
  const departments = await db.select().from(department);
  const szm = entities.find((row) => row.code === "SZM");
  const szc = entities.find((row) => row.code === "SZC");
  const vid = departments.find((row) => row.code === "VID");
  const des = departments.find((row) => row.code === "DES");
  const mai = byEmail("mai.le@suzu.group");
  const bao = byEmail("bao.pham@suzu.group");
  const long = byEmail("long.dang@suzu.group");
  if (!szm || !szc || !vid || !des || !mai || !bao || !long) return "no comms demo data (run the people seed first)";

  const pages = await db.select({ id: kbPage.id, title: kbPage.publishedTitle, spaceKey: kbSpace.key }).from(kbPage).innerJoin(kbSpace, eq(kbSpace.id, kbPage.spaceId)).where(isNull(kbPage.deletedAt));
  const pageId = (title: string) => pages.find((row) => row.title === title)?.id ?? null;
  const pageLink = (title: string) => (pageId(title) ? `/kb/pages/${pageId(title)}` : null);

  // ── Announcements ─────────────────────────────────────────────────────────────────────────
  type Demo = { title: string; body: string; author: string; audience: string[]; entityId: string | null; publishAt: Date | null; expiresAt?: Date; pinned?: boolean; must?: boolean; kbPageId?: string | null; status?: "draft" | "published"; readers?: string[]; acknowledgers?: string[] };
  const demos: Demo[] = [
    {
      title: "Lịch nghỉ Tết Dương lịch 2027 và kế hoạch làm việc cuối năm",
      body: "Thân gửi toàn thể anh chị em,\n\nCông ty nghỉ Tết Dương lịch vào thứ Sáu, ngày 01/01/2027, theo quy định hiện hành. Các phòng ban vui lòng chốt kế hoạch công việc tháng 12 trước ngày 27/11 và đăng ký nghỉ phép cuối năm trên Suzu One trước ngày 10/12 để trưởng bộ phận sắp xếp nhân sự.\n\nTiệc cuối năm dự kiến tổ chức vào tối thứ Sáu 18/12 — thông tin chi tiết sẽ được gửi sau.\n\nPhòng Nhân sự",
      author: mai.id, audience: ["all"], entityId: null, publishAt: ago(3, 2), pinned: true,
      readers: ["owner@suzu.vn", "ha.nguyen@suzu.vn", "bao.pham@suzu.group", "long.dang@suzu.group", "tam.bui@suzu.group", "khoi.ly@suzu.group", "duc.phan@suzu.group"],
    },
    {
      title: "Cập nhật Nội quy lao động — vui lòng đọc và xác nhận",
      body: "Nội quy lao động đã được rà soát và cập nhật các mục về giờ làm việc, làm việc từ xa và bảo mật thiết bị.\n\nMọi người vui lòng đọc toàn văn trong kho tri thức và bấm “Tôi đã đọc” ở cuối thông báo này trước ngày 30/09. Nếu có câu hỏi, liên hệ phòng Nhân sự.",
      author: mai.id, audience: ["all"], entityId: null, publishAt: ago(5, 4), must: true, kbPageId: pageId("Nội quy lao động"),
      readers: ["owner@suzu.vn", "ha.nguyen@suzu.vn", "bao.pham@suzu.group", "tuan.vo@suzu.group", "long.dang@suzu.group", "tam.bui@suzu.group", "chi.duong@suzu.group", "khoi.ly@suzu.group", "duc.phan@suzu.group"],
      acknowledgers: ["ha.nguyen@suzu.vn", "bao.pham@suzu.group", "tuan.vo@suzu.group", "tam.bui@suzu.group", "chi.duong@suzu.group", "duc.phan@suzu.group"],
    },
    {
      title: "Suzu Media: khám sức khỏe định kỳ năm 2026",
      body: "Suzu Media tổ chức khám sức khỏe định kỳ vào sáng thứ Bảy 10/10 tại phòng khám đối tác (địa chỉ gửi kèm trong lịch).\n\nAnh chị em vui lòng nhịn ăn sáng, mang theo CCCD và có mặt trước 7g30. Ai không tham gia được xin báo lại cho Bảo (Nhân sự) trước ngày 05/10 để đổi lịch.",
      author: bao.id, audience: [`entity:${szm.id}`], entityId: szm.id, publishAt: ago(1, 5),
      readers: ["long.dang@suzu.group", "huy.ho@suzu.group"],
    },
    {
      title: "Phòng Video: lịch quay tuần tới và phân công thiết bị",
      body: "Tuần tới phòng có ba buổi quay ngoại cảnh (thứ Ba, thứ Năm, thứ Bảy). Bảng phân công máy quay, ống kính và đèn đã cập nhật trong dự án.\n\nMọi người kiểm tra thiết bị được giao, làm thủ tục mượn theo quy trình và báo lại cho anh Long nếu trùng lịch.",
      author: long.id, audience: [`department:${vid.id}`], entityId: null, publishAt: ago(0, 6), kbPageId: pageId("Mượn và trả thiết bị quay"),
      readers: ["tam.bui@suzu.group"],
    },
    {
      title: "Khảo sát mức độ gắn kết quý 4 sắp bắt đầu",
      body: "Khảo sát gắn kết quý 4 sẽ mở trong tuần tới. Khảo sát ẩn danh, mất khoảng 5 phút. Kết quả tổng hợp sẽ được chia sẻ trong buổi họp toàn công ty tháng 11.",
      author: mai.id, audience: ["all"], entityId: null, publishAt: new Date(Date.now() + 7 * 24 * HOUR),
    },
    {
      title: "Bảo trì hệ thống mạng văn phòng tối thứ Sáu",
      body: "Tối thứ Sáu từ 19g đến 22g, mạng văn phòng và máy chủ lưu trữ nội bộ tạm ngừng để bảo trì. Anh chị em lưu lại công việc và tải trước các tệp cần dùng.",
      author: mai.id, audience: ["all"], entityId: null, publishAt: ago(10), expiresAt: ago(7),
      readers: ["owner@suzu.vn", "tuan.vo@suzu.group", "long.dang@suzu.group", "huy.ho@suzu.group", "khoi.ly@suzu.group"],
    },
    {
      title: "Suzu Creative: đăng ký workshop thiết kế thương hiệu (bản nháp)",
      body: "Dự kiến tổ chức workshop nội bộ về thiết kế thương hiệu trong tháng 10. Nội dung và lịch đang được hoàn thiện.",
      author: mai.id, audience: [`entity:${szc.id}`, `department:${des.id}`], entityId: null, publishAt: null, status: "draft",
    },
  ];
  const existing = new Set((await db.select({ title: announcement.title }).from(announcement)).map((row) => row.title));
  let announcements = 0;
  for (const demo of demos) {
    if (existing.has(demo.title)) continue;
    const live = demo.publishAt && demo.publishAt <= new Date();
    const [row] = await db
      .insert(announcement)
      .values({ title: demo.title, body: demo.body, authorPersonId: demo.author, entityId: demo.entityId, kbPageId: demo.kbPageId ?? null, pinned: !!demo.pinned, mustAcknowledge: !!demo.must, status: demo.status ?? "published", publishAt: demo.publishAt, expiresAt: demo.expiresAt ?? null, notifiedAt: live ? demo.publishAt : null, createdAt: demo.publishAt && live ? demo.publishAt : new Date() })
      .returning();
    await db.insert(announcementAudience).values(demo.audience.map((subjectKey) => ({ announcementId: row.id, subjectKey })));
    const marks = (demo.readers ?? []).flatMap((email, index) => {
      const personId = id(email);
      const readAt = new Date(demo.publishAt!.getTime() + (index + 1) * 2 * HOUR);
      return personId ? [{ announcementId: row.id, personId, readAt: readAt > new Date() ? new Date() : readAt, acknowledgedAt: demo.acknowledgers?.includes(email) ? (readAt > new Date() ? new Date() : readAt) : null }] : [];
    });
    if (marks.length) await db.insert(announcementRead).values(marks);
    announcements++;
  }

  // ── Kudos ─────────────────────────────────────────────────────────────────────────────────
  let kudosCount = 0;
  const values = new Set((await db.select({ key: companyValue.key }).from(companyValue)).map((row) => row.key));
  const [anyKudos] = await db.select({ id: kudos.id }).from(kudos).limit(1);
  if (!anyKudos && values.size) {
    const lines: [string, string, string, string, number][] = [
      ["long.dang@suzu.group", "huy.ho@suzu.group", "ownership", "Huy đã ở lại dựng xong bản final cho khách trước hạn một ngày, không cần ai nhắc. Cảm ơn em!", 1],
      ["huy.ho@suzu.group", "tam.bui@suzu.group", "teamwork", "Cảm ơn anh Tâm đã kèm em phần chỉnh màu cho dự án TVC, em học được rất nhiều.", 2],
      ["chi.duong@suzu.group", "khoi.ly@suzu.group", "creativity", "Bộ nhận diện Khôi làm cho khách F&B rất mới mẻ, khách duyệt ngay từ vòng đầu.", 3],
      ["duc.phan@suzu.group", "duyen.huynh@suzu.group", "customer_first", "Duyên viết lại toàn bộ lịch nội dung trong một buổi tối khi khách đổi định hướng. Khách rất hài lòng.", 4],
      ["mai.le@suzu.group", "bao.pham@suzu.group", "integrity", "Bảo phát hiện sai sót trong bảng công và chủ động báo ngay để sửa trước khi chốt. Rất đáng quý.", 6],
      ["ha.nguyen@suzu.vn", "long.dang@suzu.group", "ownership", "Phòng Video giao đủ 12 dự án trong tháng 8 mà không trễ hạn nào. Cảm ơn Long và cả đội.", 8],
      ["khoi.ly@suzu.group", "huy.ho@suzu.group", "teamwork", "Cảm ơn Huy đã xuất gấp bộ motion logo giúp bên Creative kịp buổi pitching.", 9],
      ["tam.bui@suzu.group", "linh.do@suzu.group", "creativity", "Linh mới vào mà đã đề xuất cách dựng teaser rất hay, cả nhóm đều thích.", 11],
      ["bao.pham@suzu.group", "tuan.vo@suzu.group", "teamwork", "Cảm ơn anh Tuấn đã hướng dẫn quy trình hoàn ứng rất kỹ cho các bạn mới.", 13],
      ["tuan.vo@suzu.group", "mai.le@suzu.group", "integrity", "Chị Mai luôn đối chiếu số liệu nhân sự rất cẩn thận trước mỗi kỳ báo cáo. Làm việc cùng rất yên tâm.", 15],
      ["anh.trinh@suzu.group", "chi.duong@suzu.group", "teamwork", "Cảm ơn chị Chi đã dành thời gian góp ý portfolio cho em mỗi tuần.", 17],
      ["owner@suzu.vn", "ha.nguyen@suzu.vn", "customer_first", "Cảm ơn Hà đã trực tiếp xử lý phản hồi của khách hàng lớn ngay trong cuối tuần.", 19],
    ];
    const rows = lines.flatMap(([from, to, valueKey, message, days]) => {
      const fromId = id(from);
      const toId = id(to);
      return fromId && toId && values.has(valueKey) ? [{ fromPersonId: fromId, toPersonId: toId, valueKey, message, createdAt: ago(days, 3) }] : [];
    });
    if (rows.length) await db.insert(kudos).values(rows);
    kudosCount = rows.length;
  }

  // ── Birthdays inside the feed's window: the day and the month move, the year stays ────────
  let birthdays = 0;
  for (const [email, inDays] of [["anh.trinh@suzu.group", 0], ["huy.ho@suzu.group", 1], ["chi.duong@suzu.group", 4]] as const) {
    const personId = id(email);
    const [profile] = personId ? await db.select().from(personProfile).where(eq(personProfile.personId, personId)).limit(1) : [];
    if (!profile?.dateOfBirth) continue;
    const [, month, day] = addDays(today, inDays).split("-");
    const year = profile.dateOfBirth.slice(0, 4);
    const leap = Number(year) % 4 === 0;
    const moved = `${year}-${month}-${month === "02" && day === "29" && !leap ? "28" : day}`;
    if (moved !== profile.dateOfBirth) await db.update(personProfile).set({ dateOfBirth: moved }).where(eq(personProfile.personId, profile.personId));
    birthdays++;
  }

  // ── Checklist steps that point at the handbook (exit criterion) ───────────────────────────
  const links: [string, string, string][] = [
    ["onboarding", "nội quy lao động", "Nội quy lao động"],
    ["onboarding", "thông tin cá nhân trên Suzu One", "Hướng dẫn dùng Suzu One"],
    ["onboarding", "kế hoạch tuần đầu tiên", "Quy trình tiếp nhận nhân viên mới"],
    ["onboarding", "Google Workspace", "Bảo mật thông tin và thiết bị"],
    ["onboarding", "bảo hiểm xã hội", "Bảo hiểm xã hội, y tế và thất nghiệp"],
    ["onboarding", "hợp đồng", "Thử việc và hợp đồng lao động"],
    ["offboarding", "Bàn giao công việc", "Quy trình nghỉ việc và bàn giao"],
    ["offboarding", "Google Workspace", "Bảo mật thông tin và thiết bị"],
  ];
  const items = await db.select({ item: taskTemplateItem, purpose: taskTemplate.purpose }).from(taskTemplateItem).innerJoin(taskTemplate, eq(taskTemplate.id, taskTemplateItem.templateId)).where(inArray(taskTemplate.purpose, ["onboarding", "offboarding"]));
  let linked = 0;
  for (const { item, purpose } of items) {
    const match = links.find(([wanted, needle]) => wanted === purpose && item.title.toLowerCase().includes(needle.toLowerCase()));
    const url = match ? pageLink(match[2]) : null;
    if (!url || item.linkUrl === url) continue;
    await db.update(taskTemplateItem).set({ linkUrl: url }).where(eq(taskTemplateItem.id, item.id));
    linked++;
  }
  // Checklists made before the links existed take them from their template item.
  await db.execute(sql`update ${task} set link_url = ${taskTemplateItem.linkUrl} from ${taskTemplateItem} where ${task.templateItemId} = ${taskTemplateItem.id} and ${task.linkUrl} is null and ${taskTemplateItem.linkUrl} is not null`);

  // ── A new joiner, four days in, with her onboarding checklist ─────────────────────────────
  let joiners = 0;
  const JOINER = "han.lam@suzu.group";
  const chi = byEmail("chi.duong@suzu.group");
  const [designer] = await db.select().from(position).where(eq(position.name, "Thiết kế đồ họa")).limit(1);
  if (!byEmail(JOINER) && chi) {
    const start = addDays(today, -4);
    const name = "Lâm Gia Hân";
    const [hired] = await db.insert(person).values({ fullName: name, searchName: toSearchKey(name), workEmail: JOINER, workforceType: "probation", status: "active", primaryEntityId: szc.id, departmentId: des.id, managerId: chi.id }).returning();
    await db.insert(personProfile).values({ personId: hired.id, nationality: "Việt Nam", dateOfBirth: "2000-03-12", gender: "female" });
    const [job] = await db.insert(employment).values({ personId: hired.id, entityId: szc.id, employeeCode: "SZC-0091", startDate: start, seniorityDate: start }).returning();
    await db.insert(assignment).values({ employmentId: job.id, workforceType: "probation", departmentId: des.id, positionId: designer?.id ?? null, managerId: chi.id, validFrom: start });
    const [event] = await db.insert(lifecycleEvent).values({ personId: hired.id, employmentId: job.id, entityId: szc.id, type: "hire", effectiveDate: start, createdByPersonId: mai.id }).returning();
    const [template] = await db.select().from(taskTemplate).where(and(eq(taskTemplate.purpose, "onboarding"), eq(taskTemplate.isActive, true))).limit(1);
    if (template) {
      const templateItems = await db.select().from(taskTemplateItem).where(eq(taskTemplateItem.templateId, template.id));
      const planned = planChecklist(templateItems, start, (rule) => (rule.rule === "subject" ? hired.id : rule.rule === "line_manager" ? chi.id : rule.rule === "person" ? rule.personId : mai.id));
      await db.insert(task).values(planned.map((row, index) => ({ ...row, kind: "checklist", entityId: szc.id, contextType: "lifecycle_event", contextId: event.id, subjectPersonId: hired.id, createdByPersonId: mai.id, ...(index < 3 ? { status: "done" as const, completedAt: new Date(), completedByPersonId: row.assigneePersonId ?? mai.id } : {}) })));
    }
    joiners = 1;
  }

  return `${announcements} announcements, ${kudosCount} kudos, ${birthdays} birthdays moved into the week, ${linked} checklist steps linked to the handbook, ${joiners} new joiner`;
}
