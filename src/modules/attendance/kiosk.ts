// Kiosks opened in the app (FR-ATT-06): a wall tablet that HR turns into a check-in kiosk for one
// clock. Whoever opens it holds `attendance:kiosk` over the clock's entity and is signed out on
// that tablet in the same step (`kiosk-actions.ts`), so the wall never holds an HR session. What
// the tablet keeps instead is a kiosk token in a cookie, good for this clock and nothing else: it
// may name the faces it sees among the people the clock serves, punch for them, take back a punch
// a moment old, and show a QR code. It is closed from the kiosk page and stops at its next call —
// and it ends by itself (`engine/kiosk-lifetime.ts`): left unused for two weeks, or three months
// after it was opened, whichever comes first. The server decides that on every call, whatever the
// tablet's cookie says; HR then opens the kiosk again on the tablet.
import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { ActionError } from "@/lib/action";
import { todayInVietnam } from "@/lib/dates";
import { db, schema } from "@/lib/db";
import { appOrigin } from "@/lib/site";
import { entityReach, type Principal } from "@/modules/platform/rbac/policy";
import { type DeviceRow, servedEntityIds } from "./devices";
import { KIOSK_IDLE_DAYS, KIOSK_MAX_DAYS, kioskExpiresAt, kioskLapse } from "./engine/kiosk-lifetime";
import { isWindowAccepted, parseQrToken, QR_BATCH_WINDOWS, type QrCode, qrPayload, qrToken, qrWindow } from "./engine/kiosk-qr";
import { canOpenKiosk } from "./policy";

export const KIOSK_COOKIE = "suzu_kiosk";
/**
 * A browser keeps a cookie at most 400 days, and the kiosk asks for all of them: longer, on
 * purpose, than the session behind it lives. The server ends a kiosk, never the cookie — and a
 * tablet that still holds the cookie of a kiosk that has run out can say so, instead of "this is
 * not a kiosk".
 */
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

type Found = { session: KioskSessionRow; device: DeviceRow };

/** The session a condition names, with its clock, whatever state either is in. */
async function findSession(where: ReturnType<typeof eq>): Promise<Found | null> {
  const [row] = await db()
    .select({ session: schema.kioskSession, device: schema.attendanceDevice })
    .from(schema.kioskSession)
    .innerJoin(schema.attendanceDevice, eq(schema.attendanceDevice.id, schema.kioskSession.deviceId))
    .where(where)
    .limit(1);
  return row ?? null;
}

/**
 * Whether a session ended by its lifetime rather than by a person: past it now, or already closed
 * by the nightly job, which puts nobody's name on it (`closeLapsedKioskSessions`).
 */
const hasExpired = ({ session }: Found, now: Date): boolean => (session.closedAt ? !session.closedByPersonId : kioskLapse(session, now) !== null);

/**
 * What a tablet's token is worth now: an open kiosk; one that ran out of time, which the tablet
 * says in so many words; or nothing — unknown, closed by a person, or on a clock no longer in use.
 */
export type KioskAccess = { status: "open"; kiosk: Kiosk } | { status: "expired" } | { status: "none" };

/**
 * The kiosk a tablet's token belongs to, if it is still one. Calling in counts as being seen —
 * which is what keeps a kiosk in use open — written at most once a minute, since a kiosk with a
 * face in front of it calls several times a second.
 */
export async function kioskAccessOfToken(token: string | null | undefined, now: Date = new Date()): Promise<KioskAccess> {
  if (!token || !TOKEN_SHAPE.test(token)) return { status: "none" };
  const found = await findSession(eq(schema.kioskSession.tokenHash, hashToken(token)));
  if (!found || !found.device.isActive) return { status: "none" };
  if (hasExpired(found, now)) return { status: "expired" };
  if (found.session.closedAt) return { status: "none" };
  if (!found.session.lastSeenAt || now.getTime() - found.session.lastSeenAt.getTime() > 60_000) {
    await db()
      .update(schema.kioskSession)
      .set({ lastSeenAt: now })
      .where(and(eq(schema.kioskSession.id, found.session.id), or(isNull(schema.kioskSession.lastSeenAt), lt(schema.kioskSession.lastSeenAt, new Date(now.getTime() - 60_000)))));
  }
  return { status: "open", kiosk: { ...found, entityIds: await servedEntityIds(found.device) } };
}

