import { qr } from "@/modules/attendance/kiosk-api";

// The kiosk's QR code, and its heartbeat (src/modules/attendance/kiosk-api.ts). The proxy lets
// this path through on the app's domain only (src/lib/site-routing.ts); the cookie is the check.
export function GET(request: Request) {
  return qr(request);
}
