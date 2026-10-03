"use client";
import { ArrowUpIcon, BookOpenIcon, SparklesIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "cn";
import { askAssistantAction } from "../actions";
import { citationHref } from "../engine/answer";
import { type ChatTurn as Turn, QUESTION_MAX, type ToolOutcome } from "../enums";
import { AnswerMarkdown } from "./answer-markdown";

/** The assistant's mark beside every answer: a spark in a tinted tile. */
function Spark() {
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-[9px] bg-primary/10 text-primary">
      <SparklesIcon className="size-4" />
    </span>
  );
}

/** An answer's row: the spark at the left, the body beside it. */
function AnswerRow({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex min-w-0 items-start gap-3 md:max-w-[90%]">
      <Spark />
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5 text-sm leading-relaxed">{children}</div>
    </li>
  );
}

/**
 * A personal tool's answer (FR-AI-02). The server sent message keys and numbers, never a sentence
 * — see `enums.ts` — so the wording lives in `messages/*.json` like every other string, and what
 * crossed the wire is small enough to read.
 */
function ToolAnswer({ tool }: { tool: ToolOutcome }) {
  const t = useTranslations("assistant.tools");
  const format = useFormatter();
  const locale = useLocale();
  // `Intl` formats the numbers: a payslip figure is integer đồng, days are days.
  const shape = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "number" ? format.number(value, { maximumFractionDigits: 2 }) : value]));

  if (tool.status === "refused")
    return (
      <div className="flex flex-col gap-1 text-muted-foreground">
        <p>{t(`refusals.${tool.reason}`, shape(tool.params))}</p>
        {tool.link ? (
          <Link href={tool.link} className="text-xs font-medium text-link hover:underline">
            {t(`links.${tool.tool}`)}
          </Link>
        ) : null}
      </div>
    );

  const line = (key: string, params: Record<string, string | number>) => t(`${tool.tool}.${key}`, shape(locale === "en" && "nameEn" in params ? { ...params, name: params.nameEn } : params));
  return (
    <>
      <p>{line(tool.key, tool.params)}</p>
      {tool.lines.length > 0 ? (
        <ul className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5 text-[0.8125rem] text-muted-foreground">
          {tool.lines.map((row, index) => (
            <li key={`${row.key}-${index}`}>{line(row.key, row.params)}</li>
          ))}
        </ul>
      ) : null}
      <p className="text-xs text-faint">
        {tool.link ? (
          <Link href={tool.link} className="font-medium text-link hover:underline">
            {t(`links.${tool.tool}`)}
          </Link>
        ) : null}
        <span className={tool.link ? "ml-2" : ""}>{t("fromYourRecord")}</span>
      </p>
    </>
  );
}

