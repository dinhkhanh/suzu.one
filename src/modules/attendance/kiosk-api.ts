// The endpoints a kiosk tablet calls (`kiosk.ts`). Nobody is signed in on the tablet: it presents
// the kiosk token in its cookie, and is refused without an open kiosk behind it. `createAction()`
// cannot serve these — there is no user — so the steps are written out in the same order:
// parse → authenticate → run → audit.
//
//   POST /api/kiosk/identify {"embedding":[…128]}              → {"person":{"personId","name","next","recentAt","recentDirection"}|null}
//   POST /api/kiosk/punch    {"personId","embedding":[…128]}   → {"punchId","at","name","repeat","direction"}
//
// `next` and `direction` say whether the punch arrives or leaves ("in" / "out"), from the person's
// own punches of every source (`nextKioskDirection`), so the screen greets or says goodbye.
//   POST /api/kiosk/undo     {"punchId"}                       → {"cancelled":true|false}
//   GET  /api/kiosk/qr                                          → {"now","codes":[{"window","url"}…]} — five minutes of
//                                                                 QR codes at once; the tablet draws them in turn
//
// Every answer to a closed or unknown kiosk is a 401, and the screen says the kiosk is closed.
import "server-only";
import { z } from "zod";
import { reportError } from "@/lib/observability/report";
import { recordAudit } from "@/modules/platform/audit/service";
import { clientIpFrom } from "@/modules/platform/auth/client-ip";
import { commitKioskPunch, nextKioskDirection, recentKioskPunches, withdrawKioskPunch } from "./devices";
import { EMBEDDING_SIZE } from "./engine/face";
import { recogniseFace } from "./faces";
import { type Kiosk, kioskOfToken, kioskQrCodes, kioskTokenOf } from "./kiosk";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

/** Within this long of a punch, the same face sees that punch again instead of making another. */
export const KIOSK_COOLDOWN_MS = 60_000;

const embedding = z.array(z.number().finite()).length(EMBEDDING_SIZE);
const identifyBody = z.object({ embedding });
const punchBody = z.object({ personId: z.uuid(), embedding });
const undoBody = z.object({ punchId: z.uuid() });

async function read<Schema extends z.ZodType>(request: Request, body: Schema): Promise<z.output<Schema> | null> {
  try {
    const parsed = body.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function authenticate(request: Request): Promise<Kiosk | null> {
  return kioskOfToken(kioskTokenOf(request));
}

const audit = (kiosk: Kiosk, request: Request, action: string, summary: string, after: unknown) =>
  recordAudit({ action, resource: { type: "attendance_device", id: kiosk.device.id, entityId: kiosk.device.entityId }, summary, after, request: { ipAddress: clientIpFrom(request.headers), userAgent: request.headers.get("user-agent") } });

async function guarded(request: Request, path: string, run: (kiosk: Kiosk) => Promise<Response>): Promise<Response> {
  const kiosk = await authenticate(request);
  if (!kiosk) return json({ error: "unauthorized" }, 401);
  try {
    return await run(kiosk);
  } catch (error) {
    await reportError(error, { event: "attendance.kiosk.failed", source: "kiosk", request: { method: request.method, path } });
    return json({ error: "failed" }, 500);
  }
}

export function identify(request: Request): Promise<Response> {
  return guarded(request, "/api/kiosk/identify", async (kiosk) => {
    const body = await read(request, identifyBody);
    if (!body) return json({ error: "invalid" }, 400);
    const found = await recogniseFace(body.embedding, kiosk.entityIds);
    if (!found) return json({ person: null });
    const [recent, next] = await Promise.all([recentKioskPunches(kiosk.device.id, [found.personId], new Date(Date.now() - KIOSK_COOLDOWN_MS)), nextKioskDirection(found.personId)]);
    const last = recent.get(found.personId);
    return json({ person: { personId: found.personId, name: found.name, next, recentAt: last?.at.toISOString() ?? null, recentDirection: last?.direction ?? null } });
  });
}

export function punch(request: Request): Promise<Response> {
  return guarded(request, "/api/kiosk/punch", async (kiosk) => {
    const body = await read(request, punchBody);
    if (!body) return json({ error: "invalid" }, 400);
    // The face is named again here: the screen's word for who it is counts for nothing on its own.
    const found = await recogniseFace(body.embedding, kiosk.entityIds);
    if (!found || found.personId !== body.personId) return json({ error: "not_recognised" }, 409);
    const recent = (await recentKioskPunches(kiosk.device.id, [found.personId], new Date(Date.now() - KIOSK_COOLDOWN_MS))).get(found.personId);
    if (recent) return json({ punchId: null, at: recent.at.toISOString(), name: found.name, repeat: true, direction: recent.direction });
    const made = await commitKioskPunch(kiosk.device.id, { personId: found.personId, entityId: found.entityId }, "face");
    await audit(kiosk, request, "attendance.kiosk.punch", `${kiosk.device.name}: ${found.name} checked ${made.direction} by face`, { personId: found.personId, punchId: made.punchId, direction: made.direction, score: Math.round(found.score * 1000) / 1000, kioskSessionId: kiosk.session.id });
    return json({ punchId: made.punchId, at: made.at.toISOString(), name: found.name, repeat: false, direction: made.direction });
  });
}

export function undo(request: Request): Promise<Response> {
  return guarded(request, "/api/kiosk/undo", async (kiosk) => {
    const body = await read(request, undoBody);
    if (!body) return json({ error: "invalid" }, 400);
    const removed = await withdrawKioskPunch(kiosk.device.id, body.punchId);
    if (removed) await audit(kiosk, request, "attendance.kiosk.punch_withdrawn", `${kiosk.device.name}: "Not me" — a face punch taken back`, { personId: removed.personId, punchId: body.punchId, at: removed.at.toISOString(), kioskSessionId: kiosk.session.id });
    return json({ cancelled: !!removed });
  });
}

export function qr(request: Request): Promise<Response> {
  return guarded(request, "/api/kiosk/qr", async (kiosk) => {
    // The server's clock rides along: the tablet shows each code in the server's window, not its own.
    const now = Date.now();
    return json({ now, codes: kioskQrCodes(kiosk.session, now) });
  });
}
