"use client";
import { ArrowUpIcon, BookOpenIcon, SparklesIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FormError } from "@/components/forms/field";
import { useActionForm } from "@/components/forms/use-action-form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { List, ListItem } from "@/components/ui/list";
import { cn } from "cn";
import { askAssistantAction } from "../actions";
import { citationHref } from "../engine/answer";
import { type AgentCard, type AgentShown, type ChatTurn as Turn, type PageContext, QUESTION_MAX, type ToolOutcome } from "../enums";
import { AnswerFeedback } from "./answer-feedback";
import { AnswerMarkdown } from "./answer-markdown";
import { ProposalCard } from "./proposal-card";

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

/** The steps the agent took, named (FR-AGT-07): "Đã xem: việc của bạn · sổ tay". */
function Steps({ agent }: { agent: AgentShown }) {
  const t = useTranslations("assistant.agent");
  const names = [...new Set(agent.steps.map((step) => step.tool))].filter((tool) => t.has(`tools.${tool}`));
  if (names.length === 0) return null;
  return <p className="text-xs text-faint">{t("looked", { tools: names.map((tool) => t(`tools.${tool}`)).join(" · ") })}</p>;
}

/** What a tool read, as the asker sees it (FR-AGT-05, 30): each record linked to its own screen. */
function AgentCards({ cards }: { cards: AgentCard[] }) {
  const t = useTranslations("assistant.agent");
  const format = useFormatter();
  // Numbers by `Intl`; a day ("2026-10-08") as the reader writes one.
  const shape = (params: Record<string, string | number>) =>
    Object.fromEntries(Object.entries(params).map(([key, value]) => [key, typeof value === "number" ? format.number(value, { maximumFractionDigits: 2 }) : /^\d{4}-\d{2}-\d{2}$/u.test(value) ? format.dateTime(new Date(`${value}T00:00:00`), { day: "2-digit", month: "2-digit" }) : value]));
  // A card with no rows is shown only when it is the way forward: the step-up link, or a proposal.
  const shown = cards.filter((card) => card.items.length > 0 || card.proposal || (card.tool === "step_up" && card.href));
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-3">
      {shown.map((card, index) =>
        card.proposal ? (
          <ProposalCard key={card.proposal.id} proposal={card.proposal} />
        ) : (
        <section key={`${card.tool}-${index}`} className="flex flex-col gap-1.5">
          <h3 className="text-xs font-medium text-muted-foreground">
            {card.href ? (
              <Link href={card.href} className="hover:underline">
                {t(`cards.${card.tool}`)}
              </Link>
            ) : (
              t(`cards.${card.tool}`)
            )}
          </h3>
          {card.items.length > 0 ? (
            <List>
              {card.items.map((item, row) => (
                <ListItem key={`${item.label}-${row}`} href={item.href ?? undefined} className="flex min-w-0 items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0 truncate">{item.title ? t(`meta.${item.title.key}`, shape(item.title.params)) : item.label}</span>
                  {item.meta ? <span className="shrink-0 text-xs text-muted-foreground">{t(`meta.${item.meta.key}`, shape(item.meta.params))}</span> : null}
                </ListItem>
              ))}
            </List>
          ) : null}
          {card.more > 0 ? <p className="text-xs text-faint">{t("more", { count: card.more })}</p> : null}
        </section>
        ),
      )}
    </div>
  );
}

