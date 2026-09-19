// Time clocks and their logs (FR-ATT-06): devices, mapping profiles per device model, the map from
// a clock's user IDs to people, and the log import on the platform import framework.
//
// The import is idempotent: a punch is identified by (device, device user ID, moment), so
// re-importing an overlapping export adds only what is new. An ID nobody is mapped to does not fail
// the batch: its lines wait in `device_unmapped_log` and become punches the moment HR maps the ID.
import "server-only";
import { and, asc, count, desc, eq, inArray, max, min, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError } from "@/lib/action";
import { addDays, type IsoDate } from "@/lib/dates";
import { db, schema, type Tx } from "@/lib/db";
import { listEmploymentFacts } from "@/modules/core-hr/service";
import { type Column, oneOf, type ParsedRow, type Problem, text } from "@/modules/platform/import/engine/table";
import { defineImport, readSpreadsheet } from "@/modules/platform/import/service";
import { can, type Principal } from "@/modules/platform/rbac/policy";
import { CANONICAL_HEADERS, type DeviceMapping, inferredDirection, mappingProblems, parseDat, parseTimestamp, toCanonicalTable } from "./engine/device-log";
import { vietnamDateAndMinute } from "./engine/merge";
import { recomputeDays } from "./timesheets";

type Executor = Tx | ReturnType<typeof db>;
export type DeviceRow = typeof schema.attendanceDevice.$inferSelect;
export type ProfileRow = typeof schema.deviceMappingProfile.$inferSelect;

export const DEVICE_IMPORT_KIND = "attendance_device_log";
const EXTENSION_OF = { csv: ["csv"], xlsx: ["xlsx"], dat: ["dat", "txt", "log"] } as const;

// ── Profiles ────────────────────────────────────────────────────────────────────────────────

export async function listProfiles(): Promise<(ProfileRow & { entityName: string | null })[]> {
  const rows = await db().select({ profile: schema.deviceMappingProfile, entityName: schema.entity.shortName }).from(schema.deviceMappingProfile).leftJoin(schema.entity, eq(schema.entity.id, schema.deviceMappingProfile.entityId)).orderBy(asc(schema.deviceMappingProfile.name));
  return rows.map((row) => ({ ...row.profile, entityName: row.entityName }));
}

export const getProfile = async (id: string): Promise<ProfileRow | null> => (await db().select().from(schema.deviceMappingProfile).where(eq(schema.deviceMappingProfile.id, id)).limit(1))[0] ?? null;

export type ProfileInput = { id: string | null; entityId: string | null; name: string; deviceModel: string | null; fileKind: "csv" | "xlsx" | "dat"; mapping: DeviceMapping; isActive: boolean };

export async function saveProfile(input: ProfileInput): Promise<{ before: ProfileRow | null; after: ProfileRow }> {
  const problems = mappingProblems(input.mapping);
  if (problems.length) throw new ActionError(problems[0]);
  const before = input.id ? await getProfile(input.id) : null;
  if (input.id && !before) throw new ActionError("not_found");
  const values = { name: input.name, deviceModel: input.deviceModel, fileKind: input.fileKind, mapping: input.mapping, isActive: input.isActive, updatedAt: new Date() };
  try {
    // A profile stays where it was created (group or entity): moving it would change who may edit it.
    const [after] = before ? await db().update(schema.deviceMappingProfile).set(values).where(eq(schema.deviceMappingProfile.id, before.id)).returning() : await db().insert(schema.deviceMappingProfile).values({ ...values, entityId: input.entityId }).returning();
    return { before, after };
  } catch (error) {
    if (String((error as { cause?: unknown }).cause ?? error).includes("device_mapping_profile_name_key")) throw new ActionError("profile_name_taken");
    throw error;
  }
}

// ── Devices ─────────────────────────────────────────────────────────────────────────────────

export type DeviceView = DeviceRow & { entityName: string; profileName: string; fileKind: ProfileRow["fileKind"]; mapped: number; unmapped: number; lastPunchAt: Date | null };

