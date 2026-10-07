// Phase 11 demo data (CRM) on top of the demo company and the PJM demo, local only. It goes through
// the CRM's own services — accounts, contacts, leads, deals moved stage by stage through their
// gates, contracts, billing items invoiced and paid — so the rows are what the screens would have
// written. The services `import "server-only"`; the package script loads scripts/server-only-shim.cjs.
//
// What it leaves: the three demo clients become accounts with profiles and payment terms, and three
// prospects join them; Phan Văn Đức sells (the `sales` role over the group) and manages Trà Lá Xanh,
// Bùi Thanh Tâm manages Sữa Mộc An. Six open deals across every open stage (one gone stale), four
// won and two lost over the past months, so the win rate, the forecast and the lost reasons have
// something to say. Service contracts for the two running clients. Seven invoices over the TVC, the
// identity project and the retainer — paid, part-paid, current, and overdue in every ageing bucket.
// Two web leads and a few logged activities with follow-ups, one of them late.
//
// Dates are relative to the day it runs, like the other demo seeds. Order: after
// `pnpm db:seed:demo:pjm`. Idempotent: skipped once any deal exists.
import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { addDays, type IsoDate, todayInVietnam } from "../src/lib/dates";
import { db, schema } from "../src/lib/db";
import { createAccount, saveCommercialTerms, saveProfile } from "../src/modules/crm/accounts";
import { recordActivity } from "../src/modules/crm/activities";
import { saveContact } from "../src/modules/crm/contacts";
import { saveContract } from "../src/modules/crm/contracts";
import { createDeal, moveDeal } from "../src/modules/crm/deals";
import type { LostReason, ServiceLine, Source } from "../src/modules/crm/enums";
import { recordInvoice, recordPayment } from "../src/modules/crm/invoices";
import { createLead } from "../src/modules/crm/leads";
import { listStages, vatRates } from "../src/modules/crm/stages";
import { createManualBillingItem } from "../src/modules/projects/billing";

config({ path: ".env.local" });

const EMAILS = { owner: "owner@suzu.vn", ha: "ha.nguyen@suzu.vn", tuan: "tuan.vo@suzu.group", duc: "duc.phan@suzu.group", tam: "tam.bui@suzu.group", long: "long.dang@suzu.group", chi: "chi.duong@suzu.group" } as const;
type Key = keyof typeof EMAILS;

