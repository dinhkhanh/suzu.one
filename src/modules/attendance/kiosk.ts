// Kiosks opened in the app (FR-ATT-06): a wall tablet that HR turns into a check-in kiosk for one
// clock. Whoever opens it holds `attendance:kiosk` over the clock's entity and is signed out on
// that tablet in the same step (`kiosk-actions.ts`), so the wall never holds an HR session. What
// the tablet keeps instead is a kiosk token in a cookie, good for this clock and nothing else: it
// may name the faces it sees among the people the clock serves, punch for them, take back a punch
// a moment old, and show a QR code. It is closed from the kiosk page and stops at its next call.
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { db, schema } from "@/lib/db";
import { appOrigin } from "@/lib/site";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { type DeviceRow, servedEntityIds } from "./devices";
import { isWindowAccepted, parseQrToken, QR_BATCH_WINDOWS, type QrCode, qrPayload, qrToken, qrWindow } from "./engine/kiosk-qr";
import { canOpenKiosk } from "./policy";

export const KIOSK_COOKIE = "suzu_kiosk";
/** A browser keeps a cookie at most 400 days; the kiosk asks for all of them and is closed by hand. */
export const KIOSK_COOKIE_MAX_AGE = 400 * 24 * 3600;
/** The page a phone opens from the kiosk's QR code. */
export const KIOSK_SCAN_PATH = "/attendance/check-in/kiosk";

export type KioskSessionRow = typeof schema.kioskSession.$inferSelect;
export type Kiosk = { session: KioskSessionRow; device: DeviceRow; entityIds: string[] };

// 32 random bytes: looked up by hash, like a clock's push token.
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN_SHAPE = /^szk_[A-Za-z0-9_-]{43}$/;

export async function openKioskSession(input: { device: DeviceRow; openedByPersonId: string; userAgent: string | null }): Promise<{ token: string; session: KioskSessionRow }> {
  const token = `szk_${randomBytes(32).toString("base64url")}`;
  const [session] = await db()
    .insert(schema.kioskSession)
    .values({ deviceId: input.device.id, entityId: input.device.entityId, tokenHash: hashToken(token), qrSecret: randomBytes(32).toString("base64url"), openedByPersonId: input.openedByPersonId, userAgent: input.userAgent?.slice(0, 300) ?? null, lastSeenAt: new Date() })
    .returning();
  return { token, session };
}

export async function closeKioskSession(sessionId: string, byPersonId: string): Promise<KioskSessionRow> {
  const [session] = await db().update(schema.kioskSession).set({ closedAt: new Date(), closedByPersonId: byPersonId }).where(and(eq(schema.kioskSession.id, sessionId), isNull(schema.kioskSession.closedAt))).returning();
  if (!session) throw new ActionError("not_found");
  return session;
}

export const getKioskSession = async (sessionId: string): Promise<KioskSessionRow | null> => (await db().select().from(schema.kioskSession).where(eq(schema.kioskSession.id, sessionId)).limit(1))[0] ?? null;

async function openKiosk(where: ReturnType<typeof eq>): Promise<Kiosk | null> {
  const [row] = await db()
    .select({ session: schema.kioskSession, device: schema.attendanceDevice })
    .from(schema.kioskSession)
    .innerJoin(schema.attendanceDevice, eq(schema.attendanceDevice.id, schema.kioskSession.deviceId))
    .where(and(where, isNull(schema.kioskSession.closedAt), eq(schema.attendanceDevice.isActive, true)))
    .limit(1);
  return row ? { ...row, entityIds: await servedEntityIds(row.device) } : null;
}

/**
 * The open kiosk a tablet's token belongs to, or null. Calling in counts as being seen — written at
 * most once a minute, since a kiosk with a face in front of it calls several times a second.
 */
export async function kioskOfToken(token: string | null | undefined): Promise<Kiosk | null> {
  if (!token || !TOKEN_SHAPE.test(token)) return null;
  const kiosk = await openKiosk(eq(schema.kioskSession.tokenHash, hashToken(token)));
  if (kiosk && (!kiosk.session.lastSeenAt || Date.now() - kiosk.session.lastSeenAt.getTime() > 60_000)) {
    const now = new Date();
    await db()
      .update(schema.kioskSession)
      .set({ lastSeenAt: now })
      .where(and(eq(schema.kioskSession.id, kiosk.session.id), or(isNull(schema.kioskSession.lastSeenAt), lt(schema.kioskSession.lastSeenAt, new Date(now.getTime() - 60_000)))));
  }
  return kiosk;
}

