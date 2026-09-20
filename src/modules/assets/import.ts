// The asset register in bulk (FR-AST-01) — the migration out of whatever spreadsheet the
// equipment currently lives in. New assets only: a code already on the books is a problem row and
// not an update, exactly as the employee import decided.
//
// A row may also name who is holding the thing, by employee code or work email, and the import
// then opens the assignment as well — because a register that knows every laptop and none of the
// people holding them is not worth typing in.
import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db, schema, type Tx } from "@/lib/db";
import type { CurrentUser } from "@/modules/platform/auth/session";
import { code, type Column, day, integer, oneOf, type ParsedRow, type Problem, templateCsv, text } from "@/modules/platform/import/engine/table";
import { defineImport } from "@/modules/platform/import/service";
import { ASSET_CONDITIONS, type AssetCondition } from "./enums";
import { canManageAssets } from "./policy";
import { newQrToken, nextAssetCode } from "./service";

const column = <Value>(definition: Column<Value>) => definition;
const optionalText = (headers: readonly [string, ...string[]], max: number, example = "") => column<string>({ headers, parse: text(max), example });

export const assetColumns = {
  code: column<string>({ headers: ["Mã tài sản", "Asset code", "Mã"], parse: code(40), example: "" }),
  name: column<string>({ headers: ["Tên tài sản", "Asset name", "Tên"], required: true, parse: text(200), example: "MacBook Pro 14" }),
  categoryCode: column<string>({ headers: ["Nhóm (mã)", "Category code", "Nhóm"], required: true, parse: code(12), example: "LAP" }),
  entityCode: column<string>({ headers: ["Pháp nhân (mã)", "Entity code", "Công ty"], required: true, parse: code(12), example: "SZM" }),
  brand: optionalText(["Hãng", "Brand"], 80, "Apple"),
  model: optionalText(["Model"], 120, "M3 Pro"),
  serial: optionalText(["Số sê-ri", "Serial", "Serial number"], 120, "C02XY1234"),
  purchaseDate: column<string>({ headers: ["Ngày mua", "Purchase date"], parse: day, example: "01/04/2025" }),
  purchasePrice: column<number>({ headers: ["Nguyên giá", "Purchase price", "Giá mua"], parse: integer, example: "52000000" }),
  supplier: optionalText(["Nhà cung cấp", "Supplier"], 200),
  warrantyUntil: column<string>({ headers: ["Bảo hành đến", "Warranty until"], parse: day, example: "" }),
  condition: column<AssetCondition>({
    headers: ["Tình trạng", "Condition"],
    parse: oneOf<AssetCondition>({ new: ["Mới"], good: ["Tốt"], fair: ["Bình thường", "Trung bình"], poor: ["Kém"], broken: ["Hỏng", "Hư"] }),
    example: "Tốt",
  }),
  location: optionalText(["Vị trí", "Location"], 200, "Kho tầng 3"),
  holder: optionalText(["Người giữ (mã NV hoặc email)", "Holder (employee code or email)", "Người giữ"], 200, "huy.ho@suzu.group"),
  notes: optionalText(["Ghi chú", "Notes"], 2000),
};

export const assetTemplate = () => templateCsv(assetColumns);

type Row = ParsedRow<typeof assetColumns>;
const header = (field: keyof typeof assetColumns) => assetColumns[field].headers[0];
const looksLikeEmail = (value: string) => value.includes("@");

type Lookups = {
  categories: Map<string, { id: string; requiresSerial: boolean }>;
  entities: Map<string, string>;
  people: Map<string, string>;
  takenCodes: Set<string>;
  takenSerials: Set<string>;
};

async function lookups(executor: Tx | ReturnType<typeof db>): Promise<Lookups> {
  const [categories, entities, people, assets] = await Promise.all([
    executor.select({ id: schema.assetCategory.id, code: schema.assetCategory.code, requiresSerial: schema.assetCategory.requiresSerial }).from(schema.assetCategory).where(eq(schema.assetCategory.isActive, true)),
    executor.select({ id: schema.entity.id, code: schema.entity.code }).from(schema.entity),
    executor.select({ id: schema.person.id, workEmail: schema.person.workEmail, employeeCode: schema.employment.employeeCode }).from(schema.person).leftJoin(schema.employment, and(eq(schema.employment.personId, schema.person.id), isNull(schema.employment.endDate))).where(eq(schema.person.status, "active")),
    executor.select({ code: schema.asset.code, serial: schema.asset.serial }).from(schema.asset),
  ]);
  const byPerson = new Map<string, string>();
  for (const row of people) {
    if (row.workEmail) byPerson.set(row.workEmail.toLowerCase(), row.id);
    if (row.employeeCode) byPerson.set(row.employeeCode.toUpperCase(), row.id);
  }
  return {
    categories: new Map(categories.map((row) => [row.code, { id: row.id, requiresSerial: row.requiresSerial }])),
    entities: new Map(entities.map((row) => [row.code, row.id])),
    people: byPerson,
    takenCodes: new Set(assets.map((row) => row.code)),
    takenSerials: new Set(assets.flatMap((row) => (row.serial ? [row.serial.toUpperCase()] : []))),
  };
}