export async function listDevices(principal: Principal): Promise<DeviceView[]> {
  const rows = await db()
    .select({ device: schema.attendanceDevice, entityName: schema.entity.shortName, profileName: schema.deviceMappingProfile.name, fileKind: schema.deviceMappingProfile.fileKind })
    .from(schema.attendanceDevice)
    .innerJoin(schema.entity, eq(schema.entity.id, schema.attendanceDevice.entityId))
    .innerJoin(schema.deviceMappingProfile, eq(schema.deviceMappingProfile.id, schema.attendanceDevice.profileId))
    .orderBy(asc(schema.entity.shortName), asc(schema.attendanceDevice.name));
  const visible = rows.filter((row) => can(principal, "attendance:manage", { entityId: row.device.entityId }));
  const ids = visible.map((row) => row.device.id);
  if (ids.length === 0) return [];
  const [mapped, unmapped, last] = await Promise.all([
    db().select({ deviceId: schema.deviceUserMap.deviceId, value: count() }).from(schema.deviceUserMap).where(inArray(schema.deviceUserMap.deviceId, ids)).groupBy(schema.deviceUserMap.deviceId),
    db().select({ deviceId: schema.deviceUnmappedLog.deviceId, value: sql<number>`count(distinct ${schema.deviceUnmappedLog.deviceUserId})::int` }).from(schema.deviceUnmappedLog).where(inArray(schema.deviceUnmappedLog.deviceId, ids)).groupBy(schema.deviceUnmappedLog.deviceId),
    db().select({ deviceId: schema.punch.deviceId, value: max(schema.punch.at) }).from(schema.punch).where(inArray(schema.punch.deviceId, ids)).groupBy(schema.punch.deviceId),
  ]);
  return visible.map((row) => ({
    ...row.device,
    entityName: row.entityName,
    profileName: row.profileName,
    fileKind: row.fileKind,
    mapped: mapped.find((item) => item.deviceId === row.device.id)?.value ?? 0,
    unmapped: unmapped.find((item) => item.deviceId === row.device.id)?.value ?? 0,
    lastPunchAt: last.find((item) => item.deviceId === row.device.id)?.value ?? null,
  }));
}

export const getDevice = async (id: string, executor: Executor = db()): Promise<DeviceRow | null> => (await executor.select().from(schema.attendanceDevice).where(eq(schema.attendanceDevice.id, id)).limit(1))[0] ?? null;

export type DeviceInput = { id: string | null; entityId: string; name: string; model: string | null; serialNumber: string | null; locationId: string | null; profileId: string; isActive: boolean };

export async function saveDevice(input: DeviceInput): Promise<{ before: DeviceRow | null; after: DeviceRow }> {
  const before = input.id ? await getDevice(input.id) : null;
  if (input.id && !before) throw new ActionError("not_found");
  const entityId = before?.entityId ?? input.entityId;
  const profile = await getProfile(input.profileId);
  if (!profile || (profile.entityId !== null && profile.entityId !== entityId)) throw new ActionError("profile_not_found");
  if (input.locationId) {
    const [location] = await db().select({ entityId: schema.workLocation.entityId }).from(schema.workLocation).where(eq(schema.workLocation.id, input.locationId)).limit(1);
    if (!location || location.entityId !== entityId) throw new ActionError("location_not_found");
  }
  const values = { name: input.name, model: input.model, serialNumber: input.serialNumber, locationId: input.locationId, profileId: input.profileId, isActive: input.isActive, updatedAt: new Date() };
  try {
    const [after] = before ? await db().update(schema.attendanceDevice).set(values).where(eq(schema.attendanceDevice.id, before.id)).returning() : await db().insert(schema.attendanceDevice).values({ ...values, entityId }).returning();
    return { before, after };
  } catch (error) {
    if (String((error as { cause?: unknown }).cause ?? error).includes("attendance_device_entity_name_key")) throw new ActionError("device_name_taken");
    throw error;
  }
}

// ── Whose ID is whose ───────────────────────────────────────────────────────────────────────

export type UserMapView = { id: string; deviceUserId: string; personId: string; fullName: string; employeeCode: string | null };
export type UnmappedView = { deviceUserId: string; lines: number; firstAt: Date; lastAt: Date };

export async function listUserMap(deviceId: string): Promise<UserMapView[]> {
  const rows = await db()
    .select({ id: schema.deviceUserMap.id, deviceUserId: schema.deviceUserMap.deviceUserId, personId: schema.deviceUserMap.personId, fullName: schema.person.fullName })
    .from(schema.deviceUserMap)
    .innerJoin(schema.person, eq(schema.person.id, schema.deviceUserMap.personId))
    .where(eq(schema.deviceUserMap.deviceId, deviceId));
  const codes = new Map((await listEmploymentFacts({ personIds: rows.map((row) => row.personId) })).map((fact) => [fact.personId, fact.employeeCode]));
  return rows.map((row) => ({ ...row, employeeCode: codes.get(row.personId) ?? null })).sort((a, b) => a.deviceUserId.localeCompare(b.deviceUserId, undefined, { numeric: true }));
}