/** The kiosk token a request carries in its cookie. */
export function kioskTokenOf(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === KIOSK_COOKIE) return decodeURIComponent(value.join("="));
  }
  return null;
}

// ── The QR code ─────────────────────────────────────────────────────────────────────────────

const sign = (secret: string, sessionId: string, window: number) => createHmac("sha256", secret).update(qrPayload(sessionId, window)).digest("base64url").slice(0, 22);

const qrUrl = (session: KioskSessionRow, window: number) => `${appOrigin()}${KIOSK_SCAN_PATH}?t=${qrToken(session.id, window, sign(session.qrSecret, session.id, window))}`;

/** The address the kiosk shows as a QR code right now. */
export const kioskQrUrl = (session: KioskSessionRow, now: number = Date.now()): string => qrUrl(session, qrWindow(now));

/** The codes of the current window and the ones after it, for the kiosk to show in turn. */
export function kioskQrCodes(session: KioskSessionRow, now: number = Date.now(), count: number = QR_BATCH_WINDOWS): QrCode[] {
  const first = qrWindow(now);
  return Array.from({ length: count }, (_, index) => ({ window: first + index, url: qrUrl(session, first + index) }));
}

/** The open kiosk a scanned code came from, while the code is fresh; null otherwise. */
export async function kioskOfQrToken(token: string, now: number = Date.now()): Promise<Kiosk | null> {
  const parsed = parseQrToken(token);
  if (!parsed || !isWindowAccepted(parsed.window, now)) return null;
  const kiosk = await openKiosk(eq(schema.kioskSession.id, parsed.sessionId));
  if (!kiosk) return null;
  const expected = Buffer.from(sign(kiosk.session.qrSecret, kiosk.session.id, parsed.window));
  const given = Buffer.from(parsed.signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? kiosk : null;
}

// ── The kiosk page ──────────────────────────────────────────────────────────────────────────

export type KioskDeviceView = {
  id: string;
  name: string;
  entityId: string;
  entityName: string;
  sessions: { id: string; openedAt: Date; openedBy: string; lastSeenAt: Date | null; userAgent: string | null }[];
};

/** The clocks the viewer may open a kiosk for, with the kiosks open on each. */
export async function listKioskDevices(principal: Principal): Promise<KioskDeviceView[]> {
  const reach = entityReach(principal, "attendance:kiosk");
  if (!reach.all && reach.entityIds.length === 0) return [];
  const devices = (
    await db()
      .select({ id: schema.attendanceDevice.id, name: schema.attendanceDevice.name, entityId: schema.attendanceDevice.entityId, entityName: schema.entity.shortName })
      .from(schema.attendanceDevice)
      .innerJoin(schema.entity, eq(schema.entity.id, schema.attendanceDevice.entityId))
      .where(and(eq(schema.attendanceDevice.isActive, true), reach.all ? undefined : inArray(schema.attendanceDevice.entityId, reach.entityIds)))
      .orderBy(asc(schema.entity.shortName), asc(schema.attendanceDevice.name))
  ).filter((device) => canOpenKiosk(principal, device.entityId));
  if (devices.length === 0) return [];
  const sessions = await db()
    .select({ id: schema.kioskSession.id, deviceId: schema.kioskSession.deviceId, openedAt: schema.kioskSession.openedAt, openedBy: schema.person.fullName, lastSeenAt: schema.kioskSession.lastSeenAt, userAgent: schema.kioskSession.userAgent })
    .from(schema.kioskSession)
    .innerJoin(schema.person, eq(schema.person.id, schema.kioskSession.openedByPersonId))
    .where(and(inArray(schema.kioskSession.deviceId, devices.map((device) => device.id)), isNull(schema.kioskSession.closedAt)))
    .orderBy(desc(schema.kioskSession.openedAt));
  return devices.map((device) => ({ ...device, sessions: sessions.filter((session) => session.deviceId === device.id).map((session) => ({ id: session.id, openedAt: session.openedAt, openedBy: session.openedBy, lastSeenAt: session.lastSeenAt, userAgent: session.userAgent })) }));
}
