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
import { type DragEvent, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { moveApplicationAction, rejectApplicationAction } from "../actions";
import { REJECTION_REASONS } from "../enums";

export type BoardStage = { id: string; name: string };
export type BoardCard = { id: string; candidateName: string; currentTitle: string | null; stageId: string; days: number; source: string };

export function PipelineBoard({ stages, cards }: { stages: BoardStage[]; cards: BoardCard[] }) {
  const t = useTranslations("recruit");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

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

  const rejectSelected = (reason: string) => run([...selected], (id) => rejectApplicationAction({ applicationId: id, reason, note: null }));

  const onDrop = (event: DragEvent<HTMLDivElement>, stageId: string) => {
    event.preventDefault();
    setOver(null);
    const id = event.dataTransfer.getData("text/plain") || dragging;
    setDragging(null);
    // Dropping a card back where it came from is not a move; the service refuses it, so do not ask.
    if (id && cards.find((card) => card.id === id)?.stageId !== stageId) moveTo(stageId, [id]);
  };

  return (
    <div className="flex flex-col gap-3">
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2 text-sm">
          <span className="font-medium">{t("board.selected", { count: selected.size })}</span>
          <select
            aria-label={t("board.moveTo")}
            defaultValue=""
            disabled={pending}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            onChange={(event) => {
              if (event.target.value) moveTo(event.target.value, [...selected]);
              event.target.value = "";
            }}
          >
            <option value="">{t("board.moveTo")}</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>
                {stage.name}
              </option>
            ))}
          </select>
          <select
            aria-label={t("board.rejectWith")}
            defaultValue=""
            disabled={pending}
            className="h-8 rounded-md border bg-background px-2 text-sm"
            onChange={(event) => {
              if (event.target.value) rejectSelected(event.target.value);
              event.target.value = "";
            }}
          >
            <option value="">{t("board.rejectWith")}</option>
            {REJECTION_REASONS.map((reason) => (
              <option key={reason} value={reason}>
                {t(`rejection.${reason}` as "rejection.other")}
              </option>
            ))}
          </select>
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

      <div className="flex gap-3 overflow-x-auto pb-2">
        {stages.map((stage) => {
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
              className={`flex w-64 shrink-0 flex-col gap-2 rounded-xl border p-2 ${over === stage.id ? "border-primary bg-muted/50" : "bg-muted/20"}`}
            >
              <div className="flex items-center justify-between gap-2 px-1">
                <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{stage.name}</h3>
                <Badge variant="outline" className="text-[10px]">
                  {column.length}
                </Badge>
              </div>

              {column.map((card) => (
                <div
                  key={card.id}
                  draggable={!pending}
                  onDragStart={(event) => {
                    event.dataTransfer.setData("text/plain", card.id);
                    setDragging(card.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  className={`flex flex-col gap-1 rounded-lg border bg-background p-2 ${dragging === card.id ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      aria-label={card.candidateName}
                      checked={selected.has(card.id)}
                      onChange={() => toggle(card.id)}
                      className="mt-1"
                    />
                    <Link href={`/recruit/applications/${card.id}`} className="min-w-0 flex-1 text-sm font-medium hover:underline">
                      {card.candidateName}
                    </Link>
                  </div>
                  {card.currentTitle ? <p className="truncate pl-6 text-xs text-muted-foreground">{card.currentTitle}</p> : null}
                  <p className="pl-6 text-xs text-muted-foreground">
                    {t(`source.${card.source}` as "source.direct")} · {t("board.days", { days: card.days })}
                  </p>
                </div>
              ))}

              {column.length === 0 ? <p className="px-1 py-4 text-center text-xs text-muted-foreground">{t("board.empty")}</p> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
