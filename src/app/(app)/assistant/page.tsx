import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { canAskAssistant, canReadUnansweredLog, getConversation, listConversations } from "@/modules/ai/service";
import { AssistantChat } from "@/modules/ai/ui/chat";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("askSuZu");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantPage(props: PageProps<"/assistant">) {
  const user = await requireUser();
  if (!canAskAssistant(user.principal)) notFound();
  const params = await props.searchParams;
  const wanted = typeof params.c === "string" && UUID.test(params.c) ? params.c : null;
  // `getConversation` matches on the asker as well as the id: somebody else's link opens nothing.
  const [t, conversation, recent] = await Promise.all([getTranslations("assistant"), wanted ? getConversation(user.person.id, wanted) : Promise.resolve(null), listConversations(user.person.id, 8)]);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1>{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <nav className="tab-row">
          <Link href="/assistant" className="text-muted-foreground hover:underline">
            {t("newChat")}
          </Link>
          {canReadUnansweredLog(user.principal) ? (
            <Link href="/assistant/unanswered" className="text-muted-foreground hover:underline">
              {t("unanswered.link")}
            </Link>
          ) : null}
        </nav>
      </header>

      <AssistantChat
        // A new instance per conversation: the chat keeps its turns in state, so opening another
        // conversation (or "New chat") without a remount would keep showing the old one.
        key={conversation?.id ?? "new"}
        conversationId={conversation?.id ?? null}
        turns={(conversation?.turns ?? []).map((turn) => ({ id: turn.id, role: turn.role, body: turn.body, outcome: turn.outcome, citations: turn.citations, tool: turn.tool }))}
        suggestions={[t("suggestions.leave"), t("suggestions.payday"), t("suggestions.balance"), t("suggestions.approver")]}
      />

      {recent.length > 0 ? (
        <section className="flex flex-col gap-2 border-t pt-4">
          <h2 className="text-sm font-medium">{t("history")}</h2>
          <ul className="flex flex-col gap-1">
            {recent.map((row) => (
              <li key={row.id}>
                <Link href={`/assistant?c=${row.id}`} className={`text-sm hover:underline ${row.id === conversation?.id ? "font-medium" : "text-muted-foreground"}`}>
                  {row.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
