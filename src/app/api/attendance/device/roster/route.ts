import { sendRoster } from "@/modules/attendance/device-push";

// Who a clock should know, for its enrolment list (src/modules/attendance/device-push.ts).
export function GET(request: Request) {
  return sendRoster(request);
}
