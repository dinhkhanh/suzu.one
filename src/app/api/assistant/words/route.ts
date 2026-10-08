import { isLocale } from "@/i18n/config";
import { LAZY_NAMESPACES } from "@/i18n/route-namespaces.generated";
import { pickMessages } from "@/i18n/surfaces";
import { getCurrentUser } from "@/modules/platform/auth/session";
import en from "../../../../../messages/en.json";
import vi from "../../../../../messages/vi.json";

// The words of the assistant's sheet, fetched when it first opens (Phase 13 R5): the shell does not
// carry them on every page (PERF-01, `LAZY_SURFACES` in scripts/i18n-route-namespaces.ts). Which
// namespaces they are is read off the sheet's code; the language is the one the page is shown in.
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "unauthenticated" }, { status: 401 });
  const asked = new URL(request.url).searchParams.get("locale") ?? undefined;
  const words = pickMessages((isLocale(asked) && asked === "en" ? en : vi) as Record<string, unknown>, LAZY_NAMESPACES.assistantSheet);
  // The same for everybody in one language and one deploy: the browser may keep it for the session.
  return Response.json(words, { headers: { "Cache-Control": "private, max-age=3600" } });
}
