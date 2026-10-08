import { askAssistantAction } from "@/modules/ai/actions";

// The assistant's sheet asks here (Phase 13 R5, FR-AGT-01). A server action called from the sheet
// would run on whatever page the sheet is open over, under that page's time limit; an agent turn
// takes up to 40 seconds (FR-AGT-42), so it runs on this one route's function instead, and no
// page's limit is raised for it. It is the same `ai.ask` action as `/assistant`'s: parse,
// authenticate, authorise, run, audit — this file only carries the request to it.
export const maxDuration = 60;

export async function POST(request: Request) {
  // Only the app's own pages post here. The session cookie is SameSite=Lax, so another site's post
  // would carry none anyway; the origin is checked as well.
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host || new URL(origin).host !== host) return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ ok: false, error: "invalid" }, { status: 400 });
  }
  const result = await askAssistantAction(input);
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
