// Seeds a small fake company for local development: people, employments, assignments and role grants.
// Refuses to run against anything but a local database. Run `pnpm db:seed` first, then `pnpm db:seed:demo`.
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { assignment, department, employeeCodeScheme, employment, entity, person, personProfile, position, roleAssignment } from "../src/lib/db/schema";
import { toSearchKey } from "../src/lib/text";

config({ path: ".env.local" });

type Demo = {
  name: string;
  email: string | null;
  entity: string;
  department: string;
  position: string;
  type?: "employee" | "probation" | "intern" | "part_time" | "collaborator";
  manager?: string;
  start: string;
  role?: { role: string; scope: "group" | "entity" | "department" };
};

// `manager` refers to an earlier row by email.
const PEOPLE: Demo[] = [
  { name: "Trần Đình Khánh", email: "owner@suzu.vn", entity: "SZG", department: "BOD", position: "Chủ tịch", start: "2019-03-01", role: { role: "owner", scope: "group" } },
  { name: "Nguyễn Thu Hà", email: "ha.nguyen@suzu.vn", entity: "SZG", department: "BOD", position: "Tổng Giám đốc", manager: "owner@suzu.vn", start: "2019-06-01", role: { role: "c_level", scope: "group" } },
  { name: "Lê Thị Mai", email: "mai.le@suzu.group", entity: "SZG", department: "HR", position: "Trưởng phòng Nhân sự", manager: "ha.nguyen@suzu.vn", start: "2020-02-10", role: { role: "hr_admin", scope: "group" } },
  { name: "Phạm Quốc Bảo", email: "bao.pham@suzu.group", entity: "SZM", department: "HR", position: "Chuyên viên Nhân sự", manager: "mai.le@suzu.group", start: "2022-08-01", role: { role: "hr_staff", scope: "entity" } },
  { name: "Võ Minh Tuấn", email: "tuan.vo@suzu.group", entity: "SZG", department: "FIN", position: "Kế toán trưởng", manager: "ha.nguyen@suzu.vn", start: "2020-05-04", role: { role: "finance", scope: "group" } },
  { name: "Đặng Hoàng Long", email: "long.dang@suzu.group", entity: "SZM", department: "VID", position: "Trưởng phòng Sản xuất Video", manager: "ha.nguyen@suzu.vn", start: "2020-09-14", role: { role: "department_head", scope: "department" } },
  { name: "Bùi Thanh Tâm", email: "tam.bui@suzu.group", entity: "SZM", department: "VID", position: "Đạo diễn", manager: "long.dang@suzu.group", start: "2021-03-01" },
  { name: "Hồ Gia Huy", email: "huy.ho@suzu.group", entity: "SZM", department: "VID", position: "Dựng phim", manager: "long.dang@suzu.group", start: "2023-07-17" },
  { name: "Đỗ Khánh Linh", email: "linh.do@suzu.group", entity: "SZM", department: "VID", position: "Dựng phim", type: "probation", manager: "long.dang@suzu.group", start: "2026-08-03" },
  { name: "Ngô Bảo Anh", email: null, entity: "SZM", department: "VID", position: "Quay phim", type: "collaborator", manager: "tam.bui@suzu.group", start: "2025-11-01" },
  { name: "Dương Thùy Chi", email: "chi.duong@suzu.group", entity: "SZC", department: "DES", position: "Trưởng nhóm Thiết kế", manager: "ha.nguyen@suzu.vn", start: "2021-01-11", role: { role: "department_head", scope: "department" } },
  { name: "Lý Minh Khôi", email: "khoi.ly@suzu.group", entity: "SZC", department: "DES", position: "Thiết kế đồ họa", manager: "chi.duong@suzu.group", start: "2022-04-18" },
  { name: "Trịnh Ngọc Ánh", email: "anh.trinh@suzu.group", entity: "SZC", department: "DES", position: "Thiết kế đồ họa", type: "intern", manager: "chi.duong@suzu.group", start: "2026-06-15" },
  { name: "Phan Văn Đức", email: "duc.phan@suzu.group", entity: "SZC", department: "SOC", position: "Social Media Executive", manager: "ha.nguyen@suzu.vn", start: "2023-02-06" },
  { name: "Huỳnh Mỹ Duyên", email: "duyen.huynh@suzu.group", entity: "SZC", department: "CON", position: "Content Writer", type: "part_time", manager: "duc.phan@suzu.group", start: "2024-10-01" },
  { name: "Mai Anh Thư", email: "thu.mai@suzu.group", entity: "SZC", department: "ACC", position: "Account Executive", manager: "ha.nguyen@suzu.vn", start: "2026-11-02" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname)) throw new Error("Demo data is for a local database only.");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  const today = new Date().toISOString().slice(0, 10);
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row]));
  const departments = new Map((await db.select().from(department)).map((row) => [row.code, row]));
  if (entities.size === 0 || departments.size === 0) throw new Error("Run `pnpm db:seed` first.");

  let created = 0;
  await db.transaction(async (tx) => {
    const idByEmail = new Map<string, string>();
    const counters = new Map<string, number>();
    for (const demo of PEOPLE) {
      const home = entities.get(demo.entity)!;
      const dept = departments.get(demo.department)!;
      const [existing] = await tx
        .select()
        .from(person)
        .where(demo.email ? eq(person.workEmail, demo.email) : eq(person.searchName, toSearchKey(demo.name)))
        .limit(1);
      if (existing) {
        if (demo.email) idByEmail.set(demo.email, existing.id);
        continue;
      }
      const workforceType = demo.type ?? "employee";
      const managerId = demo.manager ? (idByEmail.get(demo.manager) ?? null) : null;
      const [row] = await tx
        .insert(person)
        .values({
          fullName: demo.name,
          searchName: toSearchKey(demo.name),
          workEmail: demo.email,
          workforceType,
          status: demo.start > today ? "preboarding" : "active",
          primaryEntityId: home.id,
          departmentId: dept.id,
          managerId,
        })
        .returning();
      if (demo.email) idByEmail.set(demo.email, row.id);
      await tx.insert(personProfile).values({ personId: row.id, nationality: "Việt Nam", phone: `09${String(10000000 + created * 7919).slice(0, 8)}` });

      const number = (counters.get(home.code) ?? 0) + 1;
      counters.set(home.code, number);
      const [job] = await tx
        .insert(position)
        .values({ name: demo.position, searchName: toSearchKey(demo.position) })
        .onConflictDoUpdate({ target: position.searchName, set: { name: demo.position } })
        .returning();
      const [contract] = await tx
        .insert(employment)
        .values({ personId: row.id, entityId: home.id, employeeCode: `${home.code}-${String(number).padStart(4, "0")}`, startDate: demo.start, seniorityDate: demo.start })
        .returning();
      await tx.insert(assignment).values({ employmentId: contract.id, workforceType, departmentId: dept.id, positionId: job.id, managerId, validFrom: demo.start });
      if (demo.role) {
        const scopeId = demo.role.scope === "entity" ? home.id : demo.role.scope === "department" ? dept.id : null;
        await tx.insert(roleAssignment).values({ personId: row.id, role: demo.role.role, scopeType: demo.role.scope, scopeId });
      }
      created++;
    }
    for (const [code, used] of counters) {
      const home = entities.get(code)!;
      await tx.insert(employeeCodeScheme).values({ entityId: home.id, prefix: `${code}-`, nextNumber: used + 1 }).onConflictDoNothing();
    }
  });

  console.log(`Seeded ${created} demo people (existing people skipped).`);
  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
