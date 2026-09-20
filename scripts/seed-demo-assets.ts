// Demo equipment for the fake company (FR-AST-01, 02): every demo employee's kit, the shared
// production gear the week-3 booking calendar will book, a couple of spares in stock, one machine
// in for repair, and one laptop that came back scratched and went out again to somebody else.
//
// Written through the register's own tables in one transaction rather than through the service,
// because the seed runs as a script with no session; the shapes it writes are exactly what the
// use-cases write, and the one-holder rule is enforced by the database either way.
import { randomBytes } from "node:crypto";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { drizzle } from "drizzle-orm/postgres-js";
import { asset, assetAssignment, assetCategory, assetEvent, employment, entity, person } from "../src/lib/db/schema";
import type { AssetCondition } from "../src/modules/assets/enums";

type Db = ReturnType<typeof drizzle>;

/** email (or full name for the people without one) → what they are holding. */
type Kit = { category: string; name: string; brand?: string; model?: string; price: number; bought: string; condition?: AssetCondition; accessories?: string[]; confirmed?: boolean };

const LAPTOP = (name: string, price: number, bought: string): Kit => ({ category: "LAP", name, brand: name.startsWith("MacBook") ? "Apple" : "Dell", price, bought, accessories: ["Sạc", "Túi chống sốc"] });

// What each demo person carries. Kept deliberately unglamorous: this is a 20-person media company.
const KIT: Record<string, Kit[]> = {
  "owner@suzu.vn": [LAPTOP("MacBook Pro 16", 78_000_000, "2024-05-10"), { category: "PHO", name: "iPhone 15 Pro", brand: "Apple", price: 28_000_000, bought: "2024-09-25" }],
  "ha.nguyen@suzu.vn": [LAPTOP("MacBook Air 15", 38_000_000, "2024-08-02"), { category: "PHO", name: "iPhone 14", brand: "Apple", price: 19_000_000, bought: "2024-08-02" }],
  "mai.le@suzu.group": [LAPTOP("Dell Latitude 5450", 26_000_000, "2024-03-18"), { category: "MON", name: "Dell U2723QE 27\"", brand: "Dell", price: 12_500_000, bought: "2024-03-18" }],
  "bao.pham@suzu.group": [LAPTOP("Dell Latitude 5440", 23_000_000, "2023-07-11")],
  "tuan.vo@suzu.group": [LAPTOP("Dell Latitude 5450", 26_000_000, "2024-03-18"), { category: "MON", name: "Dell P2422H 24\"", brand: "Dell", price: 5_200_000, bought: "2024-03-18" }],
  "long.dang@suzu.group": [LAPTOP("MacBook Pro 14", 52_000_000, "2024-02-20"), { category: "PHO", name: "iPhone 13", brand: "Apple", price: 15_000_000, bought: "2023-04-04" }],
  "tam.bui@suzu.group": [LAPTOP("MacBook Pro 14", 52_000_000, "2024-06-12"), { category: "MON", name: "BenQ PD2705U 27\"", brand: "BenQ", price: 14_900_000, bought: "2024-06-12" }],
  "huy.ho@suzu.group": [LAPTOP("MacBook Pro 14", 49_000_000, "2023-08-01"), { category: "STOR", name: "Ổ cứng di động Samsung T7 2TB", brand: "Samsung", price: 4_300_000, bought: "2023-08-01" }],
  "linh.do@suzu.group": [LAPTOP("MacBook Air 13", 28_000_000, "2026-08-03", )],
  "chi.duong@suzu.group": [LAPTOP("MacBook Pro 14", 52_000_000, "2024-01-15"), { category: "MON", name: "Dell U2723QE 27\"", brand: "Dell", price: 12_500_000, bought: "2024-01-15" }],
  "khoi.ly@suzu.group": [LAPTOP("MacBook Air 13", 28_000_000, "2024-04-22"), { category: "MON", name: "Dell P2422H 24\"", brand: "Dell", price: 5_200_000, bought: "2024-04-22" }],
  "anh.trinh@suzu.group": [LAPTOP("Dell Vostro 3520", 15_500_000, "2026-06-15")],
  "duc.phan@suzu.group": [LAPTOP("MacBook Air 13", 27_000_000, "2023-03-06"), { category: "PHO", name: "iPhone 13", brand: "Apple", price: 15_000_000, bought: "2023-03-06" }],
  "duyen.huynh@suzu.group": [LAPTOP("Dell Vostro 3520", 15_500_000, "2024-10-01")],
  "thu.mai@suzu.group": [LAPTOP("Dell Latitude 5440", 23_000_000, "2026-11-02")],
  "ngan.vu@suzu.group": [LAPTOP("Dell Latitude 5440", 23_000_000, "2024-03-04")],
  // The collaborator with no work email, held by full name.
  "Ngô Bảo Anh": [{ category: "CAM", name: "Sony A7 IV", brand: "Sony", price: 54_000_000, bought: "2024-11-01", accessories: ["2 pin", "Sạc đôi", "Thẻ nhớ 128GB"], confirmed: false }],
};

