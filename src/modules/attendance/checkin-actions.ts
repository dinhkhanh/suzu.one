"use server";
// Check-in / check-out, the review of flagged check-ins, and work locations.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAction } from "@/lib/action";
import { getPersonTarget } from "@/modules/core-hr/service";
import { getLocation, saveLocation } from "./locations";
import { canManageLocation, canReviewPunchOf } from "./policy";
import { getPunch, recordAppPunch, reviewPunch } from "./punches";

const blankToNull = (value: unknown) => (typeof value === "string" && value.trim() === "" ? null : value);
const optional = <Schema extends z.ZodType>(schema: Schema) => z.preprocess(blankToNull, schema.nullable().default(null));
const checkbox = z.preprocess((value) => value === "on" || value === true, z.boolean());

// ── The punch ───────────────────────────────────────────────────────────────────────────────

const punchPipeline = createAction({
  name: "attendance.punch",
  input: z.object({
    direction: z.enum(["in", "out"]),
    // What the browser's Geolocation API returned; null when the person refused or the phone could not tell.
    // There is deliberately no time field: the server's clock is the only clock.
    position: z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180), accuracyM: z.number().min(0).max(1_000_000) }).nullable().default(null),
    deviceInfo: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).nullable().default(null),
    note: optional(z.string().trim().max(300)),
  }),
  // One's own punch needs no permission; the service refuses people who are not employed.
  authorize: () => true,
  run: async ({ user, input }) => {
    const result = await recordAppPunch({ person: user.person, direction: input.direction, position: input.position, ipAddress: user.request.ipAddress, userAgent: user.request.userAgent, deviceInfo: input.deviceInfo, note: input.note });
    revalidatePath("/attendance", "layout");
    return {
      data: { id: result.punch.id, at: result.punch.at.toISOString(), direction: result.punch.direction, outcome: result.outcome, flags: result.flags, locationName: result.locationName, distanceM: result.punch.distanceM, duplicate: result.duplicate },
      // Where exactly stays on the punch row (personal tier); the audit log keeps the verdict.
      audit: { resource: { type: "punch", id: result.punch.id, entityId: result.punch.entityId }, summary: `${result.punch.direction} ${result.outcome}${result.flags.length ? `: ${result.flags.join(", ")}` : ""}${result.duplicate ? " (repeat)" : ""}` },
    };
  },
});
export async function punchAction(input: unknown) {
  return punchPipeline(input);
}

const reviewPipeline = createAction({
  name: "attendance.punch.review",
  input: z.object({ id: z.uuid(), decision: z.enum(["accept", "reject"]), note: optional(z.string().trim().max(500)) }),
  authorize: async (user, input) => {
    const row = await getPunch(input.id);
    const target = row ? await getPersonTarget(row.personId) : null;
    return !!target && canReviewPunchOf(user.principal, target);
  },
  run: async ({ user, input }) => {
    const { before, after } = await reviewPunch(input.id, user.person.id, { decision: input.decision, note: input.note });
    revalidatePath("/attendance", "layout");
    return { data: { id: after.id, reviewStatus: after.reviewStatus }, audit: { resource: { type: "punch", id: after.id, entityId: after.entityId }, summary: `${after.reviewStatus}: ${after.flags.join(", ")}`, before: { reviewStatus: before.reviewStatus }, after: { reviewStatus: after.reviewStatus, reviewNote: after.reviewNote } } };
  },
});
export async function reviewPunchAction(input: unknown) {
  return reviewPipeline(input);
}

// ── Work locations ──────────────────────────────────────────────────────────────────────────

const coordinate = (limit: number) => optional(z.coerce.number().min(-limit).max(limit));

const saveLocationPipeline = createAction({
  name: "attendance.location.save",
  input: z.object({
    id: optional(z.uuid()),
    entityId: z.uuid(),
    name: z.string().trim().min(1).max(120),
    address: optional(z.string().trim().max(300)),
    latitude: coordinate(90),
    longitude: coordinate(180),
    radiusM: optional(z.coerce.number().int().min(10).max(50_000)),
    accuracyLimitM: z.coerce.number().int().min(10).max(5_000).default(100),
    // One block per line or comma: "203.0.113.0/24".
    ipAllowlist: z.preprocess((value) => (typeof value === "string" ? value.split(/[\s,;]+/).filter(Boolean) : value), z.array(z.string().max(60)).max(50).default([])),
    rule: z.enum(["gps_or_ip", "gps", "ip", "gps_and_ip"]),
    mode: z.enum(["flag", "block"]),
    isActive: checkbox,
  }),
  authorize: async (user, input) => {
    const existing = input.id ? await getLocation(input.id) : null;
    if (input.id && !existing) return false;
    return canManageLocation(user.principal, existing?.entityId ?? input.entityId) && canManageLocation(user.principal, input.entityId);
  },
  run: async ({ input }) => {
    const { before, after } = await saveLocation(input);
    revalidatePath("/attendance", "layout");
    const facts = (row: typeof after) => ({ name: row.name, latitude: row.latitude, longitude: row.longitude, radiusM: row.radiusM, accuracyLimitM: row.accuracyLimitM, ipAllowlist: row.ipAllowlist, rule: row.rule, mode: row.mode, isActive: row.isActive });
    return { data: { id: after.id }, audit: { resource: { type: "work_location", id: after.id, entityId: after.entityId }, summary: after.name, before: before ? facts(before) : null, after: facts(after) } };
  },
});
export async function saveLocationAction(input: unknown) {
  return saveLocationPipeline(input);
}
