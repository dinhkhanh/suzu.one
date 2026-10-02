import { undo } from "@/modules/attendance/kiosk-api";

// A kiosk tablet (src/modules/attendance/kiosk-api.ts). The proxy lets this path through on the
// app's domain only (src/lib/site-routing.ts); the kiosk token in the cookie is the check.
export function POST(request: Request) {
  return undo(request);
}