/** What the assistant said, without the đúng / sai under it. */
function AnswerBody({ turn }: { turn: Turn }) {
  const t = useTranslations("assistant");
  if (turn.tool) return <ToolAnswer tool={turn.tool} />;
  // The agent declined: the app's sentence, never the model's (FR-AGT-03).
  if (turn.outcome === "off_topic")
    return <p className="text-muted-foreground">{turn.agent?.offTopic === "greeting" ? t("agent.greeting") : t("agent.offTopic")}</p>;
  // An answer that read pay is shown once and not kept (D36).
  if (turn.agent?.unstored && !turn.body)
    return (
      <>
        <p className="text-muted-foreground">{t("agent.unstored")}</p>
        <Steps agent={turn.agent} />
      </>
    );
  return (
    <>
      {turn.outcome === "unanswered" || (turn.outcome === "limited" && !turn.body) ? (
        <div className="text-muted-foreground">
          <p>{t("noAnswer")}</p>
          <p className="mt-1 text-xs">{turn.outcome === "limited" ? t("agent.limited") : t("noAnswerLogged")}</p>
        </div>
      ) : (
        <>
          {/* Markdown turned into elements, never into HTML: see `answer-markdown.tsx`. */}
          <AnswerMarkdown body={turn.body} citations={turn.citations} />
          {/* A turn that ended on a proposal has no words of the model's: the app's line introduces the card (R4). */}
          {!turn.body && turn.agent?.cards.some((card) => card.proposal) ? <p>{t("agent.proposal.lead")}</p> : null}
          {turn.agent ? <AgentCards cards={turn.agent.cards} /> : null}
          <Sources turn={turn} />
          {turn.agent ? <Steps agent={turn.agent} /> : null}
          {/* The agent spent its calls or its time: what is shown is the free answer. */}
          {turn.outcome === "limited" ? <p className="text-xs text-muted-foreground">{t("agent.limited")}</p> : null}
          {/* Why this is a quoted passage and not a written answer: a ceiling, the switch, the provider. */}
          {turn.notice && turn.notice !== "no_key" ? <p className="text-xs text-muted-foreground">{t(`notices.${turn.notice}`)}</p> : null}
          {/* A turn that only proposed wrote nothing that could be wrong: its cards say every field. */}
          {turn.body ? <p className="text-xs text-faint">{t("mayBeWrong")}</p> : null}
        </>
      )}
    </>
  );
}

function Bubble({ turn, feedback }: { turn: Turn; feedback: boolean }) {
  if (turn.role === "user")
    return <li className="max-w-[85%] self-end rounded-[16px_16px_4px_16px] bg-ink px-4 py-3 text-sm leading-relaxed text-ink-foreground md:max-w-[75%]">{turn.body}</li>;
  return (
    <AnswerRow>
      <AnswerBody turn={turn} />
      {/* Đúng / sai on every answer that is stored (FR-AGT-51). */}
      {feedback ? <AnswerFeedback messageId={turn.id} given={turn.feedback ?? null} /> : null}
    </AnswerRow>
  );
}

/** How a question reaches the `ai.ask` action: as a server action on `/assistant`, through its own route from the sheet. */
export type AskTransport = (input: unknown) => Promise<Awaited<ReturnType<typeof askAssistantAction>>>;

