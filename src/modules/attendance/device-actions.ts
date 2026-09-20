"use server";
// Time clocks, their logs, the attendance policy and the on-demand recompute. All HR's
// (`attendance:manage`), checked against the entity the thing belongs to.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { getPersonTarget } from "@/modules/core-hr/service";
import { type CsvFile, EXPORT_ROW_LIMIT, toCsv } from "@/modules/platform/export/csv";
import { can } from "@/modules/platform/rbac/policy";
import { savePolicy } from "./attendance-policies";
import { bulkMapByEmployeeCode, deviceLogImport, getDevice, getProfile, getUserMapRow, listUnmappedLines, mapDeviceUser, saveDevice, saveProfile, unmapDeviceUser } from "./devices";
import { canManageAttendanceConfig, canManageDevices } from "./policy";
import { recomputeOpenMonths, requestScopeRecompute } from "./recompute";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const refresh = () => revalidatePath("/attendance", "layout");

// ── Mapping profiles ────────────────────────────────────────────────────────────────────────

const position = z.preprocess(blankToNull, z.coerce.number().int().min(1).max(50).nullable().default(null));
const header = optional(z.string().trim().max(80));
// "0=in, 1=out, C/In=in"
const directionCodes = z
  .string()
  .max(400)
  .transform((value, context) => {
    const codes: Record<string, "in" | "out"> = {};
    for (const part of value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean)) {
      const [code, direction] = part.split("=").map((item) => item.trim());
      if (!code || (direction !== "in" && direction !== "out")) {
        context.addIssue({ code: "custom", message: "bad_direction_codes" });
        return z.NEVER;
      }
      codes[code] = direction;
    }
    return codes;
  });