export async function listUnmapped(deviceId: string): Promise<UnmappedView[]> {
  const rows = await db()
    .select({ deviceUserId: schema.deviceUnmappedLog.deviceUserId, lines: count(), firstAt: min(schema.deviceUnmappedLog.at), lastAt: max(schema.deviceUnmappedLog.at) })
    .from(schema.deviceUnmappedLog)
    .where(eq(schema.deviceUnmappedLog.deviceId, deviceId))
    .groupBy(schema.deviceUnmappedLog.deviceUserId);
  return rows.map((row) => ({ deviceUserId: row.deviceUserId, lines: row.lines, firstAt: row.firstAt!, lastAt: row.lastAt! })).sort((a, b) => a.deviceUserId.localeCompare(b.deviceUserId, undefined, { numeric: true }));
}

type NewPunch = { personId: string; entityId: string | null; at: Date; direction: "in" | "out" | null; deviceUserId: string };

/** Inserts device punches that are not there yet; direction-less ones take their place in the person-day's order. Returns what was new. */
async function insertDevicePunches(tx: Tx, deviceId: string, batchId: string | null, candidates: NewPunch[]): Promise<{ inserted: number; people: string[]; from: IsoDate | null; to: IsoDate | null }> {
  if (candidates.length === 0) return { inserted: 0, people: [], from: null, to: null };
  const people = [...new Set(candidates.map((item) => item.personId))];
  const times = candidates.map((item) => item.at.getTime());
  const lowest = new Date(Math.min(...times) - 86_400_000);
  const highest = new Date(Math.max(...times) + 86_400_000);
  const existing = await tx
    .select({ personId: schema.punch.personId, at: schema.punch.at })
    .from(schema.punch)
    .where(and(inArray(schema.punch.personId, people), eq(schema.punch.source, "device"), sql`${schema.punch.at} between ${lowest.toISOString()}::timestamptz and ${highest.toISOString()}::timestamptz`));
  const dayKey = (personId: string, at: Date) => `${personId}:${vietnamDateAndMinute(at.getTime()).date}`;
  const already = new Map<string, number>();
  for (const row of existing) already.set(dayKey(row.personId, row.at), (already.get(dayKey(row.personId, row.at)) ?? 0) + 1);

  const position = new Map<string, number>();
  const values = [...candidates]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .map((item) => {
      const key = dayKey(item.personId, item.at);
      const index = position.get(key) ?? 0;
      position.set(key, index + 1);
      return { personId: item.personId, entityId: item.entityId, at: item.at, direction: item.direction ?? inferredDirection(already.get(key) ?? 0, index), source: "device" as const, deviceId, deviceUserId: item.deviceUserId, importBatchId: batchId };
    });

  let inserted = 0;
  const touched: { personId: string; at: Date }[] = [];
  for (let index = 0; index < values.length; index += 500) {
    const rows = await tx
      .insert(schema.punch)
      .values(values.slice(index, index + 500))
      .onConflictDoNothing({ target: [schema.punch.deviceId, schema.punch.deviceUserId, schema.punch.at], where: sql`${schema.punch.deviceId} is not null` })
      .returning({ personId: schema.punch.personId, at: schema.punch.at });
    inserted += rows.length;
    touched.push(...rows);
  }
  if (touched.length === 0) return { inserted: 0, people: [], from: null, to: null };
  const dates = touched.map((row) => vietnamDateAndMinute(row.at.getTime()).date).sort();
  return { inserted, people: [...new Set(touched.map((row) => row.personId))], from: dates[0], to: dates.at(-1)! };
}

async function recomputeAfterImport(tx: Tx, result: { people: string[]; from: IsoDate | null; to: IsoDate | null }): Promise<void> {
  if (!result.from || !result.to) return;
  // The day before too: a night shift's departure closes it.
  for (let index = 0; index < result.people.length; index += 40) await recomputeDays(result.people.slice(index, index + 40), addDays(result.from, -1), result.to, tx);
}

