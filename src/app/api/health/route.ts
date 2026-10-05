import { databaseReachable } from "@/lib/db/health";

// For an external uptime check (NFR-OPS-03, docs/runbooks/incidents.md): 200 when the app answers
// and reaches its database through the pooler, 503 when it does not. Nobody signs in to it, so it
// says ok or not and nothing else — no version, no host, no error text.
export const dynamic = "force-dynamic";

const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex" };

export async function GET() {
  const ok = await databaseReachable();
  return Response.json({ ok }, { status: ok ? 200 : 503, headers: HEADERS });
}

export async function HEAD() {
  const ok = await databaseReachable();
  return new Response(null, { status: ok ? 200 : 503, headers: HEADERS });
}