const saveProfilePipeline = createAction({
  name: "attendance.device_profile.save",
  input: z.object({
    id: optional(z.uuid()), entityId: optional(z.uuid()), name: z.string().trim().min(1).max(120), deviceModel: optional(z.string().trim().max(120)), fileKind: z.enum(["csv", "xlsx", "dat"]), hasHeader: checkbox,
    userIdHeader: header, userIdPosition: position, timestampHeader: header, timestampPosition: position, timeHeader: header, timePosition: position, directionHeader: header, directionPosition: position,
    timestampFormat: z.string().trim().min(8).max(40), directionCodes, inferDirection: checkbox, isActive: checkbox,
  }),
  authorize: async (user, input) => {
    const existing = input.id ? await getProfile(input.id) : null;
    if (input.id && !existing) return false;
    return canManageAttendanceConfig(user.principal, existing ? existing.entityId : input.entityId);
  },
  run: async ({ input }) => {
    const ref = (name: string | null, place: number | null) => ({ ...(name ? { header: name } : {}), ...(place ? { position: place } : {}) });
    const hasRef = (name: string | null, place: number | null) => !!name || !!place;
    const mapping = {
      hasHeader: input.hasHeader, userId: ref(input.userIdHeader, input.userIdPosition), timestamp: ref(input.timestampHeader, input.timestampPosition),
      ...(hasRef(input.timeHeader, input.timePosition) ? { time: ref(input.timeHeader, input.timePosition) } : {}), ...(hasRef(input.directionHeader, input.directionPosition) ? { direction: ref(input.directionHeader, input.directionPosition) } : {}),
      timestampFormat: input.timestampFormat, directionCodes: input.directionCodes, inferDirection: input.inferDirection,
    };
    const { before, after } = await saveProfile({ id: input.id, entityId: input.entityId, name: input.name, deviceModel: input.deviceModel, fileKind: input.fileKind, mapping, isActive: input.isActive });
    refresh();
    const facts = (row: typeof after) => ({ name: row.name, deviceModel: row.deviceModel, fileKind: row.fileKind, mapping: row.mapping, isActive: row.isActive });
    return { data: { id: after.id }, audit: { resource: { type: "device_mapping_profile", id: after.id, entityId: after.entityId }, summary: after.name, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function saveProfileAction(input: unknown) {
  return saveProfilePipeline(input);
}

// ── Devices and the ID map ──────────────────────────────────────────────────────────────────

const saveDevicePipeline = createAction({
  name: "attendance.device.save",
  input: z.object({ id: optional(z.uuid()), entityId: z.uuid(), name: z.string().trim().min(1).max(120), model: optional(z.string().trim().max(120)), serialNumber: optional(z.string().trim().max(80)), locationId: optional(z.uuid()), profileId: z.uuid(), isActive: checkbox }),
  authorize: async (user, input) => {
    const existing = input.id ? await getDevice(input.id) : null;
    if (input.id && !existing) return false;
    return canManageDevices(user.principal, existing ? existing.entityId : input.entityId);
  },
  run: async ({ input }) => {
    const { before, after } = await saveDevice(input);
    refresh();
    const facts = (row: typeof after) => ({ name: row.name, model: row.model, serialNumber: row.serialNumber, locationId: row.locationId, profileId: row.profileId, isActive: row.isActive });
    return { data: { id: after.id }, audit: { resource: { type: "attendance_device", id: after.id, entityId: after.entityId }, summary: after.name, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function saveDeviceAction(input: unknown) {
  return saveDevicePipeline(input);
}

const deviceInReach = async (user: { principal: Parameters<typeof canManageDevices>[0] }, deviceId: string) => {
  const device = await getDevice(deviceId);
  return device && canManageDevices(user.principal, device.entityId) ? device : null;
};

const mapUserPipeline = createAction({
  name: "attendance.device_user.map",
  input: z.object({ deviceId: z.uuid(), deviceUserId: z.string().trim().min(1).max(40), personId: z.uuid() }),
  // The clock is HR's, and so must the person be: mapping an ID writes that person's punches.
  authorize: async (user, input) => {
    const target = await getPersonTarget(input.personId);
    return !!(await deviceInReach(user, input.deviceId)) && !!target && can(user.principal, "attendance:manage", target);
  },
  run: async ({ user, input }) => {
    const device = (await getDevice(input.deviceId))!;
    const { resolved } = await mapDeviceUser(input.deviceId, input.deviceUserId, input.personId, user.person.id);
    refresh();
    return { data: { resolved }, audit: { resource: { type: "attendance_device", id: device.id, entityId: device.entityId }, summary: `ID ${input.deviceUserId} → person ${input.personId}; ${resolved} waiting lines became punches`, after: { deviceUserId: input.deviceUserId, personId: input.personId, resolved } } };
  },
});
export async function mapDeviceUserAction(input: unknown) {
  return mapUserPipeline(input);
}

const bulkMapPipeline = createAction({
  name: "attendance.device_user.bulk_map",
  input: z.object({ deviceId: z.uuid(), lines: z.string().min(1).max(20_000) }),
  authorize: async (user, input) => !!(await deviceInReach(user, input.deviceId)),
  run: async ({ user, input }) => {
    const device = (await getDevice(input.deviceId))!;
    const result = await bulkMapByEmployeeCode(input.deviceId, input.lines, user.person.id);
    refresh();
    return { data: result, audit: { resource: { type: "attendance_device", id: device.id, entityId: device.entityId }, summary: `${result.mapped} IDs mapped by employee code; ${result.resolved} waiting lines became punches`, after: result } };
  },
});
export async function bulkMapAction(input: unknown) {
  return bulkMapPipeline(input);
}

const unmapPipeline = createAction({
  name: "attendance.device_user.unmap",
  input: z.object({ id: z.uuid() }),
  authorize: async (user, input) => {
    const row = await getUserMapRow(input.id);
    return !!row && !!(await deviceInReach(user, row.deviceId));
  },
  run: async ({ input }) => {
    const row = await unmapDeviceUser(input.id);
    const device = await getDevice(row.deviceId);
    refresh();
    return { data: { id: input.id }, audit: { resource: { type: "attendance_device", id: row.deviceId, entityId: device?.entityId ?? null }, summary: `ID ${row.deviceUserId} unmapped`, before: { deviceUserId: row.deviceUserId, personId: row.personId } } };
  },
});
export async function unmapDeviceUserAction(input: unknown) {
  return unmapPipeline(input);
}

const unmappedExportPipeline = createAction({
  name: "attendance.device.unmapped_export",
  input: z.object({ deviceId: z.uuid() }),
  authorize: async (user, input) => !!(await deviceInReach(user, input.deviceId)),
  run: async ({ input }) => {
    const device = (await getDevice(input.deviceId))!;
    const lines = await listUnmappedLines(input.deviceId, EXPORT_ROW_LIMIT + 1);
    const rows = lines.slice(0, EXPORT_ROW_LIMIT);
    const local = (at: Date) => new Date(at.getTime() + 7 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
    const csv = toCsv([{ header: "Thiết bị", value: () => device.name }, { header: "Mã trên máy", value: (row: (typeof rows)[number]) => row.deviceUserId }, { header: "Thời điểm", value: (row) => local(row.at) }, { header: "Chiều", value: (row) => row.direction ?? "" }], rows);
    const file: CsvFile = { fileName: `unmapped-${device.name.replace(/[^\p{L}\p{N}]+/gu, "-")}-${todayInVietnam()}.csv`, csv, rowCount: rows.length, truncated: lines.length > rows.length };
    return { data: file, audit: { resource: { type: "export:device_unmapped", id: device.id, entityId: device.entityId }, summary: `${file.rowCount} rows`, after: { rowCount: file.rowCount } } };
  },
});
export async function exportUnmappedAction(input: unknown) {
  return unmappedExportPipeline(input);
}

export async function stageDeviceLogAction(input: unknown) {
  return deviceLogImport.stage(input);
}
export async function commitDeviceLogAction(input: unknown) {
  return deviceLogImport.commit(input);
}

// ── Policy ──────────────────────────────────────────────────────────────────────────────────

const savePolicyPipeline = createAction({
  name: "attendance.policy.save",
  input: z.object({
    entityId: optional(z.uuid()), validFrom: z.iso.date(), mergeRule: z.enum(["first_in_last_out", "prefer_device", "prefer_app"]), graceLateMinutes: z.coerce.number().int().min(0).max(120), graceEarlyMinutes: z.coerce.number().int().min(0).max(120),
    roundingMinutes: z.coerce.number().int().min(0).max(60), otMinMinutes: z.coerce.number().int().min(0).max(240), otRequiresApproval: checkbox, duplicateWindowMinutes: z.coerce.number().int().min(0).max(30), breakStart: time, dayBoundary: time,
    monthlyCorrectionCap: z.preprocess(blankToNull, z.coerce.number().int().min(0).max(31).nullable().default(null)),
  }),
  authorize: (user, input) => canManageAttendanceConfig(user.principal, input.entityId),
  run: async ({ user, input }) => {
    const { before, after, affectedFrom } = await savePolicy(input, user.person.id);
    await requestScopeRecompute({ entityId: after.entityId }, affectedFrom);
    refresh();
    const facts = (row: typeof after) => ({ validFrom: row.validFrom, validTo: row.validTo, mergeRule: row.mergeRule, graceLateMinutes: row.graceLateMinutes, graceEarlyMinutes: row.graceEarlyMinutes, roundingMinutes: row.roundingMinutes, otMinMinutes: row.otMinMinutes, otRequiresApproval: row.otRequiresApproval, duplicateWindowMinutes: row.duplicateWindowMinutes, breakStart: row.breakStart, dayBoundary: row.dayBoundary, monthlyCorrectionCap: row.monthlyCorrectionCap });
    return { data: { id: after.id }, audit: { resource: { type: "attendance_policy", id: after.id, entityId: after.entityId }, summary: `from ${after.validFrom}: ${after.mergeRule}, grace ${after.graceLateMinutes}/${after.graceEarlyMinutes}`, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function savePolicyAction(input: unknown) {
  return savePolicyPipeline(input);
}

// ── Recompute on demand ─────────────────────────────────────────────────────────────────────

const recomputePipeline = createAction({
  name: "attendance.timesheet.recompute",
  input: z.object({ entityId: z.uuid() }),
  authorize: (user, input) => canManageDevices(user.principal, input.entityId),
  run: async ({ input }) => {
    // Last month and this one; locked months are left alone by the service.
    const result = await recomputeOpenMonths(todayInVietnam(), { entityId: input.entityId });
    if (result.people === 0) throw new ActionError("not_found");
    refresh();
    return { data: result, audit: { resource: { type: "timesheet", entityId: input.entityId }, summary: `${result.people} people, ${result.written} days rewritten, ${result.lockedSkipped} locked days left alone`, after: result } };
  },
});
export async function recomputeTimesheetsAction(input: unknown) {
  return recomputePipeline(input);
}
