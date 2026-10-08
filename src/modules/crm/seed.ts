// The CRM's starter data (SRS §4.15; Q27, Q28): the pipeline's stages, a rate card, and the quote
// template. Each seeds only what is not there yet, so a pipeline, a price list or a template in use
// is never touched. Relative imports only, and no "server-only": `pnpm db:seed` runs this file
// outside the app.
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { documentTemplate } from "../../lib/db/schema";
import type { StageCategory, StageGate } from "./enums";
import { crmService, crmServicePrice, crmStage, type RoleMinutes } from "./schema";

type Database = PostgresJsDatabase<Record<string, unknown>>;
type IsoDate = string;
type StageSeed = { name: string; nameEn: string | null; category: StageCategory; probability: number; gates: StageGate[]; allowsPitch: boolean; sortOrder: number; isActive: boolean };
type ServiceSeed = {
  code: string;
  name: string;
  nameEn: string | null;
  category: string;
  unit: string;
  isRecurring: boolean;
  format: string | null;
  channel: string | null;
  roleMinutes: RoleMinutes[];
  description: string | null;
  isActive: boolean;
};

// ── Stages ────────────────────────────────────────────────────────────────────────────────────

const STARTER_STAGES: (StageSeed & { key: string })[] = [
  { key: "qualified", name: "Đã xác định nhu cầu", nameEn: "Qualified", category: "open", probability: 10, gates: [], allowsPitch: false, sortOrder: 10, isActive: true },
  { key: "discovery", name: "Tìm hiểu & brief", nameEn: "Discovery", category: "open", probability: 25, gates: ["contacts"], allowsPitch: true, sortOrder: 20, isActive: true },
  { key: "proposal", name: "Đề xuất / pitch", nameEn: "Proposal / pitch", category: "open", probability: 50, gates: ["contacts", "close_date"], allowsPitch: true, sortOrder: 30, isActive: true },
  { key: "negotiation", name: "Thương lượng", nameEn: "Negotiation", category: "open", probability: 75, gates: ["contacts", "close_date", "value"], allowsPitch: false, sortOrder: 40, isActive: true },
  { key: "won", name: "Chốt thành công", nameEn: "Won", category: "won", probability: 100, gates: ["value"], allowsPitch: false, sortOrder: 90, isActive: true },
  { key: "lost", name: "Không thành công", nameEn: "Lost", category: "lost", probability: 0, gates: [], allowsPitch: false, sortOrder: 99, isActive: true },
];

/** The starter pipeline (SRS Q27 may change it). Seeds only an empty table: a pipeline in use is never touched. */
export async function seedStages(database: Database): Promise<{ seeded: number }> {
  const [existing] = await database.select({ n: sql<number>`count(*)` }).from(crmStage);
  if (Number(existing?.n ?? 0) > 0) return { seeded: 0 };
  await database.insert(crmStage).values(
    STARTER_STAGES.map((stage) => ({
      name: stage.name,
      nameEn: stage.nameEn,
      category: stage.category,
      probability: stage.probability,
      gates: stage.gates,
      allowsPitch: stage.allowsPitch,
      sortOrder: stage.sortOrder,
      isActive: stage.isActive,
    })),
  );
  return { seeded: STARTER_STAGES.length };
}

// ── Rate card ────────────────────────────────────────────────────────────────────────────────────

