"use server";
// The face kiosk (FR-ATT-06): opening and closing a kiosk on a wall tablet, enrolling faces, and a
// phone checking in with the kiosk's QR code. Opening, closing and enrolling are for whoever holds
// `attendance:kiosk` over the clock or the person; checking in by QR code is everybody's, for
// themselves, at a kiosk serving their entity.
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ActionError, createAction } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { getPersonTarget } from "@/modules/core-hr/service";
import { invalidateSession } from "@/modules/platform/auth/session-cache";
import { eq } from "drizzle-orm";
import { commitKioskPunch, getDevice, recentKioskPunches } from "./devices";
import { EMBEDDING_SIZE } from "./engine/face";
import { deleteFaces, enrolFaces } from "./faces";
import { closeKioskSession, getKioskSession, KIOSK_COOKIE, KIOSK_COOKIE_MAX_AGE, kioskOfQrToken, kioskOfToken, openKioskSession } from "./kiosk";
import { KIOSK_COOLDOWN_MS } from "./kiosk-api";
import { canEnrolFaceOf, canOpenKiosk } from "./policy";

const refresh = () => revalidatePath("/attendance/kiosk", "layout");
// Better Auth's session cookie, over HTTP on a laptop and HTTPS everywhere else.
const AUTH_COOKIES = ["better-auth.session_token", "__Secure-better-auth.session_token"];

// ── Opening and closing ─────────────────────────────────────────────────────────────────────

/**
 * Turns this browser into the clock's kiosk and signs its user out of it, in one step: the kiosk
 * token goes into a cookie, and the session that asked is deleted. Not while seeing the app as
 * somebody else: the kiosk would be opened in their name.
 */
const openPipeline = createAction({
  name: "attendance.kiosk.open",
  input: z.object({ deviceId: z.uuid() }),
  authorize: async (user, input) => {
    const device = await getDevice(input.deviceId);
    return !user.impersonator && !!device && device.isActive && canOpenKiosk(user.principal, device.entityId);
  },
  run: async ({ user, input }) => {
    const device = (await getDevice(input.deviceId))!;
    const { token, session } = await openKioskSession({ device, openedByPersonId: user.person.id, userAgent: user.request.userAgent });
    const jar = await cookies();
    jar.set(KIOSK_COOKIE, token, { path: "/", httpOnly: true, sameSite: "strict", secure: true, maxAge: KIOSK_COOKIE_MAX_AGE });
    await db().delete(schema.session).where(eq(schema.session.id, user.sessionId));
    await invalidateSession(user.sessionId).catch(() => undefined);
    for (const name of AUTH_COOKIES) jar.delete(name);
    // No revalidation: it would render this page again for a browser that is no longer signed in.
    // The browser goes to /kiosk next, and the kiosk page is dynamic for everyone else.
    return { data: { sessionId: session.id }, audit: { resource: { type: "attendance_device", id: device.id, entityId: device.entityId }, summary: `${device.name}: kiosk opened on a tablet; its user signed out there`, after: { kioskSessionId: session.id, userAgent: session.userAgent } } };
  },
});
export async function openKioskAction(input: unknown) {
  return openPipeline(input);
}

const closePipeline = createAction({
  name: "attendance.kiosk.close",
  input: z.object({ sessionId: z.uuid() }),
  authorize: async (user, input) => {
    const session = await getKioskSession(input.sessionId);
    return !!session && canOpenKiosk(user.principal, session.entityId);
  },
  run: async ({ user, input }) => {
    const session = await closeKioskSession(input.sessionId, user.person.id);
    // Closed on the tablet itself (HR signed in there to close it): the cookie goes too.
    const jar = await cookies();
    const here = await kioskOfToken(jar.get(KIOSK_COOKIE)?.value);
    if (!here || here.session.id === session.id) jar.delete(KIOSK_COOKIE);
    refresh();
    return { data: { id: session.id }, audit: { resource: { type: "attendance_device", id: session.deviceId, entityId: session.entityId }, summary: "kiosk closed", before: { kioskSessionId: session.id, openedAt: session.openedAt.toISOString(), openedByPersonId: session.openedByPersonId } } };
  },
});
export async function closeKioskAction(input: unknown) {
  return closePipeline(input);
}

