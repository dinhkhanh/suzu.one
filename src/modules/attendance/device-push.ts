// The endpoint a clock calls with its own punches (the face kiosk, tools/face-kiosk). Nobody signs
// in: the clock presents the token HR issued on the device page, as `Authorization: Bearer szd_…`,
// and is refused without it. `createAction()` cannot serve it — there is no user — so the steps
// are written out here in the same order: parse → authenticate → run → audit.
//
//   POST /api/attendance/device/punches  {"punches":[{"userId":"SZM-0004","at":"2026-10-01T08:42:13+07:00"}]}
//        → {"punches":1,"skipped":0,"unmapped":0,"people":1,"refused":[]}
//        An empty list is a heartbeat: the device page shows when the clock last called in.
//   GET  /api/attendance/device/roster   → {"device":"Cửa chính","people":[{"userId":"SZM-0004","fullName":"…","employeeCode":"SZM-0004"}]}
import "server-only";
import { reportError } from "@/lib/observability/report";
import { recordAudit } from "@/modules/platform/audit/service";
import { commitPushedRows, devicePresentingToken, deviceRoster } from "./devices";
import { futureRows, pushBodySchema, pushedRows } from "./engine/device-push";

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });

async function authenticate(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return token ? devicePresentingToken(token) : null;
}

export async function receivePunches(request: Request): Promise<Response> {
  const device = await authenticate(request);
  if (!device) return json({ error: "unauthorized" }, 401);

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
  return json({ device: device.name, people: await deviceRoster(device.id) });
}