/** The shared production gear: held by the company itself — the shelf in the studio, not any one person. */
const TEAM_GEAR: Kit[] = [
  { category: "CAM", name: "Sony FX6", brand: "Sony", model: "ILME-FX6V", price: 148_000_000, bought: "2024-02-02", accessories: ["3 pin BP-U60", "Sạc", "Tay cầm XLR"] },
  { category: "CAM", name: "Sony FX3", brand: "Sony", model: "ILME-FX3", price: 92_000_000, bought: "2023-05-19", accessories: ["2 pin", "Sạc"] },
  { category: "LEN", name: "Sony 24-70mm f/2.8 GM II", brand: "Sony", price: 56_000_000, bought: "2024-02-02" },
  { category: "LEN", name: "Sony 70-200mm f/2.8 GM II", brand: "Sony", price: 63_000_000, bought: "2024-02-02" },
  { category: "LEN", name: "Sigma 18-35mm f/1.8", brand: "Sigma", price: 21_000_000, bought: "2022-09-30" },
  { category: "LGT", name: "Aputure 600d Pro", brand: "Aputure", price: 46_000_000, bought: "2023-11-14", accessories: ["Softbox", "Chân đèn"] },
  { category: "LGT", name: "Aputure 300x", brand: "Aputure", price: 24_000_000, bought: "2023-11-14" },
  { category: "AUD", name: "Rode Wireless PRO", brand: "Rode", price: 11_500_000, bought: "2024-07-08" },
  { category: "GRIP", name: "Chân máy Manfrotto 504X", brand: "Manfrotto", price: 18_000_000, bought: "2022-06-21" },
  { category: "DRN", name: "DJI Mavic 3 Pro", brand: "DJI", price: 61_000_000, bought: "2024-04-12", accessories: ["3 pin", "Túi đựng"] },
];

/** Not handed to anyone: the spares, the machine in for repair, the thing that was written off. */
const UNASSIGNED: (Kit & { status?: "in_stock" | "in_repair" | "lost"; location?: string })[] = [
  { category: "LAP", name: "MacBook Air 13 (máy dự phòng)", brand: "Apple", price: 28_000_000, bought: "2023-02-14", status: "in_stock", location: "Kho tầng 3" },
  { category: "MON", name: "Dell P2422H 24\" (dự phòng)", brand: "Dell", price: 5_200_000, bought: "2023-02-14", status: "in_stock", location: "Kho tầng 3" },
  { category: "LGT", name: "Aputure 120d II", brand: "Aputure", price: 13_000_000, bought: "2021-08-03", status: "in_repair", condition: "broken", location: "Gửi bảo hành Aputure" },
  { category: "STOR", name: "Thẻ nhớ CFexpress 512GB", brand: "SanDisk", price: 9_800_000, bought: "2023-05-19", status: "lost", condition: "good" },
];

const token = () => randomBytes(16).toString("hex");