/** Maps one ID and turns its waiting log lines into punches. */
export async function mapDeviceUser(deviceId: string, deviceUserId: string, personId: string, actorPersonId: string): Promise<{ resolved: number }> {
  return db().transaction(async (tx) => {
    const device = await getDevice(deviceId, tx as Tx);
    const [person] = await tx.select({ id: schema.person.id, entityId: schema.person.primaryEntityId }).from(schema.person).where(eq(schema.person.id, personId)).limit(1);
    if (!device || !person) throw new ActionError("not_found");
    const [taken] = await tx.select({ id: schema.deviceUserMap.id }).from(schema.deviceUserMap).where(and(eq(schema.deviceUserMap.deviceId, deviceId), eq(schema.deviceUserMap.deviceUserId, deviceUserId))).limit(1);
    if (taken) throw new ActionError("device_user_taken");
    await tx.insert(schema.deviceUserMap).values({ deviceId, deviceUserId, personId, createdByPersonId: actorPersonId });
    return { resolved: await resolveUnmapped(tx as Tx, deviceId, [{ deviceUserId, personId, entityId: person.entityId }]) };
  });
}

async function resolveUnmapped(tx: Tx, deviceId: string, mapped: { deviceUserId: string; personId: string; entityId: string | null }[]): Promise<number> {
  if (mapped.length === 0) return 0;
  const waiting = await tx.select().from(schema.deviceUnmappedLog).where(and(eq(schema.deviceUnmappedLog.deviceId, deviceId), inArray(schema.deviceUnmappedLog.deviceUserId, mapped.map((item) => item.deviceUserId))));
  if (waiting.length === 0) return 0;
  const owner = new Map(mapped.map((item) => [item.deviceUserId, item]));
  const result = await insertDevicePunches(tx, deviceId, null, waiting.map((line) => ({ personId: owner.get(line.deviceUserId)!.personId, entityId: owner.get(line.deviceUserId)!.entityId, at: line.at, direction: line.direction, deviceUserId: line.deviceUserId })));
  await tx.delete(schema.deviceUnmappedLog).where(inArray(schema.deviceUnmappedLog.id, waiting.map((line) => line.id)));
  await recomputeAfterImport(tx, result);
  return result.inserted;
}

export async function unmapDeviceUser(mapId: string): Promise<{ deviceId: string; deviceUserId: string; personId: string }> {
  const [row] = await db().delete(schema.deviceUserMap).where(eq(schema.deviceUserMap.id, mapId)).returning();
  if (!row) throw new ActionError("not_found");
  // Punches already imported stay with the person they were imported for; only future imports change.
  return row;
}

export const getUserMapRow = async (mapId: string) => (await db().select().from(schema.deviceUserMap).where(eq(schema.deviceUserMap.id, mapId)).limit(1))[0] ?? null;

export type BulkMapProblem = { line: number; code: "bad_line" | "employee_not_found" | "device_user_taken" | "duplicate_in_list" };

/** Lines of "device user ID, employee code". All or nothing; every problem at once. People must belong to the device's entity. */
export async function bulkMapByEmployeeCode(deviceId: string, lines: string, actorPersonId: string): Promise<{ mapped: number; resolved: number }> {
  return db().transaction(async (tx) => {
    const device = await getDevice(deviceId, tx as Tx);
    if (!device) throw new ActionError("not_found");
    const parsed = lines.split(/\r?\n/).map((raw, index) => ({ line: index + 1, fields: raw.split(/[,;\t]/).map((field) => field.trim()) })).filter((item) => item.fields.some(Boolean));
    const facts = await listEmploymentFacts({ employeeCodes: parsed.map((item) => (item.fields[1] ?? "").toUpperCase()).filter(Boolean) }, tx as Tx);
    const byCode = new Map(facts.filter((fact) => fact.entityId === device.entityId && fact.employeeCode).map((fact) => [fact.employeeCode!.toUpperCase(), fact]));
    const current = await tx.select().from(schema.deviceUserMap).where(eq(schema.deviceUserMap.deviceId, deviceId));
    const problems: BulkMapProblem[] = [];
    const seenIds = new Set<string>();
    const rows: { deviceUserId: string; personId: string; entityId: string | null }[] = [];
    for (const item of parsed) {
      const [deviceUserId, code] = item.fields;
      if (item.fields.length < 2 || !deviceUserId || !code) problems.push({ line: item.line, code: "bad_line" });
      else {
        const person = byCode.get(code.toUpperCase());
        if (!person) problems.push({ line: item.line, code: "employee_not_found" });
        else if (seenIds.has(deviceUserId)) problems.push({ line: item.line, code: "duplicate_in_list" });
        else if (current.some((row) => row.deviceUserId === deviceUserId)) problems.push({ line: item.line, code: "device_user_taken" });
        else rows.push({ deviceUserId, personId: person.personId, entityId: person.entityId });
        seenIds.add(deviceUserId);
      }
    }
    if (problems.length) throw new ActionError("bulk_map_problems", problems);
    if (rows.length === 0) throw new ActionError("bulk_map_empty");
    await tx.insert(schema.deviceUserMap).values(rows.map((row) => ({ deviceId, deviceUserId: row.deviceUserId, personId: row.personId, createdByPersonId: actorPersonId })));
    return { mapped: rows.length, resolved: await resolveUnmapped(tx as Tx, deviceId, rows) };
  });
}