export function AssistantChat({
  conversationId,
  turns,
  suggestions,
  ask = askAssistantAction,
  page = null,
  variant = "page",
  onConversation,
}: {
  conversationId: string | null;
  turns: Turn[];
  suggestions: string[];
  ask?: AskTransport;
  /** The record on screen, from the sheet (FR-AGT-02). */
  page?: PageContext | null;
  /** "sheet": inside the assistant's sheet over another page — no history beside it to refresh, the composer at the sheet's foot. */
  variant?: "page" | "sheet";
  onConversation?: (conversationId: string) => void;
}) {
  const t = useTranslations("assistant");
  const locale = useLocale();
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const asked = useRef("");
  // The same question, for the screen while it is being answered.
  const [asking, setAsking] = useState("");
  const [shown, setShown] = useState<Turn[]>(turns);
  const [conversation, setConversation] = useState(conversationId);
  const sheet = variant === "sheet";
  const threadRef = useRef<HTMLDivElement>(null);

  const form = useActionForm(ask, {
    extra: { conversationId: conversation, locale, page },
    onSuccess: (result) => {
      setConversation(result.conversationId);
      onConversation?.(result.conversationId);
      setShown((before) => [
        ...before,
        { id: `${result.messageId}-q`, role: "user", body: asked.current, outcome: null, citations: [], tool: null },
        { id: result.messageId, role: "assistant", body: result.body, outcome: result.outcome, citations: result.citations, tool: result.tool, agent: result.agent, notice: result.notice },
      ]);
      formRef.current?.reset();
      // The history beside the thread lists this conversation now. The sheet has none.
      if (variant === "page") router.refresh();
    },
  });

  // In the sheet the thread scrolls on its own: each new turn is brought into view.
  useEffect(() => {
    if (sheet) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [sheet, shown.length, form.pending]);

  // The question is echoed from what was typed, so it has to be read before the form resets.
  function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    asked.current = inputRef.current?.value.trim() ?? "";
    setAsking(asked.current);
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
    <div className={cn("flex min-w-0 flex-col", sheet ? "min-h-0 flex-1 gap-3" : "min-h-[60vh] gap-5")}>
      {/* The padding keeps the thread's last line clear of the composer's fade when scrolled to the end.
          In the sheet the thread scrolls by itself, above a composer that stays at the sheet's foot. */}
      <div ref={threadRef} className={cn("flex min-w-0 flex-1 flex-col gap-5", sheet ? "min-h-0 overflow-y-auto overscroll-contain pb-2" : "pb-7")}>
        {shown.length === 0 && !form.pending ? (
          <div className={cn("flex flex-col gap-4", sheet ? "py-2" : "py-4 md:py-8")}>
            <Spark />
            <p className="max-w-prose text-sm text-muted-foreground">{t("emptyHint")}</p>
            {chips}
          </div>
        ) : (
          <>
            <ol className="flex flex-col gap-5">
              {shown.map((turn) => (
                <Bubble key={turn.id} turn={turn} feedback={turn.role === "assistant"} />
              ))}
              {/* The question is on screen the moment it is sent, before any answer (NFR-AGT-01). */}
              {form.pending && asking ? <Bubble turn={{ id: "pending", role: "user", body: asking, outcome: null, citations: [], tool: null }} feedback={false} /> : null}
            </ol>
            {/* The suggestions open an empty conversation only: once a question is asked they are gone. */}
            {form.pending ? (
              <div className="flex items-center gap-3 text-sm text-muted-foreground" role="status">
                <Spark />
                <span className="animate-pulse">{t("thinking")}</span>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* The composer, pinned under the thread: a floating box on a desk, a pill on a phone.
          It sticks to the edge of `<main>`'s content, which that element's bottom padding already
          holds off the screen's edge: on a phone the padding clears the tab bar, and half a rem
          back into it sets the pill beside the quick-add button. */}
      <form ref={formRef} onSubmit={onSubmit} className={cn("z-10 flex flex-col gap-2", sheet ? "shrink-0" : "sticky -bottom-2 mr-16 md:bottom-4 md:mr-0")}>
        {/* The ground under the composer: the thread fades out as it reaches the box and is gone below it — down to the tab bar on a phone, to the edge of the page on a desk. */}
        {sheet ? null : <div aria-hidden className="pointer-events-none absolute -top-12 -right-16 -bottom-6 left-0 -z-10 bg-[linear-gradient(to_top,var(--background)_calc(100%-3rem),transparent)] md:right-0 md:-bottom-16" />}
        <label htmlFor={sheet ? "sheet-question" : "question"} className="sr-only">
          {t("askLabel")}
        </label>
        <div className={cn("flex items-end gap-2 border border-border bg-background", sheet ? "rounded-[16px] px-2 py-1.5 pl-3" : "rounded-[24px] px-2 py-1.5 pl-4 shadow-[0_8px_24px_oklch(0_0_0/6%)] md:rounded-[16px] md:p-3 md:pl-4")}>
          <textarea
            ref={inputRef}
            id={sheet ? "sheet-question" : "question"}
            name="question"
            required
            rows={1}
            maxLength={QUESTION_MAX}
            placeholder={t("placeholder")}
            className={cn("max-h-40 min-h-[2.25rem] w-full flex-1 resize-none self-center bg-transparent py-2 text-sm leading-5 outline-none [field-sizing:content] placeholder:text-faint", !sheet && "md:min-h-[3rem]")}
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
        {sheet ? null : <p className="hidden px-1 text-xs text-faint md:block">{t("mayBeWrong")}</p>}
      </form>
    </div>
  );
}
