// Phase 3 demo data for work management, called from seed-demo.ts. Idempotent: skipped once the
// demo teams exist. Two creative teams with realistic projects — one of them private, one that
// borrows a person from the other team — and about sixty tasks around today: overdue, due this
// week, blocked, in review, done. Rows are written the way the work use-cases write them.
import { eq, inArray } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { department, entity, person, task, workActivity, workClient, workLabel, workProject, workProjectMember, workState, workTask, workTaskDependency, workTaskLabel, workTaskPerson, workTeam, workTeamMember } from "../src/lib/db/schema";
import { CATEGORY_STATUS, type StateCategory, WORKFLOW_PRESETS } from "../src/modules/work/enums";

type Db = ReturnType<typeof drizzle>;

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

// The content workflow, named as a Vietnamese team would name it.
const STATE_NAMES: Record<string, string> = { backlog: "Tồn đọng", brief: "Brief", ideation: "Lên ý tưởng", script: "Kịch bản / Nội dung", design: "Thiết kế / Quay", edit: "Dựng / Chỉnh sửa", internal_review: "Duyệt nội bộ", client_review: "Khách duyệt", scheduled: "Đã lên lịch", published: "Đã đăng", reported: "Đã báo cáo", cancelled: "Đã hủy" };

const TEAMS = [
  { key: "VID", name: "Sản xuất Video", description: "TVC, video thương hiệu, hậu kỳ", entity: "SZM", department: "VID", lead: "long.dang@suzu.group", members: ["tam.bui@suzu.group", "huy.ho@suzu.group", "linh.do@suzu.group", "name:Ngô Bảo Anh"] },
  { key: "CRS", name: "Sáng tạo & Social", description: "Thiết kế, nội dung và vận hành kênh social cho khách hàng", entity: "SZC", department: null, lead: "chi.duong@suzu.group", members: ["khoi.ly@suzu.group", "anh.trinh@suzu.group", "duc.phan@suzu.group", "duyen.huynh@suzu.group"] },
] as const;

const CLIENTS = [
  { code: "MOCAN", name: "Sữa Mộc An", kind: "client", parent: null },
  { code: "MOCAN-KIDS", name: "Mộc An Kids", kind: "brand", parent: "MOCAN" },
  { code: "TLX", name: "Trà Lá Xanh", kind: "client", parent: null },
  { code: "DAIVIET", name: "Ngân hàng Đại Việt", kind: "client", parent: null },
] as const;

const LABELS = [
  { team: null, name: "Gấp", color: "red" },
  { team: null, name: "Chờ khách", color: "yellow" },
  { team: "VID", name: "Ngoại cảnh", color: "green" },
  { team: "VID", name: "Hậu kỳ", color: "purple" },
  { team: "CRS", name: "Social", color: "blue" },
  { team: "CRS", name: "Thiết kế", color: "pink" },
  { team: "CRS", name: "KOL", color: "orange" },
] as const;

type ProjectSeed = { code: string; team: "VID" | "CRS"; name: string; description: string; client: string | null; visibility: "entity" | "team" | "private"; lead: string; start: number; due: number | null; members: string[] };
const PROJECTS: ProjectSeed[] = [
  { code: "tvc", team: "VID", name: "TVC Tết 2027 — Sữa Mộc An", description: "TVC 30 giây + bản cắt 15 giây và 6 giây cho mùa Tết", client: "MOCAN", visibility: "team", lead: "tam.bui@suzu.group", start: -19, due: 70, members: ["long.dang@suzu.group", "huy.ho@suzu.group", "linh.do@suzu.group", "khoi.ly@suzu.group"] },
  { code: "brand", team: "VID", name: "Video thương hiệu Suzu Group", description: "Phim giới thiệu tập đoàn cho website và tuyển dụng", client: null, visibility: "entity", lead: "long.dang@suzu.group", start: -40, due: 25, members: ["huy.ho@suzu.group"] },
  { code: "pitch", team: "VID", name: "Pitch Ngân hàng Đại Việt (bảo mật)", description: "Hồ sơ dự thầu sản xuất video 2027 — chỉ thành viên dự án được xem", client: "DAIVIET", visibility: "private", lead: "long.dang@suzu.group", start: -6, due: 12, members: ["tam.bui@suzu.group"] },
  { code: "retainer", team: "CRS", name: "Retainer social tháng 9 — Trà Lá Xanh", description: "12 bài Facebook, 8 video TikTok, báo cáo cuối tháng", client: "TLX", visibility: "team", lead: "duc.phan@suzu.group", start: -19, due: 10, members: ["duyen.huynh@suzu.group", "khoi.ly@suzu.group", "anh.trinh@suzu.group"] },
  { code: "kids", team: "CRS", name: "Bộ nhận diện Mộc An Kids", description: "Logo, bao bì, key visual ra mắt nhãn hàng", client: "MOCAN-KIDS", visibility: "team", lead: "chi.duong@suzu.group", start: -30, due: 35, members: ["khoi.ly@suzu.group", "anh.trinh@suzu.group", "tam.bui@suzu.group"] },
];