/** The open kiosk a tablet's token belongs to, or null. */
export async function kioskOfToken(token: string | null | undefined, now: Date = new Date()): Promise<Kiosk | null> {
  const access = await kioskAccessOfToken(token, now);
  return access.status === "open" ? access.kiosk : null;
}

/**
 * The nightly job's part: kiosks past their lifetime are closed, with nobody's name on the
 * closing — which is how a tablet later tells "ran out" from "HR closed it". The conditions are
 * `kioskLapse`'s, said in SQL. Returns how many.
 */
export async function closeLapsedKioskSessions(now: Date = new Date()): Promise<number> {
  const before = (days: number) => new Date(now.getTime() - days * 86_400_000);
  const closed = await db()
    .update(schema.kioskSession)
    .set({ closedAt: now })
    .where(
      and(
        isNull(schema.kioskSession.closedAt),
        or(lte(schema.kioskSession.openedAt, before(KIOSK_MAX_DAYS)), sql`greatest(${schema.kioskSession.lastSeenAt}, ${schema.kioskSession.openedAt}) <= ${before(KIOSK_IDLE_DAYS).toISOString()}::timestamptz`),
      ),
    )
    .returning({ id: schema.kioskSession.id });
  return closed.length;
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
  // A code from a kiosk that was closed, or ran out of time, opens nothing: the rule of the tablet's own calls.
  const found = await findSession(eq(schema.kioskSession.id, parsed.sessionId));
  if (!found || found.session.closedAt || !found.device.isActive || kioskLapse(found.session, new Date(now))) return null;
  const kiosk: Kiosk = { ...found, entityIds: await servedEntityIds(found.device) };
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
  /** `expiresAt`: when it stops unless it is used again. `lapsed`: it already has, and waits for the nightly job. `punchesToday`: what came through it since midnight in Vietnam. */
  sessions: { id: string; openedAt: Date; openedByPersonId: string; openedBy: string; lastSeenAt: Date | null; userAgent: string | null; expiresAt: Date; lapsed: boolean; punchesToday: number }[];
};

/** The clocks the viewer may open a kiosk for, with the kiosks open on each. */
export async function listKioskDevices(principal: Principal, now: Date = new Date()): Promise<KioskDeviceView[]> {
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
  // The day's punches of each session, counted where they are (the punch's partial index on its session).
  const punchesToday = sql<number>`(select count(*)::int from ${schema.punch} where ${schema.punch.kioskSessionId} = ${schema.kioskSession.id} and ${schema.punch.at} >= ${`${todayInVietnam(now)}T00:00:00+07:00`}::timestamptz)`;
  const sessions = await db()
    .select({ id: schema.kioskSession.id, deviceId: schema.kioskSession.deviceId, openedAt: schema.kioskSession.openedAt, openedByPersonId: schema.kioskSession.openedByPersonId, openedBy: schema.person.fullName, lastSeenAt: schema.kioskSession.lastSeenAt, userAgent: schema.kioskSession.userAgent, punchesToday })
    .from(schema.kioskSession)
    .innerJoin(schema.person, eq(schema.person.id, schema.kioskSession.openedByPersonId))
    .where(and(inArray(schema.kioskSession.deviceId, devices.map((device) => device.id)), isNull(schema.kioskSession.closedAt)))
    .orderBy(desc(schema.kioskSession.openedAt));
  return devices.map((device) => ({ ...device, sessions: sessions.filter((session) => session.deviceId === device.id).map((session) => ({ id: session.id, openedAt: session.openedAt, openedByPersonId: session.openedByPersonId, openedBy: session.openedBy, lastSeenAt: session.lastSeenAt, userAgent: session.userAgent, expiresAt: kioskExpiresAt(session), lapsed: kioskLapse(session, now) !== null, punchesToday: Number(session.punchesToday) })) }));
}
