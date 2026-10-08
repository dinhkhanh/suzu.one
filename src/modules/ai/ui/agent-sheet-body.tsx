"use client";
// The assistant's sheet, once opened (Phase 13 R5). Loaded on demand by `agent-sheet.tsx`, with the
// words it needs fetched beside it: this file is a lazy surface of the shell (`LAZY_SURFACES`).
//
// It asks through `/api/assistant/ask` — the `ai.ask` action on a route of its own, whose time limit
// fits an agent turn — and hands the record on screen along (FR-AGT-02): the path says which, and
// the tool given its id checks again whether the asker may see it.
import { MaximizeIcon, PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { MessagesScope } from "@/i18n/messages-scope";
import { recordAt } from "@/lib/record-routes";
import { PAGE_KINDS, type PageContext } from "../enums";
import { type AskTransport, AssistantChat } from "./chat";

const askThroughRoute: AskTransport = async (input) => {
  try {
    const response = await fetch("/api/assistant/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    if (response.status === 401) return { ok: false, error: "unauthenticated" };
    // A timed-out or failed function answers with a page, not with the action's result.
    if (!response.headers.get("content-type")?.includes("application/json")) return { ok: false, error: "failed", message: "generic" };
    return await response.json();
  } catch {
    return { ok: false, error: "failed", message: "offline" };
  }
};

/** The record a page is about, when it is one the assistant's tools take an id of. */
function pageOf(pathname: string): PageContext | null {
  const found = recordAt(pathname);
  return found && (PAGE_KINDS as readonly string[]).includes(found.kind) ? { kind: found.kind as PageContext["kind"], id: found.id } : null;
}

function SheetChat({ pathname }: { pathname: string }) {
  const t = useTranslations("assistant");
  const [conversation, setConversation] = useState<string | null>(null);
  // A new conversation is a new chat: the old one's turns are not carried into it.
  const [round, setRound] = useState(0);
  const page = pageOf(pathname);
  const suggestions = page ? [t(`sheet.suggest.${page.kind}.first`), t(`sheet.suggest.${page.kind}.second`)] : [t("suggestions.leave"), t("suggestions.balance"), t("suggestions.approver")];

  return (
    <>
      <div className="-mt-1 flex items-center gap-1">
        {/* What "this" means here, so the person knows what the assistant was told. */}
        <p className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground">{page ? t(`sheet.context.${page.kind}`) : t("sheet.noContext")}</p>
        {/* Icons on a phone, with their words on a desk. */}
        {conversation ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={t("newChat")}
            title={t("newChat")}
            onClick={() => {
              setConversation(null);
              setRound((before) => before + 1);
            }}
          >
            <PlusIcon data-icon="inline-start" />
            <span className="max-sm:sr-only">{t("newChat")}</span>
          </Button>
        ) : null}
        <Link href={conversation ? `/assistant?c=${conversation}` : "/assistant"} aria-label={t("sheet.full")} title={t("sheet.full")} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <MaximizeIcon data-icon="inline-start" />
          <span className="max-sm:sr-only">{t("sheet.full")}</span>
        </Link>
      </div>
      <AssistantChat key={round} conversationId={null} turns={[]} suggestions={suggestions} ask={askThroughRoute} page={page} variant="sheet" onConversation={setConversation} />
    </>
  );
}

export function AgentSheetBody({ pathname, onClose }: { pathname: string; onClose: () => void }) {
  const t = useTranslations("assistantSheet");
  const locale = useLocale();
  const [words, setWords] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/assistant/words?locale=${locale}`)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((loaded: Record<string, unknown>) => live && setWords(loaded))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [locale]);

  if (!words) return <p className="py-6 text-sm text-muted-foreground">{failed ? t("failed") : t("loading")}</p>;
  return (
    // A link followed from the sheet opens its page under it: the sheet steps aside. So does Sửa
    // when it opens the palette (`data-sheet-close`).
    <div
      className="flex min-h-0 flex-1 flex-col gap-3"
      onClickCapture={(event) => {
        if ((event.target as Element).closest("a[href], [data-sheet-close]")) onClose();
      }}
    >
      <MessagesScope messages={words}>
        <SheetChat pathname={pathname} />
      </MessagesScope>
    </div>
  );
}
