"use client";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { askAssistantAction } from "../actions";
import { type ChatTurn as Turn, QUESTION_MAX } from "../enums";

/** A passage the assistant quoted, with the page it came from. The link re-checks permission. */
function Citations({ turn }: { turn: Turn }) {
  const t = useTranslations("assistant");
  if (turn.citations.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1 border-l-2 border-border pl-3">
      {turn.citations.map((citation, index) => (
        <li key={citation.chunkId} className="text-xs text-muted-foreground">
          <span className="tabular-nums">[{index + 1}]</span>{" "}
          <Link href={`/kb/pages/${citation.pageId}`} className="font-medium hover:underline">
            {citation.pageTitle}
          </Link>
          <span> · {citation.spaceName}</span>
          {citation.headingPath.includes("›") ? <span> · {citation.headingPath.split("›").slice(1).join(" › ").trim()}</span> : null}
        </li>
      ))}
      <li className="pt-1 text-xs text-muted-foreground">{t("mayBeWrong")}</li>
    </ol>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const t = useTranslations("assistant");
  if (turn.role === "user")
    return (
      <li className="self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground sm:max-w-[80%]">{turn.body}</li>
    );
  return (
    <li className="flex flex-col gap-2 sm:max-w-[90%]">
      {turn.outcome === "unanswered" ? (
        <div className="rounded-2xl rounded-bl-sm border border-dashed bg-muted/40 px-3.5 py-2 text-sm text-muted-foreground">
          <p>{t("noAnswer")}</p>
          <p className="mt-1 text-xs">{t("noAnswerLogged")}</p>
        </div>
      ) : (
        <>
          {/* The knowledge base's own words, quoted. Plain text, never markup: nothing a page writes is rendered as anything but text. */}
          <div className="rounded-2xl rounded-bl-sm border bg-card px-3.5 py-2 text-sm whitespace-pre-wrap">{turn.body}</div>
          <Citations turn={turn} />
        </>
      )}
    </li>
  );
}

export function AssistantChat({ conversationId, turns, suggestions }: { conversationId: string | null; turns: Turn[]; suggestions: string[] }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [shown, setShown] = useState<Turn[]>(turns);
  const [conversation, setConversation] = useState(conversationId);

  const form = useActionForm(askAssistantAction, {
    extra: { conversationId: conversation, locale },
    onSuccess: (result) => {
      setConversation(result.conversationId);
      setShown((before) => [...before, { id: `${result.messageId}-q`, role: "user", body: inputRef.current?.defaultValue ?? "", outcome: null, citations: [] }, { id: result.messageId, role: "assistant", body: result.body, outcome: result.outcome, citations: result.citations }]);
      formRef.current?.reset();
      router.refresh();
    },
  });

  // The question is echoed from what was typed, so it has to be read before the form resets.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (inputRef.current) inputRef.current.defaultValue = inputRef.current.value;
    form.onSubmit(event);
  }

  return (
    <div className="flex flex-col gap-4">
      {shown.length === 0 ? (
        <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
          <p className="text-sm text-muted-foreground">{t("emptyHint")}</p>
          <ul className="flex flex-wrap gap-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion}>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (!inputRef.current) return;
                    inputRef.current.value = suggestion;
                    inputRef.current.focus();
                  }}
                >
                  {suggestion}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          {shown.map((turn) => (
            <Bubble key={turn.id} turn={turn} />
          ))}
        </ol>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="flex flex-col gap-2">
        <label htmlFor="question" className="sr-only">
          {t("askLabel")}
        </label>
        <textarea
          ref={inputRef}
          id="question"
          name="question"
          required
          rows={2}
          maxLength={QUESTION_MAX}
          placeholder={t("placeholder")}
          className="rounded-xl border bg-background px-3 py-2 text-sm"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              formRef.current?.requestSubmit();
            }
          }}
        />
        <FormError namespace="assistant.errors" errorKey={form.errorKey} />
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={form.pending}>
            {form.pending ? t("thinking") : t("send")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("mayBeWrong")}</p>
        </div>
      </form>
    </div>
  );
}
