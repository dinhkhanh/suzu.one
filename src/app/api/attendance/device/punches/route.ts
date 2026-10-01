import { receivePunches } from "@/modules/attendance/device-push";

// A clock posting its own punches (src/modules/attendance/device-push.ts). The proxy lets this
// path through on the app's domain only (src/lib/site-routing.ts); the device token is the check.
export function POST(request: Request) {
  return receivePunches(request);
}
