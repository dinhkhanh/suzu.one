"use client";
// The pipeline board (FR-CRM-13): a column per stage, cards moved by dragging — which is a stage
// change, gates and all; a refusal names what the stage needs. A lost stage asks for its reason on
// the deal's page, so a card dropped there opens it. On a phone, where dragging is no good, each
// card links to its deal and the columns scroll sideways under the thumb.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type CSSProperties, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "cn";
import { moveDealAction } from "../deal-actions";
import { PersonAvatar } from "./person-avatar";

export type BoardCard = { id: string; code: string; title: string; accountName: string; ownerName: string | null; expectedCloseOn: string | null; stale: boolean; value: { totalVnd: number; weightedVnd: number } | null; canMove: boolean };
export type BoardColumn = { id: string; name: string; category: string; count: number; valued: number; totalVnd: number; weightedVnd: number; cards: BoardCard[] };

// The stage's dot: blue while the deal is in motion, green once won, red once lost.
const DOT: Record<string, string> = { open: "bg-primary", won: "bg-success", lost: "bg-destructive" };

export function DealBoard({ columns }: { columns: BoardColumn[] }) {
  const t = useTranslations("crm.deals");
  const tErrors = useTranslations("crm.errors");
  const tGates = useTranslations("crm.enums.gate");
  const format = useFormatter();
  const router = useRouter();
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (value: number) => format.number(value, { style: "currency", currency: "VND", maximumFractionDigits: 0, notation: "compact" });
  const date = (value: string) => format.dateTime(new Date(`${value}T00:00:00`), { day: "numeric", month: "short" });

  const drop = (column: BoardColumn) => {
    const dealId = dragging;
    setDragging(null);
    setOver(null);
    if (!dealId) return;
    if (column.category === "lost") {
      router.push(`/crm/deals/${dealId}?lose=1`);
      return;
    }
    startTransition(async () => {
      const result = await moveDealAction({ dealId, stageId: column.id });
      if (result.ok) {
        setMessage(null);
        router.refresh();
        return;
      }
      const key = (result.error === "failed" ? result.message : result.error) ?? "generic";
      const gates = (result.details as { gates?: string[] } | undefined)?.gates;
      setMessage(gates?.length ? t("gatesNeeded", { gates: gates.map((gate) => (tGates.has(gate as "contacts") ? tGates(gate as "contacts") : gate)).join(", ") }) : tErrors.has(key) ? tErrors(key) : tErrors("generic"));
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <div className="grid min-w-0 grid-flow-col auto-cols-[minmax(240px,1fr)] gap-3 overflow-x-auto pb-2" aria-busy={pending}>
        {columns.map((column) => (
          <section
            key={column.id}
            aria-label={column.name}
            onDragOver={(event) => {
              if (!dragging) return;
              event.preventDefault();
              setOver(column.id);
            }}
            onDragLeave={() => setOver((current) => (current === column.id ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              drop(column);
            }}
            className={cn("flex min-w-0 flex-col gap-2 rounded-[14px] border border-border p-2 transition-colors duration-200", over === column.id ? "bg-accent" : "bg-canvas")}
          >
            <header className="flex flex-col gap-0.5 px-1.5 pt-1">
              <p className="flex items-center gap-2 text-[0.8125rem] font-semibold">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", DOT[column.category] ?? "bg-faint")} />
                <span className="min-w-0 flex-1 truncate">{column.name}</span>
                <span className="font-mono text-xs font-medium text-faint tabular-nums">{column.count}</span>
              </p>
              {column.valued ? (
                <p className="pl-4 font-mono text-[0.6875rem] text-faint tabular-nums">
                  {column.category === "open" ? t("columnWeighted", { total: money(column.totalVnd), weighted: money(column.weightedVnd) }) : money(column.totalVnd)}
                  {column.valued < column.count ? ` · ${t("valuedOf", { valued: column.valued, count: column.count })}` : ""}
                </p>
              ) : null}
            </header>
            <ul className="flex min-h-10 flex-col gap-2">
              {column.cards.map((card, index) => (
                <li
                  key={card.id}
                  draggable={card.canMove}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(card.id);
                  }}
                  onDragEnd={() => setDragging(null)}
                  style={{ "--i": index } as CSSProperties}
                  className={cn("rise flex flex-col gap-1.5 rounded-[10px] border border-border bg-background p-3.5 transition-[opacity,box-shadow] duration-100", card.canMove && "cursor-grab active:cursor-grabbing", dragging === card.id && "opacity-50")}
                >
                  <Link href={`/crm/deals/${card.id}`} className="text-[0.84375rem] leading-snug font-semibold hover:underline">
                    {card.title}
                  </Link>
                  <p className="truncate text-xs text-faint">
                    {card.accountName} · <span className="font-mono">{card.code}</span>
                  </p>
                  <p className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] font-medium tabular-nums">{card.value ? money(card.value.totalVnd) : "—"}</span>
                    {card.expectedCloseOn ? <span className="font-mono text-[0.6875rem] text-faint tabular-nums">{date(card.expectedCloseOn)}</span> : null}
                    {card.stale ? <Badge variant="warning">{t("stale")}</Badge> : null}
                    {card.ownerName ? <PersonAvatar name={card.ownerName} /> : null}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