async function main() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set (see .env.example)");
  if (!["127.0.0.1", "localhost"].includes(new URL(url).hostname) && process.env.DEMO_SEED_ALLOW_REMOTE !== "1") throw new Error("Demo data is for a local database only (set DEMO_SEED_ALLOW_REMOTE=1 for a staging database).");

  const [seeded] = await db().select({ id: schema.crmDeal.id }).from(schema.crmDeal).limit(1);
  if (seeded) {
    console.log("CRM demo data already exists (a deal is there): nothing to do.");
    return;
  }

  const today = todayInVietnam();
  const people = await db().select({ id: schema.person.id, email: schema.person.workEmail }).from(schema.person);
  const id = {} as Record<Key, string>;
  for (const [key, email] of Object.entries(EMAILS) as [Key, string][]) {
    const row = people.find((candidate) => candidate.email === email);
    if (!row) throw new Error(`${email} is missing: run \`pnpm db:seed:demo\` first.`);
    id[key] = row.id;
  }
  const entities = new Map((await db().select().from(schema.entity)).map((row) => [row.code, row.id]));
  const clients = new Map((await db().select().from(schema.workClient)).map((row) => [row.code, row]));
  const teams = new Map((await db().select().from(schema.workTeam)).map((row) => [row.key, row.id]));
  const projects = await db().select().from(schema.workProject);
  const projectNamed = (prefix: string) => {
    const found = projects.find((row) => row.name.startsWith(prefix));
    if (!found) throw new Error(`The project "${prefix}…" is missing: run \`pnpm db:seed:demo:pjm\` first.`);
    return found;
  };
  const stages = await listStages();
  const stage = (nameEn: string) => stages.find((row) => row.nameEn === nameEn)!.id;
  const OPEN_PATH = ["Qualified", "Discovery", "Proposal / pitch", "Negotiation"];

  // ── Who sells ───────────────────────────────────────────────────────────────────────────
  // Đức sells for the group; the demo had nobody holding `crm:sell`.
  await db().insert(schema.roleAssignment).values({ personId: id.duc, role: "sales", scopeType: "group", scopeId: null, validFrom: "2025-01-01" });

  // ── Accounts ────────────────────────────────────────────────────────────────────────────
  // The demo's clients get a profile and terms; their account managers are set as the client
  // record holds them (a hand-over through the app would also log it — not needed for a seed).
  const profile = (legalName: string, taxCode: string, industry: string, size: "small" | "medium" | "large" | "enterprise", tier: "a" | "b" | "c", entity: string, source: Source) => ({ legalName, taxCode, address: null, website: null, industry, size, source, tier, contractingEntityId: entities.get(entity)! });
  const mocan = clients.get("MOCAN")!;
  const tlx = clients.get("TLX")!;
  const daiviet = clients.get("DAIVIET")!;
  await db().update(schema.workClient).set({ accountManagerPersonId: id.tam }).where(eq(schema.workClient.id, mocan.id));
  await db().update(schema.workClient).set({ accountManagerPersonId: id.duc }).where(eq(schema.workClient.id, tlx.id));
  await saveProfile(mocan.id, profile("Công ty CP Sữa Mộc An", "0312345678", "FMCG — sữa", "large", "a", "SZM", "referral"));
  await saveProfile(tlx.id, profile("Công ty TNHH Trà Lá Xanh", "0398765432", "Đồ uống", "medium", "a", "SZC", "existing"));
  await saveProfile(daiviet.id, profile("Ngân hàng TMCP Đại Việt", "0100112233", "Ngân hàng", "enterprise", "b", "SZM", "event"));
  for (const client of [mocan, tlx, daiviet]) await saveCommercialTerms(client.id, { paymentTermsDays: 30, creditHold: false, creditHoldReason: null, creditLimitVnd: null });
  const prospect = async (code: string, name: string, entity: string, legal: Parameters<typeof profile>) => (await createAccount({ code, name, entityId: entities.get(entity)!, note: null, profile: profile(...legal), salesOwnerPersonId: id.duc, accountManagerPersonId: null, confirmDuplicate: true })).client;
  const caphe = await prospect("CAPHE", "Cà phê Đất Việt", "SZM", ["Công ty CP Cà phê Đất Việt", "0311122233", "Đồ uống", "medium", "b", "SZM", "website"]);
  const luaha = await prospect("LUAHA", "Thời trang Lụa Hà", "SZC", ["Công ty TNHH Lụa Hà", "0109988776", "Thời trang", "small", "c", "SZC", "social"]);
  const saomai = await prospect("SAOMAI", "Điện máy Sao Mai", "SZC", ["Công ty CP Điện máy Sao Mai", "0305566778", "Bán lẻ điện máy", "large", "b", "SZC", "cold"]);

  // ── Contacts: a decision maker per account (example.vn addresses: nothing here is real) ──
  const contactOf = new Map<string, string>();
  for (const [client, fullName, title, slug] of [
    [mocan, "Nguyễn Thị Lan", "Giám đốc Marketing", "lan.nguyen@mocan.example.vn"],
    [tlx, "Trần Quốc Việt", "Trưởng phòng Thương hiệu", "viet.tran@tralaxanh.example.vn"],
    [daiviet, "Phạm Minh Châu", "Giám đốc Truyền thông", "chau.pham@daiviet.example.vn"],
    [caphe, "Lê Hoàng Nam", "Giám đốc Kinh doanh", "nam.le@caphedatviet.example.vn"],
    [luaha, "Đỗ Thu Hà", "Chủ thương hiệu", "ha.do@luaha.example.vn"],
    [saomai, "Võ Thanh Tùng", "Trưởng phòng Marketing", "tung.vo@saomai.example.vn"],
  ] as const) {
    const { after } = await saveContact(client.id, null, { fullName, title, email: slug, phone: null, zalo: null, decisionRole: "decision_maker", isPrimary: true, preferredChannel: "email", birthday: null, notes: null, source: "business_card", lawfulBasis: "legitimate_interest", status: "active", brandIds: [] }, id.duc, { confirmDuplicate: true });
    contactOf.set(client.id, after.id);
  }

  // ── Deals: created at the first stage and moved through each gate, as a seller would ──────
  type DealSeed = { client: { id: string }; title: string; lines: ServiceLine[]; oneOff?: number; monthly?: number; months?: number; close: IsoDate; to: string; owner: Key; team?: string; entity: string; source: Source; lost?: LostReason; closedDaysAgo?: number; stageDaysAgo?: number; nextStep?: string };
  const DEALS: DealSeed[] = [
    // Open, one per stage, and a second negotiation that renews the retainer.
    { client: caphe, title: "Chiến dịch Tết 2027 — Cà phê Đất Việt", lines: ["video", "social"], oneOff: 180_000_000, close: addDays(today, 20), to: "Negotiation", owner: "duc", team: "VID", entity: "SZM", source: "website", nextStep: "Gửi báo giá điều chỉnh sau buổi họp thứ Năm" },
    { client: tlx, title: "Gia hạn retainer fanpage Trà Lá Xanh 2027", lines: ["social"], monthly: 25_000_000, months: 12, close: addDays(today, 45), to: "Negotiation", owner: "duc", team: "CRS", entity: "SZC", source: "existing" },
    { client: daiviet, title: "Phim thương hiệu Ngân hàng Đại Việt", lines: ["video"], oneOff: 350_000_000, close: addDays(today, 15), to: "Proposal / pitch", owner: "tam", team: "VID", entity: "SZM", source: "event", nextStep: "Thuyết trình ý tưởng vòng 2" },
    { client: luaha, title: "Lookbook Xuân Hè 2027 — Lụa Hà", lines: ["design", "social"], oneOff: 60_000_000, close: addDays(today, 35), to: "Proposal / pitch", owner: "duc", team: "CRS", entity: "SZC", source: "social" },
    { client: saomai, title: "Retainer TikTok 2027 — Điện máy Sao Mai", lines: ["social", "kol"], monthly: 30_000_000, months: 12, close: addDays(today, 60), to: "Discovery", owner: "duc", team: "CRS", entity: "SZC", source: "cold" },
    // Stale: nothing has moved for a month.
    { client: mocan, title: "Series video ngắn Mộc An Kids", lines: ["video"], oneOff: 64_000_000, close: addDays(today, 30), to: "Qualified", owner: "tam", team: "VID", entity: "SZM", source: "existing", stageDaysAgo: 32 },
    // Won and lost over the past months.
    { client: mocan, title: "TVC Tết 2027 — Sữa Mộc An", lines: ["video"], oneOff: 240_000_000, close: addDays(today, -60), to: "Won", owner: "tam", team: "VID", entity: "SZM", source: "referral", closedDaysAgo: 60 },
    { client: mocan, title: "Bộ nhận diện Mộc An Kids", lines: ["design"], oneOff: 45_000_000, close: addDays(today, -140), to: "Won", owner: "duc", team: "CRS", entity: "SZC", source: "existing", closedDaysAgo: 140 },
    { client: tlx, title: "Retainer fanpage Trà Lá Xanh 2026", lines: ["social"], monthly: 25_000_000, months: 12, close: addDays(today, -110), to: "Won", owner: "duc", team: "CRS", entity: "SZC", source: "existing", closedDaysAgo: 110 },
    { client: luaha, title: "Key visual khai trương cửa hàng — Lụa Hà", lines: ["design"], oneOff: 15_000_000, close: addDays(today, -20), to: "Won", owner: "duc", team: "CRS", entity: "SZC", source: "social", closedDaysAgo: 20 },
    { client: saomai, title: "TVC khai trương chi nhánh — Sao Mai", lines: ["video"], oneOff: 150_000_000, close: addDays(today, -45), to: "Lost", owner: "duc", team: "VID", entity: "SZM", source: "cold", lost: "price", closedDaysAgo: 45 },
    { client: caphe, title: "Event activation hội chợ — Đất Việt", lines: ["event"], oneOff: 90_000_000, close: addDays(today, -80), to: "Lost", owner: "duc", team: "VID", entity: "SZM", source: "website", lost: "timing", closedDaysAgo: 80 },
  ];
  const dealOf = new Map<string, string>();
  let won = 0;
  let lost = 0;
  for (const seed of DEALS) {
    const deal = await createDeal(
      { clientId: seed.client.id, title: seed.title, brandId: null, serviceLines: seed.lines, oneOffVnd: seed.oneOff ?? null, monthlyVnd: seed.monthly ?? null, months: seed.months ?? null, probability: null, expectedCloseOn: seed.close, teamId: seed.team ? (teams.get(seed.team) ?? null) : null, entityId: entities.get(seed.entity)!, source: seed.source, competitors: null, nextStep: seed.nextStep ?? null, ownerPersonId: id[seed.owner], stageId: null, leadId: null, contacts: [{ contactId: contactOf.get(seed.client.id)!, role: "decision_maker" }] },
      id[seed.owner],
    );
    dealOf.set(seed.title, deal.id);
    const closing = seed.to === "Won" || seed.to === "Lost";
    const path = closing ? OPEN_PATH.slice(1) : OPEN_PATH.slice(1, OPEN_PATH.indexOf(seed.to) + 1);
    for (const step of path) await moveDeal(deal.id, stage(step), id[seed.owner]);
    if (seed.to === "Won") {
      await moveDeal(deal.id, stage("Won"), id[seed.owner]);
      won++;
    }
    if (seed.to === "Lost") {
      await moveDeal(deal.id, stage("Lost"), id[seed.owner], { reason: seed.lost ?? "other", note: null });
      lost++;
    }
    // The past, written as it would stand had it happened then: when it closed, when it last moved.
    const closedAt = seed.closedDaysAgo ? new Date(`${addDays(today, -seed.closedDaysAgo)}T09:00:00+07:00`) : null;
    const movedAt = closedAt ?? (seed.stageDaysAgo ? new Date(`${addDays(today, -seed.stageDaysAgo)}T09:00:00+07:00`) : null);
    if (movedAt) {
      const openedAt = new Date(movedAt.getTime() - 40 * 86_400_000);
      await db()
        .update(schema.crmDeal)
        .set({ createdAt: openedAt, stageChangedAt: movedAt, ...(seed.to === "Won" ? { wonAt: closedAt } : {}), ...(seed.to === "Lost" ? { lostAt: closedAt } : {}) })
        .where(eq(schema.crmDeal.id, deal.id));
      await db().update(schema.crmDealStageChange).set({ changedAt: movedAt }).where(eq(schema.crmDealStageChange.dealId, deal.id));
    }
  }

  // ── Contracts for the two running clients ───────────────────────────────────────────────
  await saveContract(tlx.id, null, { number: "08/2026/HĐDV-SZC", title: "Retainer fanpage Trà Lá Xanh 2026", kind: "service", entityId: entities.get("SZC")!, parentContractId: null, dealId: dealOf.get("Retainer fanpage Trà Lá Xanh 2026")!, startDate: "2026-01-01", endDate: "2026-12-31", valueVnd: 300_000_000, paymentTermsDays: 30, autoRenew: false, noticeDays: 30, note: null }, id.duc);
  await saveContract(mocan.id, null, { number: "21/2026/HĐDV-SZM", title: "TVC Tết 2027 — Sữa Mộc An", kind: "service", entityId: entities.get("SZM")!, parentContractId: null, dealId: dealOf.get("TVC Tết 2027 — Sữa Mộc An")!, startDate: addDays(today, -55), endDate: addDays(today, 120), valueVnd: 240_000_000, paymentTermsDays: 30, autoRenew: false, noticeDays: null, note: null }, id.tam);

  // ── Invoices and payments: every ageing bucket ─────────────────────────────────────────
  const { defaultBp } = await vatRates(today);
  const tvc = projectNamed("TVC Tết 2027");
  const kids = projectNamed("Bộ nhận diện Mộc An Kids");
  const retainer = projectNamed("Retainer fanpage Trà Lá Xanh 2026");
  type InvoiceSeed = { project: { id: string }; description: string; amount: number; number: string; issuedDaysAgo: number; paid: number | "all"; paidDaysAgo?: number };
  const INVOICES: InvoiceSeed[] = [
    // Over 90 days late, nothing paid.
    { project: kids, description: "Bộ nhận diện Mộc An Kids — nghiệm thu", amount: 45_000_000, number: "0000101", issuedDaysAgo: 130, paid: 0 },
    // 61–90 days late, half paid.
    { project: tvc, description: "TVC Tết 2027 — tạm ứng 50%", amount: 120_000_000, number: "0000102", issuedDaysAgo: 100, paid: 66_000_000, paidDaysAgo: 70 },
    // Paid in full.
    { project: retainer, description: "Retainer fanpage — tháng 7/2026", amount: 25_000_000, number: "0000103", issuedDaysAgo: 98, paid: "all", paidDaysAgo: 75 },
    // 31–60 days late.
    { project: retainer, description: "Retainer fanpage — tháng 8/2026", amount: 25_000_000, number: "0000104", issuedDaysAgo: 72, paid: 0 },
    // 1–30 days late.
    { project: tvc, description: "TVC Tết 2027 — đợt 2 (30%)", amount: 72_000_000, number: "0000105", issuedDaysAgo: 42, paid: 0 },
    // Paid in full, this month.
    { project: retainer, description: "Retainer fanpage — tháng 9/2026", amount: 25_000_000, number: "0000106", issuedDaysAgo: 37, paid: "all", paidDaysAgo: 3 },
    // Current: not yet due.
    { project: retainer, description: "Retainer fanpage — tháng 10/2026", amount: 25_000_000, number: "0000107", issuedDaysAgo: 5, paid: 0 },
  ];
  let invoices = 0;
  let payments = 0;
  for (const seed of INVOICES) {
    const item = await createManualBillingItem(seed.project.id, { description: seed.description, reference: null, amountVnd: seed.amount }, id.tuan);
    const invoice = await recordInvoice({ itemIds: [item.id], number: seed.number, issuedOn: addDays(today, -seed.issuedDaysAgo), vatRateBp: defaultBp, amounts: {}, note: null }, id.tuan);
    invoices++;
    const amount = seed.paid === "all" ? invoice.totalVnd : seed.paid;
    if (amount > 0) {
      await recordPayment(invoice.id, { receivedOn: addDays(today, -(seed.paidDaysAgo ?? 0)), amountVnd: amount, method: "transfer", reference: `VCB ${seed.number}`, note: null }, id.tuan);
      payments++;
    }
  }

  // ── Leads and activities ────────────────────────────────────────────────────────────────
  await createLead({ entityId: entities.get("SZC")!, clientId: null, companyName: "Mỹ phẩm Hoa Sen", contactName: "Ngô Thảo", contactTitle: "Brand manager", email: null, phone: null, need: "Quản lý kênh TikTok và booking KOC", budgetText: "~40tr/tháng", source: "website" }, { personId: id.duc, sells: true }, null);
  await createLead({ entityId: entities.get("SZM")!, clientId: null, companyName: "Chuỗi nhà thuốc An Tâm", contactName: null, contactTitle: null, email: null, phone: null, need: "Video giới thiệu thương hiệu", budgetText: null, source: "referral" }, { personId: id.long, sells: false }, null);
  const activity = (client: { id: string }, dealTitle: string | null, kind: "call" | "meeting" | "email", subject: string, daysAgo: number, followUp: { owner: Key; dueIn: number; subject: string } | null) =>
    recordActivity({ kind, subject, body: null, clientId: client.id, contactId: contactOf.get(client.id) ?? null, dealId: dealTitle ? (dealOf.get(dealTitle) ?? null) : null, leadId: null, occurredAt: new Date(`${addDays(today, -daysAgo)}T10:00:00+07:00`), outcome: null, followUp: followUp && { ownerPersonId: id[followUp.owner], dueOn: addDays(today, followUp.dueIn), subject: followUp.subject } }, id.duc);
  await activity(caphe, "Chiến dịch Tết 2027 — Cà phê Đất Việt", "meeting", "Họp chốt phạm vi chiến dịch Tết", 2, { owner: "duc", dueIn: 2, subject: "Gửi báo giá điều chỉnh" });
  await activity(daiviet, "Phim thương hiệu Ngân hàng Đại Việt", "meeting", "Thuyết trình ý tưởng vòng 1", 6, { owner: "duc", dueIn: 5, subject: "Chuẩn bị vòng 2 cùng đạo diễn" });
  await activity(tlx, "Gia hạn retainer fanpage Trà Lá Xanh 2027", "call", "Trao đổi kế hoạch 2027", 9, { owner: "duc", dueIn: -3, subject: "Gửi đề xuất gia hạn" });
  await activity(mocan, null, "email", "Nhắc thanh toán đợt tạm ứng TVC", 12, null);

  console.log(`Seeded CRM demo: 6 accounts (3 new prospects), 6 contacts, ${DEALS.length} deals (${DEALS.length - won - lost} open, ${won} won, ${lost} lost), 2 contracts, ${invoices} invoices with ${payments} payments, 2 leads, 4 activities; Phan Văn Đức holds \`sales\`.`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