// ── The log import ──────────────────────────────────────────────────────────────────────────

// Canonical and a real moment: "2026-09-18 25:61:00" has the shape but is no time.
const timestamp = (cell: string) => (parseTimestamp(cell, "YYYY-MM-DD HH:mm:ss") === cell ? { ok: true as const, value: cell } : { ok: false as const, code: "bad_timestamp" });

export const deviceLogColumns = {
  deviceUserId: { headers: [CANONICAL_HEADERS[0], "Mã trên máy"], required: true, parse: text(40), example: "17" } as Column<string>,
  at: { headers: [CANONICAL_HEADERS[1], "Thời điểm"], required: true, parse: timestamp, example: "2026-08-03 08:27:31" } as Column<string>,
  direction: { headers: [CANONICAL_HEADERS[2], "Chiều"], parse: oneOf({ in: ["vào"], out: ["ra"] }), example: "in" } as Column<"in" | "out">,
};

type LogRow = ParsedRow<typeof deviceLogColumns>;
const paramsSchema = z.object({ deviceId: z.uuid() });
type Params = z.output<typeof paramsSchema>;

/** Device clocks show Vietnam time and export no zone. */
const instantOfLocal = (local: string) => new Date(`${local.replace(" ", "T")}+07:00`);

async function deviceFor(params: Params | undefined, principal: Principal, executor: Executor = db()) {
  const device = params ? await getDevice(params.deviceId, executor) : null;
  return device && device.isActive && can(principal, "attendance:manage", { entityId: device.entityId }) ? device : null;
}

/** Exported for the service tests. */
export async function checkLogRows(rows: LogRow[], deviceId: string, executor: Executor = db(), now: Date = new Date()): Promise<{ problems: Problem[]; owners: Map<string, { personId: string; entityId: string | null }> }> {
  const problems: Problem[] = [];
  const map = await executor
    .select({ deviceUserId: schema.deviceUserMap.deviceUserId, personId: schema.deviceUserMap.personId, entityId: schema.person.primaryEntityId })
    .from(schema.deviceUserMap)
    .innerJoin(schema.person, eq(schema.person.id, schema.deviceUserMap.personId))
    .where(eq(schema.deviceUserMap.deviceId, deviceId));
  const owners = new Map(map.map((row) => [row.deviceUserId, { personId: row.personId, entityId: row.entityId }]));
  const unknown = new Map<string, { row: number; lines: number }>();
  for (const row of rows) {
    const { deviceUserId, at } = row.values;
    if (!deviceUserId || !at) continue;
    // A clock set to the wrong year, or a file from the wrong clock.
    if (instantOfLocal(at).getTime() > now.getTime() + 3_600_000) problems.push({ row: row.row, column: CANONICAL_HEADERS[1], code: "timestamp_in_future" });
    if (!owners.has(deviceUserId)) {
      const entry = unknown.get(deviceUserId);
      if (entry) entry.lines++;
      else unknown.set(deviceUserId, { row: row.row, lines: 1 });
    }
  }
  // Not a reason to stop: the lines are kept and become punches when the ID is mapped.
  for (const [deviceUserId, entry] of unknown) problems.push({ row: entry.row, column: CANONICAL_HEADERS[0], code: "device_user_unmapped", severity: "warning", detail: `${deviceUserId} (${entry.lines})` });
  return { problems, owners };
}

