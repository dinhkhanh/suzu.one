import { MessageSquareIcon, PlusIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { List, ListEmpty, ListItem } from "@/components/ui/list";
import { Page, PageHeader } from "@/components/ui/page";
import { canAskAssistant, canReadUnansweredLog, getConversation, listConversations } from "@/modules/ai/service";
import { AssistantChat } from "@/modules/ai/ui/chat";
import { notFound } from "next/navigation";
import { requireUser } from "@/modules/platform/auth/session";
import { pageTitle } from "@/i18n/page-title";

export const generateMetadata = pageTitle("askSuZu");

// The ask action runs on this page's function: an agent turn may take up to 40 seconds (FR-AGT-42),
// and the free path after it a little more.
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AssistantPage(props: PageProps<"/assistant">) {
  const user = await requireUser();
  if (!canAskAssistant(user.principal)) notFound();
  const params = await props.searchParams;
  const wanted = typeof params.c === "string" && UUID.test(params.c) ? params.c : null;
  // `getConversation` matches on the asker as well as the id: somebody else's link opens nothing.
  const [t, conversation, recent] = await Promise.all([getTranslations("assistant"), wanted ? getConversation(user.person.id, wanted) : Promise.resolve(null), listConversations(user.person.id, 8)]);
  const keeper = canReadUnansweredLog(user.principal);

  return (
    <Page width="wide" className="min-h-full">
      <PageHeader
        title={t("title")}
        description={t("intro")}
        actions={
          <>
            {keeper ? (
              <Link href="/assistant/unanswered" className={buttonVariants({ variant: "outline" })}>
                {t("unanswered.link")}
              </Link>
            ) : null}
            {conversation ? (
              <Link href="/assistant" className={buttonVariants()}>
                <PlusIcon data-icon="inline-start" />
                {t("newChat")}
              </Link>
            ) : null}
          </>
        }
      />

      <div className="grid min-w-0 gap-6 md:grid-cols-[248px_minmax(0,1fr)] md:gap-10">
        {/* The history: a tree-like list down the left on a desk, under the thread on a phone. */}
        <aside className="order-2 min-w-0 md:order-1 md:self-start">
          <p className="section-label mb-2 px-0.5">{t("history")}</p>
          <List>
            {recent.length === 0 ? <ListEmpty className="min-h-14">{t("noHistory")}</ListEmpty> : null}
            {recent.map((row) => (
              <ListItem key={row.id} href={`/assistant?c=${row.id}`} data-state={row.id === conversation?.id ? "selected" : undefined} className="min-h-10 py-1.5 md:min-h-9 md:px-3">
                <MessageSquareIcon aria-hidden className={`size-3.5 shrink-0 ${row.id === conversation?.id ? "text-primary" : "text-faint"}`} />
                <span className={`min-w-0 flex-1 truncate text-[0.8125rem] ${row.id === conversation?.id ? "font-medium text-primary" : ""}`}>{row.title}</span>
              </ListItem>
            ))}
          </List>
        </aside>

        <div className="order-1 min-w-0 max-w-3xl md:order-2">
          <AssistantChat
            // A new instance per conversation: the chat keeps its turns in state, so opening another
            // conversation (or "New chat") without a remount would keep showing the old one.
            key={conversation?.id ?? "new"}
            conversationId={conversation?.id ?? null}
            turns={(conversation?.turns ?? []).map((turn) => ({ id: turn.id, role: turn.role, body: turn.body, outcome: turn.outcome, citations: turn.citations, tool: turn.tool }))}
            suggestions={[t("suggestions.leave"), t("suggestions.payday"), t("suggestions.balance"), t("suggestions.approver")]}
          />
        </div>
      </div>
    </Page>
  );
}
