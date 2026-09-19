// Seeds editable starter data: placeholder legal entities and the shared departments (SRS D8).
// Safe to re-run: existing codes are left untouched. Run with `pnpm db:seed`.
import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { department, entity } from "../src/lib/db/schema";

config({ path: ".env.local" });

const ENTITIES = [
  { code: "SZG", shortName: "Suzu Group", legalName: "Công ty Cổ phần Suzu Group (placeholder — edit me)", wageRegion: 1 },
  { code: "SZM", shortName: "Suzu Media", legalName: "Công ty TNHH Suzu Media (placeholder — edit me)", wageRegion: 1 },
  { code: "SZC", shortName: "Suzu Creative", legalName: "Công ty TNHH Suzu Creative (placeholder — edit me)", wageRegion: 1 },
];

// Shared across every entity (entityId = null).
const DEPARTMENTS = [
  { code: "BOD", name: "Ban Giám đốc" },
  { code: "HR", name: "Hành chính – Nhân sự" },
  { code: "FIN", name: "Tài chính – Kế toán" },
  { code: "ACC", name: "Account / Dịch vụ khách hàng" },
  { code: "SOC", name: "Social Media" },
  { code: "CON", name: "Content" },
  { code: "DES", name: "Thiết kế" },
  { code: "VID", name: "Sản xuất Video" },
  { code: "ADS", name: "Media Buying / Performance" },
  { code: "BD", name: "Phát triển kinh doanh" },
  { code: "IT", name: "IT" },
];

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set (see .env.example)");
  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client);

  const entities = await db.insert(entity).values(ENTITIES).onConflictDoNothing({ target: entity.code }).returning();
  const departments = await db.insert(department).values(DEPARTMENTS).onConflictDoNothing({ target: department.code }).returning();
  console.log(`Seeded ${entities.length} entities and ${departments.length} shared departments (existing codes skipped).`);

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