/** Exported for the service tests; the import itself goes through `deviceLogImport`. */
export async function commitLogRows(rows: LogRow[], tx: Tx, deviceId: string, batchId: string | null): Promise<{ punches: number; skipped: number; unmapped: number; people: number }> {
  const { owners } = await checkLogRows(rows, deviceId, tx);
  const mapped: NewPunch[] = [];
  const waiting: (typeof schema.deviceUnmappedLog.$inferInsert)[] = [];
  const seen = new Set<string>();
  let usable = 0;
  for (const row of rows) {
    const { deviceUserId, at, direction } = row.values;
    if (!deviceUserId || !at) continue;
    usable++;
    const key = `${deviceUserId}@${at}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const owner = owners.get(deviceUserId);
    if (owner) mapped.push({ personId: owner.personId, entityId: owner.entityId, at: instantOfLocal(at), direction, deviceUserId });
    else waiting.push({ deviceId, deviceUserId, at: instantOfLocal(at), direction, importBatchId: batchId });
  }
  const result = await insertDevicePunches(tx, deviceId, batchId, mapped);
  let unmapped = 0;
  for (let index = 0; index < waiting.length; index += 500) unmapped += (await tx.insert(schema.deviceUnmappedLog).values(waiting.slice(index, index + 500)).onConflictDoNothing().returning({ id: schema.deviceUnmappedLog.id })).length;
  await recomputeAfterImport(tx, result);
  // skipped = lines that were already on the books (an overlapping export) or repeated in the file.
  return { punches: result.inserted, skipped: usable - result.inserted - unmapped, unmapped, people: result.people.length };
}

export const deviceLogImport = defineImport({
  kind: DEVICE_IMPORT_KIND,
  columns: deviceLogColumns,
  params: paramsSchema,
  extensions: ["csv", "xlsx", "dat", "txt", "log"],
  authorize: async (user, params) => (params ? !!(await deviceFor(params, user.principal)) : can(user.principal, "attendance:manage")),
  readTable: async (file, params) => {
    const device = await getDevice(params.deviceId);
    const profile = device ? await getProfile(device.profileId) : null;
    if (!profile) throw new ActionError("profile_not_found");
    if (!(EXTENSION_OF[profile.fileKind] as readonly string[]).includes(file.extension)) throw new ActionError("import_file_type");
    const raw = profile.fileKind === "dat" ? parseDat(file.bytes.toString("utf8")) : await readSpreadsheet(file);
    return toCanonicalTable(raw, profile.mapping);
  },
  validate: async (rows, _user, params) => (await checkLogRows(rows, params.deviceId)).problems,
  commit: (rows, tx, _user, params, batchId) => commitLogRows(rows, tx, params.deviceId, batchId ?? null),
  onCommitted: () => revalidatePath("/attendance", "layout"),
});

export type ImportHistoryRow = { id: string; fileName: string; status: "invalid" | "ready" | "committed"; rowCount: number; result: Record<string, number> | null; createdAt: Date; committedAt: Date | null; byName: string; deviceId: string | null };

/** Uploads of device logs the viewer may see: those of devices in their reach. */
export async function listImportHistory(principal: Principal, limit = 30): Promise<ImportHistoryRow[]> {
  const devices = new Set((await listDevices(principal)).map((device) => device.id));
  const rows = await db()
    .select({ batch: schema.importBatch, byName: schema.person.fullName })
    .from(schema.importBatch)
    .innerJoin(schema.person, eq(schema.person.id, schema.importBatch.createdByPersonId))
    .where(eq(schema.importBatch.kind, DEVICE_IMPORT_KIND))
    .orderBy(desc(schema.importBatch.createdAt))
    .limit(200);
  return rows
    .map(({ batch, byName }) => ({ id: batch.id, fileName: batch.fileName, status: batch.status, rowCount: batch.rowCount, result: batch.result as Record<string, number> | null, createdAt: batch.createdAt, committedAt: batch.committedAt, byName, deviceId: (batch.params as Params | null)?.deviceId ?? null }))
    .filter((row) => row.deviceId !== null && devices.has(row.deviceId))
    .slice(0, limit);
}

/** Every waiting line of a device, for the downloadable error report. */
export async function listUnmappedLines(deviceId: string, limit = 5000) {
  return db().select({ deviceUserId: schema.deviceUnmappedLog.deviceUserId, at: schema.deviceUnmappedLog.at, direction: schema.deviceUnmappedLog.direction }).from(schema.deviceUnmappedLog).where(eq(schema.deviceUnmappedLog.deviceId, deviceId)).orderBy(asc(schema.deviceUnmappedLog.deviceUserId), asc(schema.deviceUnmappedLog.at)).limit(limit);
}