/** The passages the assistant quoted, each as a card that opens the page it came from. The link re-checks permission. */
function Sources({ turn }: { turn: Turn }) {
  if (turn.citations.length === 0) return null;
  return (
    <ol className="flex flex-col gap-2">
      {turn.citations.map((citation, index) => (
        <li key={citation.chunkId}>
          <Link href={citationHref(citation)} className="block rounded-[14px] outline-none focus-visible:ring-2 focus-visible:ring-ring/40">
            <Card size="sm" className="press gap-1.5 transition-colors hover:bg-canvas">
              <div className="flex items-center gap-2 px-3 text-xs text-faint">
                <BookOpenIcon aria-hidden className="size-3.5 shrink-0" />
                <span className="font-mono tabular-nums">[{index + 1}]</span>
                <span className="truncate">
                  {citation.spaceName} › {citation.pageTitle}
                </span>
              </div>
              {/* The section the passage was read from, set as a quotation. */}
              {citation.headingPath.includes("›") ? <p className="mx-3 line-clamp-2 border-l-2 border-border pl-2.5 text-[0.8125rem] text-muted-foreground">{citation.headingPath.split("›").slice(1).join(" › ").trim()}</p> : null}
            </Card>
          </Link>
        </li>
      ))}
    </ol>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const t = useTranslations("assistant");
  if (turn.role === "user")
    return <li className="max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-ink px-4 py-3 text-sm leading-relaxed text-ink-foreground md:max-w-[75%]">{turn.body}</li>;
  if (turn.tool)
    return (
      <AnswerRow>
        <ToolAnswer tool={turn.tool} />
      </AnswerRow>
    );
  return (
    <AnswerRow>
      {turn.outcome === "unanswered" ? (
        <div className="text-muted-foreground">
          <p>{t("noAnswer")}</p>
          <p className="mt-1 text-xs">{t("noAnswerLogged")}</p>
        </div>
      ) : (
        <>
          {/* Markdown turned into elements, never into HTML: see `answer-markdown.tsx`. */}
          <AnswerMarkdown body={turn.body} citations={turn.citations} />
          <Sources turn={turn} />
          <p className="text-xs text-faint">{t("mayBeWrong")}</p>
        </>
      )}
    </AnswerRow>
  );
}

export function AssistantChat({ conversationId, turns, suggestions }: { conversationId: string | null; turns: Turn[]; suggestions: string[] }) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const asked = useRef("");
  const [shown, setShown] = useState<Turn[]>(turns);
  const [conversation, setConversation] = useState(conversationId);

  const form = useActionForm(askAssistantAction, {
    extra: { conversationId: conversation, locale },
    onSuccess: (result) => {
      setConversation(result.conversationId);
      setShown((before) => [
        ...before,
        { id: `${result.messageId}-q`, role: "user", body: asked.current, outcome: null, citations: [], tool: null },
        { id: result.messageId, role: "assistant", body: result.body, outcome: result.outcome, citations: result.citations, tool: result.tool },
      ]);
      formRef.current?.reset();
      router.refresh();
    },
  });

  // The question is echoed from what was typed, so it has to be read before the form resets.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    asked.current = inputRef.current?.value.trim() ?? "";
    form.onSubmit(event);
  }

  const suggest = (suggestion: string) => {
    if (!inputRef.current) return;
    inputRef.current.value = suggestion;
    inputRef.current.focus();
  };

  const chips = (
    <ul className="flex flex-wrap gap-2">
      {suggestions.map((suggestion) => (
        <li key={suggestion}>
          <Button type="button" variant="outline" size="sm" onClick={() => suggest(suggestion)}>
            {suggestion}
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <div className="flex min-h-[60vh] min-w-0 flex-col gap-5">
      {/* The padding keeps the thread's last line clear of the composer's fade when scrolled to the end. */}
      <div className="flex min-w-0 flex-1 flex-col gap-5 pb-7">
        {shown.length === 0 ? (
          <div className="flex flex-col gap-4 py-4 md:py-8">
            <Spark />
            <p className="max-w-prose text-sm text-muted-foreground">{t("emptyHint")}</p>
            {chips}
          </div>
        ) : (
          <>
            <ol className="flex flex-col gap-5">
              {shown.map((turn) => (
                <Bubble key={turn.id} turn={turn} />
              ))}
            </ol>
            {form.pending ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Spark />
                <span className="animate-pulse">{t("thinking")}</span>
              </div>
            ) : (
              <div className="pl-10">{chips}</div>
            )}
          </>
        )}
      </div>

      {/* The composer, pinned under the thread: a floating box on a desk, a pill on a phone.
          It sticks to the edge of `<main>`'s content, which that element's bottom padding already
          holds off the screen's edge: on a phone the padding clears the tab bar, and half a rem
          back into it sets the pill beside the quick-add button. */}
      <form ref={formRef} onSubmit={onSubmit} className="sticky -bottom-2 z-10 mr-16 flex flex-col gap-2 md:bottom-4 md:mr-0">
        {/* The ground under the composer: the thread fades out as it reaches the box and is gone below it — down to the tab bar on a phone, to the edge of the page on a desk. */}
        <div aria-hidden className="pointer-events-none absolute -top-12 -right-16 -bottom-6 left-0 -z-10 bg-[linear-gradient(to_top,var(--background)_calc(100%-3rem),transparent)] md:right-0 md:-bottom-16" />
        <label htmlFor="question" className="sr-only">
          {t("askLabel")}
        </label>
        <div className={cn("flex items-end gap-2 border border-border bg-background shadow-[0_8px_24px_oklch(0_0_0/6%)]", "rounded-[24px] px-2 py-1.5 pl-4 md:rounded-[16px] md:p-3 md:pl-4")}>
          <textarea
            ref={inputRef}
            id="question"
            name="question"
            required
            rows={1}
            maxLength={QUESTION_MAX}
            placeholder={t("placeholder")}
            className="max-h-40 min-h-[2.25rem] w-full flex-1 resize-none self-center bg-transparent py-2 text-sm leading-5 outline-none [field-sizing:content] placeholder:text-faint md:min-h-[3rem]"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <Button type="submit" size="icon" disabled={form.pending} aria-label={t("send")} className="rounded-full bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),black_10%)] md:bg-ink md:text-ink-foreground md:hover:bg-[color-mix(in_oklch,var(--ink),var(--background)_14%)] [&_svg]:text-current">
            <ArrowUpIcon />
          </Button>
        </div>
        <FormError namespace="assistant.errors" errorKey={form.errorKey} />
        <p className="hidden px-1 text-xs text-faint md:block">{t("mayBeWrong")}</p>
      </form>
    </div>
  );
}