// ── Faces ───────────────────────────────────────────────────────────────────────────────────

const embedding = z.array(z.number().finite()).length(EMBEDDING_SIZE);

const personInReach = async (user: { principal: Parameters<typeof canEnrolFaceOf>[0] }, personId: string) => {
  const target = await getPersonTarget(personId);
  return !!target && canEnrolFaceOf(user.principal, target);
};

// The audit entry says what happened, never the numbers: a face's embedding is biometric data too.
const enrolPipeline = createAction({
  name: "attendance.face.enrol",
  input: z.object({ personId: z.uuid(), embeddings: z.array(embedding).min(1).max(10), consent: z.boolean() }),
  authorize: (user, input) => personInReach(user, input.personId),
  run: async ({ user, input }) => {
    const [person] = await db().select({ entityId: schema.person.primaryEntityId, status: schema.person.status }).from(schema.person).where(eq(schema.person.id, input.personId)).limit(1);
    if (!person || person.status === "offboarded") throw new ActionError("not_found");
    const result = await enrolFaces({ personId: input.personId, entityId: person.entityId, embeddings: input.embeddings, consent: input.consent, actorPersonId: user.person.id });
    refresh();
    return { data: result, audit: { resource: { type: "face_enrolment", id: input.personId, entityId: person.entityId }, summary: `${result.added} face templates added (${result.total} kept)${input.consent ? "; signed consent recorded" : ""}`, after: { added: result.added, total: result.total, consentRecorded: result.consentRecorded } } };
  },
});
export async function enrolFaceAction(input: unknown) {
  return enrolPipeline(input);
}

const deletePipeline = createAction({
  name: "attendance.face.delete",
  input: z.object({ personId: z.uuid() }),
  authorize: (user, input) => personInReach(user, input.personId),
  run: async ({ input }) => {
    const target = await getPersonTarget(input.personId);
    const deleted = await deleteFaces(input.personId);
    refresh();
    return { data: { deleted }, audit: { resource: { type: "face_enrolment", id: input.personId, entityId: target?.entityId ?? null }, summary: `face data deleted (${deleted} templates) with the consent record`, before: { templates: deleted } } };
  },
});
export async function deleteFacesAction(input: unknown) {
  return deletePipeline(input);
}

// ── Checking in with the kiosk's QR code ────────────────────────────────────────────────────

/**
 * The person scanned the kiosk's code with their own phone, signed in. The code must be fresh and
 * the kiosk must serve their entity; the punch is theirs only — never while seeing the app as
 * somebody else.
 */
const qrPunchPipeline = createAction({
  name: "attendance.kiosk.qr_punch",
  input: z.object({ token: z.string().min(10).max(200) }),
  authorize: (user) => !user.impersonator,
  run: async ({ user, input }) => {
    const kiosk = await kioskOfQrToken(input.token);
    if (!kiosk) throw new ActionError("kiosk_code_expired");
    const person = user.person;
    if (person.status !== "active" || !person.primaryEntityId || !kiosk.entityIds.includes(person.primaryEntityId)) throw new ActionError("kiosk_not_yours");
    const recent = (await recentKioskPunches(kiosk.device.id, [person.id], new Date(Date.now() - KIOSK_COOLDOWN_MS))).get(person.id);
    if (recent) return { data: { at: recent.at.toISOString(), repeat: true, direction: recent.direction, device: kiosk.device.name }, audit: { resource: { type: "attendance_device", id: kiosk.device.id, entityId: kiosk.device.entityId }, summary: `${kiosk.device.name}: QR punch repeated within the minute; nothing new` } };
    const made = await commitKioskPunch(kiosk.device.id, { personId: person.id, entityId: person.primaryEntityId }, "qr");
    return { data: { at: made.at.toISOString(), repeat: false, direction: made.direction, device: kiosk.device.name }, audit: { resource: { type: "attendance_device", id: kiosk.device.id, entityId: kiosk.device.entityId }, summary: `${kiosk.device.name}: checked ${made.direction} with the kiosk's QR code`, after: { punchId: made.punchId, direction: made.direction, kioskSessionId: kiosk.session.id } } };
  },
});
export async function kioskQrPunchAction(input: unknown) {
  return qrPunchPipeline(input);
}