type TaskSeed = {
  ref: string;
  project: string | null;
  team?: "VID" | "CRS";
  title: string;
  state: string;
  who?: string;
  due?: number;
  start?: number;
  priority?: 1 | 2 | 3 | 4;
  estimate?: number;
  parent?: string;
  labels?: string[];
  channel?: string;
  format?: string;
  blockedBy?: string[];
  with?: string[];
  checklist?: [string, boolean][];
  links?: [string, string][];
  description?: string;
};

const LONG = "long.dang@suzu.group", TAM = "tam.bui@suzu.group", HUY = "huy.ho@suzu.group", LINH = "linh.do@suzu.group", ANH_Q = "name:Ngô Bảo Anh";
const CHI = "chi.duong@suzu.group", KHOI = "khoi.ly@suzu.group", ANH = "anh.trinh@suzu.group", DUC = "duc.phan@suzu.group", DUYEN = "duyen.huynh@suzu.group";

const TASKS: TaskSeed[] = [
  // TVC Tết — mid-production, with a dependency chain and a few late items.
  { ref: "tvc-brief", project: "tvc", title: "Nhận brief và chốt thông điệp với khách", state: "reported", who: TAM, due: -16, priority: 2 },
  { ref: "tvc-idea", project: "tvc", title: "Ba hướng ý tưởng TVC Tết", state: "published", who: TAM, due: -10, priority: 2, blockedBy: ["tvc-brief"] },
  { ref: "tvc-script", project: "tvc", title: "Kịch bản phân cảnh bản 30 giây", state: "client_review", who: TAM, due: -2, priority: 1, labels: ["Chờ khách"], blockedBy: ["tvc-idea"], description: "Khách đang xem bản v2. Cần chốt trước khi đặt bối cảnh.", links: [["https://drive.google.com/drive/folders/demo-tvc-tet-script", "Thư mục kịch bản (Drive)"]] },
  { ref: "tvc-story", project: "tvc", title: "Storyboard 24 khung", state: "design", who: KHOI, due: 3, priority: 2, estimate: 960, blockedBy: ["tvc-script"], with: [TAM] },
  { ref: "tvc-cast", project: "tvc", title: "Casting gia đình ba thế hệ", state: "ideation", who: LONG, due: 5, priority: 2 },
  { ref: "tvc-location", project: "tvc", title: "Khảo sát bối cảnh nhà cổ Đường Lâm", state: "brief", who: ANH_Q, due: 6, priority: 3, labels: ["Ngoại cảnh"] },
  { ref: "tvc-budget", project: "tvc", title: "Dự toán sản xuất gửi khách duyệt", state: "internal_review", who: LONG, due: -1, priority: 1, labels: ["Gấp"] },
  { ref: "tvc-shoot", project: "tvc", title: "Quay chính (2 ngày)", state: "backlog", who: TAM, due: 21, start: 20, priority: 2, labels: ["Ngoại cảnh"], blockedBy: ["tvc-story", "tvc-cast", "tvc-location"], checklist: [["Thuê máy quay và ánh sáng", false], ["Giấy phép quay tại di tích", false], ["Bảo hiểm đoàn phim", false]] },
  { ref: "tvc-shoot-1", project: "tvc", title: "Ngày quay 1: cảnh sum họp", state: "backlog", who: TAM, due: 20, parent: "tvc-shoot" },
  { ref: "tvc-shoot-2", project: "tvc", title: "Ngày quay 2: cảnh sản phẩm", state: "backlog", who: ANH_Q, due: 21, parent: "tvc-shoot" },
  { ref: "tvc-edit", project: "tvc", title: "Dựng bản offline 30 giây", state: "backlog", who: HUY, due: 30, estimate: 1440, labels: ["Hậu kỳ"], blockedBy: ["tvc-shoot"] },
  { ref: "tvc-color", project: "tvc", title: "Chỉnh màu và âm thanh", state: "backlog", who: LINH, due: 36, labels: ["Hậu kỳ"], blockedBy: ["tvc-edit"] },
  { ref: "tvc-cut", project: "tvc", title: "Bản cắt 15 giây và 6 giây cho TikTok, YouTube", state: "backlog", who: HUY, due: 40, channel: "tiktok", format: "short_video", blockedBy: ["tvc-color"] },
  { ref: "tvc-music", project: "tvc", title: "Mua bản quyền nhạc nền", state: "brief", due: 14, priority: 3 },
  { ref: "tvc-old", project: "tvc", title: "Phương án quay studio (khách đã loại)", state: "cancelled", who: TAM, due: -8 },

  // Brand film — nearly done.
  { ref: "brand-script", project: "brand", title: "Kịch bản phim giới thiệu tập đoàn", state: "reported", who: LONG, due: -30 },
  { ref: "brand-interview", project: "brand", title: "Phỏng vấn ban lãnh đạo (3 người)", state: "published", who: TAM, due: -18 },
  { ref: "brand-broll", project: "brand", title: "Quay b-roll văn phòng ba công ty", state: "published", who: ANH_Q, due: -12, labels: ["Ngoại cảnh"] },
  { ref: "brand-edit", project: "brand", title: "Dựng bản 3 phút", state: "edit", who: HUY, due: 2, priority: 2, estimate: 1200, labels: ["Hậu kỳ"], checklist: [["Bản dựng thô", true], ["Chèn phỏng vấn", true], ["Đồ họa tên và chức danh", false], ["Phụ đề Việt – Anh", false]] },
  { ref: "brand-sub", project: "brand", title: "Phụ đề song ngữ", state: "brief", who: LINH, due: 6, parent: "brand-edit" },
  { ref: "brand-gfx", project: "brand", title: "Đồ họa mở đầu và kết", state: "design", who: LINH, due: 1, parent: "brand-edit", priority: 2 },
  { ref: "brand-hr", project: "brand", title: "Bản cắt 60 giây cho trang tuyển dụng", state: "backlog", who: HUY, due: 15, channel: "website", format: "short_video", blockedBy: ["brand-edit"] },
  { ref: "brand-review", project: "brand", title: "Trình chiếu nội bộ cho Ban giám đốc", state: "backlog", who: LONG, due: 9, blockedBy: ["brand-edit"] },

  // Private pitch.
  { ref: "pitch-deck", project: "pitch", title: "Hồ sơ năng lực và showreel ngân hàng", state: "design", who: TAM, due: 4, priority: 1 },
  { ref: "pitch-cost", project: "pitch", title: "Bảng giá khung 2027 (bảo mật)", state: "internal_review", who: LONG, due: 5, priority: 1, labels: ["Gấp"] },
  { ref: "pitch-idea", project: "pitch", title: "Ý tưởng chuỗi video giáo dục tài chính", state: "ideation", who: TAM, due: 7, priority: 2 },
  { ref: "pitch-meet", project: "pitch", title: "Buổi thuyết trình tại hội sở", state: "backlog", who: LONG, due: 12, blockedBy: ["pitch-deck", "pitch-cost", "pitch-idea"] },

  // VID backlog (no project).
  { ref: "vid-gear", project: null, team: "VID", title: "Kiểm kê và bảo dưỡng thiết bị quý 4", state: "brief", who: ANH_Q, due: 11, priority: 4 },
  { ref: "vid-lut", project: null, team: "VID", title: "Bộ LUT chuẩn cho máy mới", state: "backlog", who: LINH, priority: 4 },
  { ref: "vid-archive", project: null, team: "VID", title: "Dọn ổ lưu trữ dự án 2025", state: "backlog", priority: 4 },

  // Social retainer — a content calendar in flight.
  { ref: "ret-plan", project: "retainer", title: "Kế hoạch nội dung tháng 9", state: "reported", who: DUC, due: -18, channel: "facebook" },
  { ref: "ret-fb-1", project: "retainer", title: "Bài FB: Trà sen mùa thu — câu chuyện nguyên liệu", state: "published", who: DUYEN, due: -12, channel: "facebook", format: "post", labels: ["Social"] },
  { ref: "ret-fb-2", project: "retainer", title: "Bài FB: Minigame Trung thu", state: "published", who: DUYEN, due: -6, channel: "facebook", format: "post", labels: ["Social"] },
  { ref: "ret-fb-3", project: "retainer", title: "Bài FB: Ra mắt vị trà ổi hồng", state: "scheduled", who: DUYEN, due: 1, channel: "facebook", format: "post", labels: ["Social"] },
  { ref: "ret-fb-4", project: "retainer", title: "Bài FB: Mẹo pha trà lạnh tại nhà", state: "client_review", who: DUYEN, due: 3, channel: "facebook", format: "post", labels: ["Social", "Chờ khách"] },
  { ref: "ret-fb-5", project: "retainer", title: "Album ảnh: Một ngày ở đồi chè", state: "design", who: KHOI, due: 5, channel: "facebook", format: "photo_album", labels: ["Social", "Thiết kế"] },
  { ref: "ret-fb-6", project: "retainer", title: "Bài FB: Ưu đãi cuối tháng", state: "script", who: DUYEN, due: 8, channel: "facebook", format: "post", labels: ["Social"] },
  { ref: "ret-tt-1", project: "retainer", title: "TikTok: 3 cách uống trà không mất ngủ", state: "published", who: DUC, due: -9, channel: "tiktok", format: "short_video", labels: ["Social"] },
  { ref: "ret-tt-2", project: "retainer", title: "TikTok: Hậu trường đồi chè", state: "edit", who: DUC, due: -1, priority: 2, channel: "tiktok", format: "short_video", labels: ["Social"], with: [HUY] },
  { ref: "ret-tt-3", project: "retainer", title: "TikTok: Thử thách pha trà 15 giây", state: "ideation", who: DUC, due: 6, channel: "tiktok", format: "short_video", labels: ["Social"] },
  { ref: "ret-kol", project: "retainer", title: "Chọn 3 KOL ẩm thực cho đợt ra mắt trà ổi hồng", state: "internal_review", who: DUC, due: 0, priority: 2, labels: ["KOL"], checklist: [["Danh sách dài 10 KOL", true], ["Báo giá", true], ["Khách chọn 3", false]] },
  { ref: "ret-kol-brief", project: "retainer", title: "Brief cho KOL", state: "brief", who: DUYEN, due: 4, parent: "ret-kol", labels: ["KOL"] },
  { ref: "ret-banner", project: "retainer", title: "Banner website ưu đãi cuối tháng", state: "design", who: ANH, due: 7, channel: "website", format: "banner", labels: ["Thiết kế"] },
  { ref: "ret-ig", project: "retainer", title: "Story Instagram: bình chọn vị trà mới", state: "brief", who: ANH, due: 9, channel: "instagram", format: "story", labels: ["Social"] },
  { ref: "ret-report", project: "retainer", title: "Báo cáo hiệu quả tháng 9", state: "backlog", who: DUC, due: 12, priority: 2 },
  { ref: "ret-oct", project: "retainer", title: "Đề xuất kế hoạch tháng 10", state: "brief", who: DUC, due: 6, priority: 2, labels: ["Chờ khách"] },

  // Identity for Mộc An Kids.
  { ref: "kids-research", project: "kids", title: "Nghiên cứu đối thủ và moodboard", state: "reported", who: CHI, due: -22 },
  { ref: "kids-logo", project: "kids", title: "Logo: 3 phương án", state: "published", who: KHOI, due: -12, labels: ["Thiết kế"] },
  { ref: "kids-logo-final", project: "kids", title: "Hoàn thiện logo đã chọn và bộ quy chuẩn", state: "internal_review", who: KHOI, due: 1, priority: 2, labels: ["Thiết kế"], blockedBy: ["kids-logo"] },
  { ref: "kids-mascot", project: "kids", title: "Linh vật bò sữa Mộc", state: "design", who: ANH, due: 4, labels: ["Thiết kế"], with: [KHOI] },
  { ref: "kids-pack", project: "kids", title: "Bao bì hộp 110ml — 4 vị", state: "design", who: KHOI, due: 10, priority: 2, estimate: 1920, labels: ["Thiết kế"], blockedBy: ["kids-logo-final"] },
  { ref: "kids-pack-1", project: "kids", title: "Vị dâu", state: "design", who: KHOI, due: 6, parent: "kids-pack" },
  { ref: "kids-pack-2", project: "kids", title: "Vị chuối", state: "brief", who: ANH, due: 8, parent: "kids-pack" },
  { ref: "kids-pack-3", project: "kids", title: "Vị sô-cô-la", state: "brief", who: ANH, due: 9, parent: "kids-pack" },
  { ref: "kids-pack-4", project: "kids", title: "Vị nguyên chất", state: "backlog", due: 10, parent: "kids-pack" },
  { ref: "kids-kv", project: "kids", title: "Key visual ra mắt", state: "backlog", who: CHI, due: 18, format: "key_visual", blockedBy: ["kids-pack", "kids-mascot"] },
  { ref: "kids-video", project: "kids", title: "Video ra mắt 20 giây (phối hợp nhóm Video)", state: "brief", who: TAM, due: 24, channel: "youtube", format: "short_video" },
  { ref: "kids-print", project: "kids", title: "Kiểm tra màu in thử tại nhà in", state: "backlog", who: KHOI, due: 15, labels: ["Chờ khách"] },

  // CRS backlog.
  { ref: "crs-template", project: null, team: "CRS", title: "Bộ template báo cáo social hàng tháng", state: "brief", who: DUC, due: 13, priority: 3 },
  { ref: "crs-font", project: null, team: "CRS", title: "Rà soát bản quyền font đang dùng", state: "backlog", who: CHI, priority: 3 },
  { ref: "crs-stock", project: null, team: "CRS", title: "Gia hạn tài khoản ảnh stock", state: "brief", who: ANH, due: -3, priority: 3 },
];

