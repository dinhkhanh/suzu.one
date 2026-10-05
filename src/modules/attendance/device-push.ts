// The endpoint a clock calls with its own punches (the face kiosk, tools/face-kiosk). Nobody signs
// in: the clock presents the token HR issued on the device page, as `Authorization: Bearer szd_…`,
// and is refused without it. `createAction()` cannot serve it — there is no user — so the steps
// are written out here in the same order: parse → authenticate → run → audit.
//
//   POST /api/attendance/device/punches  {"punches":[{"userId":"SZM-0004","at":"2026-10-01T08:42:13+07:00"}]}
//        → {"punches":1,"skipped":0,"unmapped":0,"people":1,"refused":[]}
//        An empty list is a heartbeat: the device page shows when the clock last called in.
//   GET  /api/attendance/device/roster   → {"device":"Cửa chính","people":[{"userId":"SZM-0004","fullName":"…","employeeCode":"SZM-0004"}]}
//
// Each call is counted against its clock (`endpoint-limit.ts`): past the limit the answer is a 429
// with `Retry-After`, nothing is read or written, and the clock — which keeps what it could not
// send — tries again.
import "server-only";
import { reportError } from "@/lib/observability/report";
import { recordAudit } from "@/modules/platform/audit/service";
import { commitPushedRows, devicePresentingToken, deviceRoster } from "./devices";
import { countEndpointHit, endpointKey } from "./endpoint-limit";
import { futureRows, pushBodySchema, pushedRows } from "./engine/device-push";
import type { EndpointBucket } from "./engine/rate-limit";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/** The 429 a clock gets past its limit, or null while it is within it. */
async function refusal(bucket: EndpointBucket, deviceId: string): Promise<Response | null> {
  const allowed = await countEndpointHit(bucket, endpointKey("device", deviceId));
  return allowed.ok ? null : json({ error: "rate_limited" }, 429, { "retry-after": String(allowed.retryAfterSeconds) });
}

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token ? devicePresentingToken(token) : null;
}

export async function receivePunches(request: Request): Promise<Response> {
  const device = await authenticate(request);
  if (!device) return json({ error: "unauthorized" }, 401);
  const limited = await refusal("device_punches", device.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid" }, 400);
  }
  const parsed = pushBodySchema.safeParse(body);
  if (!parsed.success) return json({ error: "invalid", issues: parsed.error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code })) }, 400);

  const rows = pushedRows(parsed.data);
  // A clock set to the wrong time is answered, not stored: its owner fixes the clock and resends.
  const refused = new Set(futureRows(rows, new Date()));
  const accepted = rows.filter((row) => !refused.has(row.row));
  try {
    const counts = await commitPushedRows(device.id, accepted);
    if (accepted.length > 0) {
      await recordAudit({
        action: "attendance.device.push",
        resource: { type: "attendance_device", id: device.id, entityId: device.entityId },
        summary: `${device.name}: ${counts.punches} punches, ${counts.skipped} already there, ${counts.unmapped} waiting for an owner`,
        after: { ...counts, refused: refused.size },
      });
    }
    return json({ ...counts, refused: [...refused] });
  } catch (error) {
    await reportError(error, { event: "attendance.device.push.failed", source: "device_push", request: { method: "POST", path: "/api/attendance/device/punches" } });
    // A 5xx: the clock keeps the punches and sends them again.
    return json({ error: "failed" }, 500);
  }
}

export async function sendRoster(request: Request): Promise<Response> {
  const device = await authenticate(request);
  if (!device) return json({ error: "unauthorized" }, 401);
  return (await refusal("device_roster", device.id)) ?? json({ device: device.name, people: await deviceRoster(device.id) });
}