export async function seedAssets(db: Db, today: string): Promise<{ assets: number; assigned: number }> {
  const existing = await db.select({ id: asset.id }).from(asset).limit(1);
  if (existing.length > 0) return { assets: 0, assigned: 0 };

  const categories = new Map((await db.select().from(assetCategory)).map((row) => [row.code, row]));
  const entities = new Map((await db.select().from(entity)).map((row) => [row.code, row]));
  // Only people who are actually here: the register refuses to hand anything to a leaver.
  const people = await db
    .select({ id: person.id, fullName: person.fullName, workEmail: person.workEmail, entityId: person.primaryEntityId })
    .from(person)
    .leftJoin(employment, and(eq(employment.personId, person.id), isNull(employment.endDate)))
    .where(eq(person.status, "active"))
    .orderBy(asc(person.fullName));
  const byKey = new Map(people.flatMap((row) => [[row.workEmail?.toLowerCase() ?? row.fullName, row] as const]));
  const keeper = byKey.get("mai.le@suzu.group") ?? people[0];

  // Codes are numbered per entity and category, exactly as `nextAssetCode` does it.
  const counters = new Map<string, number>();
  const nextCode = (entityCode: string, categoryCode: string) => {
    const prefix = `${entityCode}-${categoryCode}-`;
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}${String(next).padStart(4, "0")}`;
  };

  let assets = 0;
  let assigned = 0;

  async function put(kit: Kit & { status?: string; location?: string }, entityCode: string, holder: { type: "person" | "team" | "entity"; id: string } | null, options: { confirmed?: boolean; assignedAt?: Date } = {}) {
    const category = categories.get(kit.category);
    const owner = entities.get(entityCode);
    if (!category || !owner) return null;
    const [row] = await db
      .insert(asset)
      .values({
        code: nextCode(entityCode, kit.category),
        categoryId: category.id,
        entityId: owner.id,
        name: kit.name,
        brand: kit.brand ?? null,
        model: kit.model ?? null,
        serial: category.requiresSerial ? `SN${randomBytes(4).toString("hex").toUpperCase()}` : null,
        purchaseDate: kit.bought,
        purchasePrice: kit.price,
        supplier: kit.category === "LAP" || kit.category === "PHO" || kit.category === "MON" ? "Thế Giới Di Động" : "Kingmedia Equipment",
        warrantyUntil: category.defaultWarrantyMonths ? new Date(new Date(kit.bought).setMonth(new Date(kit.bought).getMonth() + category.defaultWarrantyMonths)).toISOString().slice(0, 10) : null,
        condition: kit.condition ?? "good",
        status: holder ? "assigned" : ((kit.status as "in_stock") ?? "in_stock"),
        location: kit.location ?? (holder ? null : "Kho tầng 3"),
        qrToken: token(),
        createdByPersonId: keeper?.id ?? null,
        retiredAt: kit.status === "lost" ? new Date() : null,
      })
      .returning();
    assets += 1;
    await db.insert(assetEvent).values({ assetId: row.id, type: "acquired", actorPersonId: keeper?.id ?? null, detail: { code: row.code, name: row.name } });
    if (kit.status === "in_repair") await db.insert(assetEvent).values({ assetId: row.id, type: "condition_changed", actorPersonId: keeper?.id ?? null, note: "Đèn không lên nguồn, đã gửi bảo hành.", detail: { from: "in_stock", to: "in_repair" } });
    if (kit.status === "lost") await db.insert(assetEvent).values({ assetId: row.id, type: "lost", actorPersonId: keeper?.id ?? null, note: "Thất lạc tại hiện trường quay Đà Lạt." });

    if (holder) {
      const assignedAt = options.assignedAt ?? new Date(`${kit.bought}T03:00:00Z`);
      const [spell] = await db
        .insert(assetAssignment)
        .values({
          assetId: row.id,
          holderType: holder.type,
          holderPersonId: holder.type === "person" ? holder.id : null,
          holderTeamId: holder.type === "team" ? holder.id : null,
          holderEntityId: holder.type === "entity" ? holder.id : null,
          assignedByPersonId: keeper?.id ?? null,
          assignedAt,
          conditionOut: kit.condition ?? "good",
          accessories: kit.accessories ?? [],
          handoverConfirmedAt: options.confirmed === false || holder.type !== "person" ? null : new Date(assignedAt.getTime() + 3_600_000),
          handoverNote: options.confirmed === false || holder.type !== "person" ? null : "Đã nhận đủ.",
        })
        .returning();
      assigned += 1;
      await db.insert(assetEvent).values({ assetId: row.id, assignmentId: spell.id, type: "assigned", actorPersonId: keeper?.id ?? null, detail: { holderType: holder.type } });
      if (options.confirmed !== false && holder.type === "person") await db.insert(assetEvent).values({ assetId: row.id, assignmentId: spell.id, type: "handover_confirmed", actorPersonId: holder.id, note: "Đã nhận đủ." });
    }
    return row;
  }

  for (const [key, kits] of Object.entries(KIT)) {
    const holder = byKey.get(key);
    if (!holder) continue;
    const entityCode = [...entities.values()].find((row) => row.id === holder.entityId)?.code ?? "SZM";
    for (const kit of kits) await put(kit, entityCode, { type: "person", id: holder.id }, { confirmed: kit.confirmed });
  }

  // Shared gear sits on Suzu Media's own shelf: held by the company, not by any one person, which
  // is what the third kind of holder is for. Nobody signs for it, so no handover is recorded.
  const media = entities.get("SZM");
  for (const kit of TEAM_GEAR) await put(kit, "SZM", media ? { type: "entity", id: media.id } : null);
  for (const kit of UNASSIGNED) await put(kit, "SZM", null);

  // The exit criterion is that *every* current employee's equipment is recorded, and other seeds
  // add people this file has never heard of. Anybody still empty-handed gets a working machine.
  const held = new Set((await db.select({ id: assetAssignment.holderPersonId }).from(assetAssignment).where(isNull(assetAssignment.returnedAt))).flatMap((row) => (row.id ? [row.id] : [])));
  for (const row of people) {
    if (held.has(row.id)) continue;
    const entityCode = [...entities.values()].find((owner) => owner.id === row.entityId)?.code ?? "SZM";
    await put(LAPTOP("Dell Latitude 5440", 23_000_000, "2025-01-06"), entityCode, { type: "person", id: row.id });
  }

  // One laptop with a history: out to the intern, back scratched, out again to the part-timer.
  const intern = byKey.get("anh.trinh@suzu.group");
  const partTimer = byKey.get("duyen.huynh@suzu.group");
  const shared = await put({ category: "LAP", name: "MacBook Air 13 (máy luân chuyển)", brand: "Apple", price: 26_000_000, bought: "2022-03-15" }, "SZC", null);
  if (shared && intern && partTimer) {
    const out = new Date("2024-02-01T03:00:00Z");
    const back = new Date("2025-06-30T09:00:00Z");
    const [first] = await db
      .insert(assetAssignment)
      .values({ assetId: shared.id, holderType: "person", holderPersonId: intern.id, assignedByPersonId: keeper?.id ?? null, assignedAt: out, conditionOut: "good", accessories: ["Sạc"], handoverConfirmedAt: new Date(out.getTime() + 3_600_000), handoverNote: "Đã nhận.", returnedAt: back, returnedToPersonId: keeper?.id ?? null, conditionIn: "fair", returnNote: "Xước nhẹ mặt A, bản lề còn tốt." })
      .returning();
    await db.insert(assetEvent).values([
      { assetId: shared.id, assignmentId: first.id, type: "assigned", actorPersonId: keeper?.id ?? null, detail: { holderType: "person" } },
      { assetId: shared.id, assignmentId: first.id, type: "handover_confirmed", actorPersonId: intern.id, note: "Đã nhận." },
      { assetId: shared.id, assignmentId: first.id, type: "returned", actorPersonId: keeper?.id ?? null, note: "Xước nhẹ mặt A, bản lề còn tốt.", detail: { conditionIn: "fair" } },
    ]);
    const again = new Date(`${today}T02:00:00Z`);
    again.setDate(again.getDate() - 20);
    const [second] = await db
      .insert(assetAssignment)
      .values({ assetId: shared.id, holderType: "person", holderPersonId: partTimer.id, assignedByPersonId: keeper?.id ?? null, assignedAt: again, conditionOut: "fair", accessories: ["Sạc"] })
      .returning();
    await db.insert(assetEvent).values({ assetId: shared.id, assignmentId: second.id, type: "assigned", actorPersonId: keeper?.id ?? null, detail: { holderType: "person" } });
    await db.update(asset).set({ status: "assigned", condition: "fair" }).where(eq(asset.id, shared.id));
    assigned += 1;
  }

  return { assets, assigned };
}