export async function seedWork(db: Db, today: string): Promise<string> {
  const [existing] = await db.select({ id: workTeam.id }).from(workTeam).where(inArray(workTeam.key, TEAMS.map((team) => team.key))).limit(1);
  if (existing) return "no work data (demo teams already exist)";

  const people = await db.select({ id: person.id, email: person.workEmail, name: person.fullName }).from(person);
  const personId = (ref: string) => {
    const found = ref.startsWith("name:") ? people.find((row) => row.name === ref.slice(5)) : people.find((row) => row.email === ref);
    if (!found) throw new Error(`Demo person not found: ${ref}`);
    return found.id;
  };
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row.id]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row.id]));

  return db.transaction(async (tx) => {
    const teamIds = new Map<string, string>();
    const teamEntity = new Map<string, string | null>();
    const states = new Map<string, { id: string; category: StateCategory }>();
    for (const team of TEAMS) {
      const [row] = await tx.insert(workTeam).values({ key: team.key, name: team.name, description: team.description, entityId: entities.get(team.entity) ?? null, departmentId: team.department ? (departments.get(team.department) ?? null) : null, defaultVisibility: "team" }).returning();
      teamIds.set(team.key, row.id);
      teamEntity.set(team.key, row.entityId);
      const created = await tx.insert(workState).values(WORKFLOW_PRESETS.content.map((state, index) => ({ teamId: row.id, name: STATE_NAMES[state.key], category: state.category, sortOrder: (index + 1) * 10 }))).returning();
      WORKFLOW_PRESETS.content.forEach((state, index) => states.set(`${team.key}:${state.key}`, { id: created[index].id, category: state.category }));
      await tx.insert(workTeamMember).values([{ teamId: row.id, personId: personId(team.lead), role: "lead" }, ...team.members.map((member) => ({ teamId: row.id, personId: personId(member), role: "member" }))]);
    }

    const clientIds = new Map<string, string>();
    for (const client of CLIENTS) {
      const [row] = await tx.insert(workClient).values({ code: client.code, name: client.name, kind: client.kind, parentId: client.parent ? clientIds.get(client.parent) : null }).onConflictDoUpdate({ target: workClient.code, set: { name: client.name } }).returning();
      clientIds.set(client.code, row.id);
    }
    const labelIds = new Map<string, string>();
    for (const label of LABELS) {
      const [row] = await tx.insert(workLabel).values({ teamId: label.team ? teamIds.get(label.team)! : null, name: label.name, color: label.color }).returning();
      labelIds.set(label.name, row.id);
    }

    const projects = new Map<string, { id: string; team: "VID" | "CRS"; clientId: string | null }>();
    for (const project of PROJECTS) {
      const clientId = project.client ? clientIds.get(project.client)! : null;
      const [row] = await tx.insert(workProject).values({ teamId: teamIds.get(project.team)!, entityId: teamEntity.get(project.team) ?? null, name: project.name, description: project.description, clientId, visibility: project.visibility, leadPersonId: personId(project.lead), startDate: addDays(today, project.start), dueDate: project.due === null ? null : addDays(today, project.due), createdByPersonId: personId(project.lead) }).returning();
      projects.set(project.code, { id: row.id, team: project.team, clientId });
      await tx.insert(workProjectMember).values([{ projectId: row.id, personId: personId(project.lead), role: "lead" }, ...project.members.filter((member) => member !== project.lead).map((member) => ({ projectId: row.id, personId: personId(member), role: "member" }))]);
    }

    const taskIds = new Map<string, string>();
    const numbers = new Map<string, number>();
    const ranks = new Map<string, number>();
    for (const seed of TASKS) {
      const project = seed.project ? projects.get(seed.project)! : null;
      const teamKey = project?.team ?? seed.team!;
      const state = states.get(`${teamKey}:${seed.state}`)!;
      const status = CATEGORY_STATUS[state.category];
      const creator = personId(TEAMS.find((team) => team.key === teamKey)!.lead);
      const assignee = seed.who ? personId(seed.who) : null;
      const due = seed.due === undefined ? null : addDays(today, seed.due);
      const finished = status === "done" ? new Date(`${due ?? today}T09:30:00Z`) : null;
      const created = new Date(Date.parse(`${addDays(today, Math.min(seed.due ?? 0, 0) - 14)}T02:00:00Z`));
      const [row] = await tx
        .insert(task)
        .values({ kind: "work", title: seed.title, description: seed.description ?? null, status, assigneePersonId: assignee, requesterPersonId: creator, createdByPersonId: creator, dueDate: due, startDate: seed.start === undefined ? null : addDays(today, seed.start), estimateMinutes: seed.estimate ?? null, priority: seed.priority ?? null, entityId: teamEntity.get(teamKey) ?? null, parentTaskId: seed.parent ? taskIds.get(seed.parent)! : null, contextType: project ? "work_project" : null, contextId: project?.id ?? null, completedAt: finished, completedByPersonId: finished ? assignee : null, createdAt: created, updatedAt: finished ?? created })
        .returning();
      taskIds.set(seed.ref, row.id);
      const number = (numbers.get(teamKey) ?? 0) + 1;
      numbers.set(teamKey, number);
      const rank = (ranks.get(state.id) ?? 0) + 1000;
      ranks.set(state.id, rank);
      await tx.insert(workTask).values({
        taskId: row.id,
        teamId: teamIds.get(teamKey)!,
        projectId: project?.id ?? null,
        number,
        stateId: state.id,
        clientId: project?.clientId ?? null,
        channel: seed.channel ?? null,
        contentFormat: seed.format ?? null,
        boardRank: rank,
        checklist: (seed.checklist ?? []).map(([text, done], index) => ({ id: `c${index + 1}`, text, done })),
        links: (seed.links ?? []).map(([url, title], index) => ({ id: `l${index + 1}`, url, title })),
      });
      if (seed.labels?.length) await tx.insert(workTaskLabel).values(seed.labels.map((name) => ({ taskId: row.id, labelId: labelIds.get(name)! })));
      if (seed.with?.length) await tx.insert(workTaskPerson).values(seed.with.map((ref) => ({ taskId: row.id, personId: personId(ref), role: "collaborator" })));
      if (seed.blockedBy?.length) await tx.insert(workTaskDependency).values(seed.blockedBy.map((ref) => ({ blockerTaskId: taskIds.get(ref)!, blockedTaskId: row.id, type: "blocks", createdByPersonId: creator })));
      await tx.insert(workActivity).values({ taskId: row.id, actorPersonId: creator, type: "created", toValue: { title: seed.title, state: STATE_NAMES[seed.state] }, createdAt: created });
    }
    for (const [teamKey, last] of numbers) await tx.update(workTeam).set({ taskSeq: last }).where(eq(workTeam.id, teamIds.get(teamKey)!));
    return `${TEAMS.length} work teams, ${CLIENTS.length} clients and brands, ${PROJECTS.length} projects (one private) and ${TASKS.length} tasks`;
  });
}
