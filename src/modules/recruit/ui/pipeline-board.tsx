"use client";
// The kanban pipeline (FR-REC-05): one column per stage of the opening's own pipeline, one card
// per person walking it.
//
// Cards are **dragged**, and they are also **selected and moved with a button**, because a board
// that can only be dragged cannot be used with a keyboard, on a phone, or by anybody who has ever
// dropped a card in the wrong column. Both paths call the same server action the application page
// calls, so the rules are checked once and in one place — the board is a view, not an authority.
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, type DragEvent, useState, useTransition } from "react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { cn } from "cn";
import { moveApplicationAction, rejectApplicationAction } from "../actions";
import { REJECTION_REASONS } from "../enums";

export type BoardStage = { id: string; name: string };
/** What a card says beside the name, when there is something to say. */
export type BoardFlag = "new" | "referral" | "scheduled" | "today" | "awaiting";
export type BoardCard = { id: string; candidateName: string; currentTitle: string | null; stageId: string; days: number; source: string; flag?: BoardFlag | null };

const FLAG_TONE: Record<BoardFlag, BadgeVariant> = { new: "info", referral: "violet", scheduled: "info", today: "warning", awaiting: "warning" };
/** The dot in a column's header: one hue per position in the pipeline, so the stages read left to right. */
const STAGE_DOTS = ["bg-tone-indigo", "bg-tone-teal", "bg-primary", "bg-tone-violet", "bg-tone-orange", "bg-success", "bg-tone-pink"];

export function PipelineBoard({ stages, cards, className }: { stages: BoardStage[]; cards: BoardCard[]; className?: string }) {
  const t = useTranslations("recruit");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // Whether a bulk rejection also sends each candidate the rejection letter, as the single form does.
  const [tell, setTell] = useState(true);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  /** One action per card, in order. A refusal stops nothing else: the others are independent. */
  const run = (ids: string[], call: (id: string) => Promise<{ ok: boolean; error?: string; message?: string }>) =>
    startTransition(async () => {
      setErrorKey(null);
      let failure: string | null = null;
      for (const id of ids) {
        const result = await call(id);
        if (!result.ok) failure ??= (result.error === "failed" ? result.message : result.error) ?? "generic";
      }
      setErrorKey(failure);
      setSelected(new Set());
      router.refresh();
    });

  const moveTo = (stageId: string, ids: string[]) => run(ids, (id) => moveApplicationAction({ applicationId: id, stageId, note: null }));

  const rejectSelected = (reason: string) => run([...selected], (id) => rejectApplicationAction({ applicationId: id, reason, note: null, tellCandidate: tell }));

  const onDrop = (event: DragEvent<HTMLDivElement>, stageId: string) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    // Dropping a card back where it came from is not a move; the service refuses it, so do not ask.
    if (id && cards.find((card) => card.id === id)?.stageId !== stageId) moveTo(stageId, [id]);
  };

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)}>
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[0.625rem] bg-muted px-3 py-2 text-sm">
          <span className="font-medium">{t("board.selected", { count: selected.size })}</span>
          <Select
            aria-label={t("board.moveTo")}
            value=""
            disabled={pending}
            className="w-auto"
            onChange={(event) => {
              if (event.target.value) moveTo(event.target.value, [...selected]);
            }}
          >
            <option value="">{t("board.moveTo")}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </Select>
          <Select
            aria-label={t("board.rejectWith")}
            value=""
            disabled={pending}
            className="w-auto"
            onChange={(event) => {
              if (event.target.value) rejectSelected(event.target.value);
            }}
          >
            <option value="">{t("board.rejectWith")}</option>
            {REJECTION_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`rejection.${reason}` as "rejection.other")}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={tell} onCheckedChange={(checked) => setTell(checked === true)} disabled={pending} />
            {t("board.tellCandidates")}
          </label>
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setSelected(new Set())}>
            {t("board.clear")}
          </Button>
        </div>
      ) : null}

      {errorKey ? (
        <p role="alert" className="text-sm text-destructive">
          {t.has(`errors.${errorKey}`) ? t(`errors.${errorKey}` as "errors.generic") : t("errors.generic")}
        </p>
      ) : null}

      {/* The columns scroll sideways inside their own frame; the page never grows wider than the screen. */}
      <div className="-mx-4 min-w-0 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        <div className="grid grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3">
          {stages.map((stage, index) => {
            const column = cards.filter((card) => card.stageId === stage.id);
            return (
              <div
                key={stage.id}
                onDragOver={(event) => {
                  event.preventDefault();
                  setOver(stage.id);
                }}
                onDragLeave={() => setOver((current) => (current === stage.id ? null : current))}
                onDrop={(event) => onDrop(event, stage.id)}
                className={cn("flex min-w-0 flex-col gap-2 rounded-[14px] border p-2 transition-colors duration-200", over === stage.id ? "border-primary bg-primary/5" : "border-border bg-canvas")}
              >
                <div className="flex h-7 items-center gap-2 px-1.5">
                  <span aria-hidden className={cn("size-2 shrink-0 rounded-full", STAGE_DOTS[index % STAGE_DOTS.length])} />
                  <h3 className="min-w-0 flex-1 truncate text-[0.8125rem] font-semibold">{stage.name}</h3>
                  <span className="font-mono text-xs text-faint tabular-nums">{column.length}</span>
                </div>

                {column.map((card, cardIndex) => (
                  <div
                    key={card.id}
                    draggable={!pending}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", card.id);
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    style={{ "--i": cardIndex } as CSSProperties}
                    className={cn(
                      "rise flex flex-col gap-1.5 rounded-[0.625rem] border border-border bg-background p-3 shadow-[0_1px_2px_oklch(0_0_0/4%)] transition-[opacity,box-shadow] duration-100",
                      dragging === card.id && "opacity-50",
                      selected.has(card.id) && "border-primary/40 bg-primary/5",
                    )}
                  >
                    <div className="flex items-start gap-2.5">
                      <Checkbox aria-label={card.candidateName} checked={selected.has(card.id)} onCheckedChange={() => toggle(card.id)} className="mt-0.5" />
                      <Link href={`/recruit/applications/${card.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold tracking-[-0.01em] hover:underline">
                        {card.candidateName}
                      </Link>
                    </div>
                    {card.currentTitle ? <p className="truncate pl-7 text-xs text-faint">{card.currentTitle}</p> : null}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pl-7">
                      <span className="text-xs text-faint">
                        {t(`source.${card.source}` as "source.direct")} · {t("board.days", { days: card.days })}
                      </span>
                      {card.flag ? (
                        <Badge variant={FLAG_TONE[card.flag]} className="h-5">
                          {t(`board.flags.${card.flag}`)}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                ))}

                {column.length === 0 ? <p className="rounded-[0.625rem] border border-dashed border-border px-2 py-5 text-center text-xs text-faint">{t("board.empty")}</p> : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