/** Everything that would stop a row being written, found before anything is. */
export async function assetProblems(rows: readonly Row[], reference: Lookups, mayManage: (entityId: string) => boolean): Promise<Problem[]> {
  const problems: Problem[] = [];
  const codesInFile = new Map<string, number>();
  const serialsInFile = new Map<string, number>();

  for (const { row, values } of rows) {
    const category = values.categoryCode ? reference.categories.get(values.categoryCode) : undefined;
    if (values.categoryCode && !category) problems.push({ row, column: header("categoryCode"), code: "unknown_category", detail: values.categoryCode });
    const entityId = values.entityCode ? reference.entities.get(values.entityCode) : undefined;
    if (values.entityCode && !entityId) problems.push({ row, column: header("entityCode"), code: "unknown_entity", detail: values.entityCode });
    // An importer may only write into the entities they keep a register for.
    if (entityId && !mayManage(entityId)) problems.push({ row, column: header("entityCode"), code: "entity_not_allowed", detail: values.entityCode ?? "" });

    if (values.code) {
      if (reference.takenCodes.has(values.code)) problems.push({ row, column: header("code"), code: "code_taken", detail: values.code });
      const earlier = codesInFile.get(values.code);
      if (earlier) problems.push({ row, column: header("code"), code: "duplicate_in_file", detail: String(earlier) });
      codesInFile.set(values.code, row);
    }

    const serial = values.serial?.toUpperCase();
    if (serial) {
      if (reference.takenSerials.has(serial)) problems.push({ row, column: header("serial"), code: "serial_taken", detail: values.serial ?? "" });
      const earlier = serialsInFile.get(serial);
      if (earlier) problems.push({ row, column: header("serial"), code: "duplicate_in_file", detail: String(earlier) });
      serialsInFile.set(serial, row);
    } else if (category?.requiresSerial) {
      problems.push({ row, column: header("serial"), code: "serial_required" });
    }

    if (values.holder) {
      const key = looksLikeEmail(values.holder) ? values.holder.toLowerCase() : values.holder.toUpperCase();
      if (!reference.people.get(key)) problems.push({ row, column: header("holder"), code: "unknown_holder", detail: values.holder });
    }
    if (values.purchasePrice !== null && values.purchasePrice < 0) problems.push({ row, column: header("purchasePrice"), code: "negative_price" });
  }
  return problems;
}

export const assetImport = defineImport({
  kind: "assets",
  columns: assetColumns,
  authorize: (user) => canManageAssets(user.principal),
  validate: async (rows, user: CurrentUser) => assetProblems(rows, await lookups(db()), (entityId) => canManageAssets(user.principal, entityId)),
  commit: async (rows, tx, user) => {
    const reference = await lookups(tx);
    // Codes given by hand are taken as they are; the rest are numbered on from what is on the books.
    const nextByPrefix = new Map<string, number>();
    let assets = 0;
    let assigned = 0;

    for (const { values } of rows) {
      const category = reference.categories.get(values.categoryCode!)!;
      const entityId = reference.entities.get(values.entityCode!)!;
      let assetCode = values.code;
      if (!assetCode) {
        const prefix = `${values.entityCode}-${values.categoryCode}-`;
        if (!nextByPrefix.has(prefix)) {
          const next = await nextAssetCode(tx, values.entityCode!, values.categoryCode!);
          nextByPrefix.set(prefix, Number(next.slice(prefix.length)));
        }
        const number = nextByPrefix.get(prefix)!;
        nextByPrefix.set(prefix, number + 1);
        assetCode = `${prefix}${String(number).padStart(4, "0")}`;
      }

      const [asset] = await tx
        .insert(schema.asset)
        .values({
          code: assetCode,
          categoryId: category.id,
          entityId,
          name: values.name!,
          brand: values.brand,
          model: values.model,
          serial: values.serial,
          purchaseDate: values.purchaseDate,
          purchasePrice: values.purchasePrice,
          supplier: values.supplier,
          warrantyUntil: values.warrantyUntil,
          condition: values.condition ?? "good",
          location: values.location,
          notes: values.notes,
          qrToken: newQrToken(),
          status: "in_stock",
          createdByPersonId: user.person.id,
        })
        .returning();
      assets += 1;
      await tx.insert(schema.assetEvent).values({ assetId: asset.id, type: "imported", actorPersonId: user.person.id, detail: { code: asset.code } });

      if (values.holder) {
        const key = looksLikeEmail(values.holder) ? values.holder.toLowerCase() : values.holder.toUpperCase();
        const holderPersonId = reference.people.get(key)!;
        const [assignment] = await tx
          .insert(schema.assetAssignment)
          .values({ assetId: asset.id, holderType: "person", holderPersonId, assignedByPersonId: user.person.id, conditionOut: asset.condition, accessories: [] })
          .returning();
        await tx.update(schema.asset).set({ status: "assigned" }).where(eq(schema.asset.id, asset.id));
        // Imported history: the thing was already out before the register existed. The holder is
        // still asked to confirm, which is how the register catches what the spreadsheet had wrong.
        await tx.insert(schema.assetEvent).values({ assetId: asset.id, assignmentId: assignment.id, type: "assigned", actorPersonId: user.person.id, detail: { imported: true } });
        assigned += 1;
      }
    }
    return { assets, assigned };
  },
  onCommitted: () => {
    revalidatePath("/assets");
    revalidatePath("/assets/mine");
  },
});

/** Used by the register's screens to say which codes an import would refuse. */
export const takenAssetCodes = async (codes: readonly string[]): Promise<string[]> => {
  if (codes.length === 0) return [];
  const rows = await db().select({ code: schema.asset.code }).from(schema.asset).where(inArray(schema.asset.code, [...codes]));
  return rows.map((row) => row.code);
};

export { ASSET_CONDITIONS };