const STARTER: (ServiceSeed & { price: number })[] = [
  {
    code: "SOC-POST",
    name: "Bài đăng mạng xã hội",
    nameEn: "Social post",
    category: "social",
    unit: "post",
    isRecurring: false,
    format: "post",
    channel: "facebook",
    roleMinutes: [
      { role: "Content", minutes: 90 },
      { role: "Design", minutes: 90 },
    ],
    description: null,
    isActive: true,
    price: 1_500_000,
  },
  {
    code: "SOC-RETAINER",
    name: "Quản lý fanpage theo tháng",
    nameEn: "Monthly page management",
    category: "social",
    unit: "month",
    isRecurring: true,
    format: null,
    channel: "facebook",
    roleMinutes: [
      { role: "Account", minutes: 600 },
      { role: "Content", minutes: 1800 },
      { role: "Design", minutes: 1200 },
    ],
    description: null,
    isActive: true,
    price: 25_000_000,
  },
  {
    code: "VID-SHORT",
    name: "Video ngắn (≤ 60 giây)",
    nameEn: "Short video (≤ 60 s)",
    category: "video",
    unit: "video",
    isRecurring: false,
    format: "short_video",
    channel: "tiktok",
    roleMinutes: [
      { role: "Script", minutes: 120 },
      { role: "Production", minutes: 480 },
      { role: "Video editing", minutes: 360 },
    ],
    description: null,
    isActive: true,
    price: 8_000_000,
  },
  {
    code: "VID-TVC30",
    name: "TVC 30 giây",
    nameEn: "30 s TVC",
    category: "video",
    unit: "video",
    isRecurring: false,
    format: "tvc",
    channel: "youtube",
    roleMinutes: [
      { role: "Script", minutes: 960 },
      { role: "Production", minutes: 2880 },
      { role: "Video editing", minutes: 1920 },
    ],
    description: null,
    isActive: true,
    price: 120_000_000,
  },
  {
    code: "DES-KV",
    name: "Key visual chiến dịch",
    nameEn: "Campaign key visual",
    category: "design",
    unit: "item",
    isRecurring: false,
    format: "key_visual",
    channel: null,
    roleMinutes: [{ role: "Design", minutes: 960 }],
    description: null,
    isActive: true,
    price: 15_000_000,
  },
  {
    code: "KOL-BOOK",
    name: "Booking KOL/KOC (phí quản lý)",
    nameEn: "KOL/KOC booking (management fee)",
    category: "kol",
    unit: "item",
    isRecurring: false,
    format: "post",
    channel: "tiktok",
    roleMinutes: [{ role: "Account", minutes: 240 }],
    description: null,
    isActive: true,
    price: 5_000_000,
  },
];

/**
 * A starter rate card for an empty table — every price marked as the build's guess from its first
 * day, for the owner to replace (SRS Q28). A card in use is never touched.
 */
export async function seedRateCard(database: Database, validFrom: IsoDate = "2026-01-01"): Promise<{ seeded: number }> {
  const [existing] = await database.select({ id: crmService.id }).from(crmService).limit(1);
  if (existing) return { seeded: 0 };
  for (const { price, ...service } of STARTER) {
    const [row] = await database.insert(crmService).values(service).returning({ id: crmService.id });
    await database.insert(crmServicePrice).values({ serviceId: row.id, entityId: null, priceVnd: price, validFrom });
  }
  return { seeded: STARTER.length };
}

// ── The quote template (FR-CRM-23) ──

export const QUOTE_TEMPLATE_CODE = "TM-BAO-GIA";

export const QUOTE_TEMPLATE_BODY = `BẢNG BÁO GIÁ / QUOTATION
Số: {{quote.number}}                                   Ngày: {{document.date}}

Kính gửi: {{client.name}}

{{company.name}} trân trọng gửi Quý khách hàng báo giá cho: {{quote.title}}

{{quote.intro}}

{{quote.lines}}

Cộng tiền dịch vụ (trước chiết khấu): {{quote.subtotal}}
Chiết khấu: {{quote.discount}}
Thuế GTGT: {{quote.vat}}
TỔNG CỘNG: {{quote.total}}

Báo giá có hiệu lực đến ngày: {{quote.validUntil}}

Điều khoản: {{quote.terms}}

Mọi thắc mắc xin liên hệ {{company.name}} — {{company.address}} — {{company.phone}}.

                                                   ĐẠI DIỆN {{company.name}}
                                                   {{company.representative}}
                                                   {{company.representativeTitle}}`;

/** Writes the quote template once; a code already there is left as it was edited. */
export async function seedQuoteTemplate(database: Database): Promise<{ seeded: number }> {
  const inserted = await database
    .insert(documentTemplate)
    .values({ code: QUOTE_TEMPLATE_CODE, name: "Báo giá", entityId: null, kind: "other", tier: "public_internal", body: QUOTE_TEMPLATE_BODY, letterhead: {}, isActive: true })
    .onConflictDoNothing({ target: documentTemplate.code })
    .returning({ id: documentTemplate.id });
  return { seeded: inserted.length };
}
