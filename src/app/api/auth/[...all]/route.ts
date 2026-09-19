import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/modules/platform/auth/auth";

// Resolved per request so the auth instance (and its env validation) is created lazily.
export async function GET(request: Request) {
  return toNextJsHandler(auth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(auth()).POST(request);
}
