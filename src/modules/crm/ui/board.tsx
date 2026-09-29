"use client";
// The pipeline board (FR-CRM-13): a column per stage, cards moved by dragging — which is a stage
// change, gates and all; a refusal names what the stage needs. A lost stage asks for its reason on
// the deal's page, so a card dropped there opens it. On a phone, where dragging is no good, each
// card links to its deal.
import { useFormatter, useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { moveDealAction } from "../deal-actions";

export type BoardCard = { id: string; code: string; title: string; accountName: string; ownerName: string | null; expectedCloseOn: string | null; stale: boolean; value: { totalVnd: number; weightedVnd: number } | null; canMove: boolean };
export type BoardColumn = { id: string; name: string; category: string; count: number; valued: number; totalVnd: number; weightedVnd: number; cards: BoardCard[] };

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
    <div className="flex flex-col gap-2">
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <div className="-mx-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
        <div className="flex w-max gap-3" aria-busy={pending}>
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
              className={`flex w-64 flex-col gap-2 rounded-xl border p-2 ${over === column.id ? "bg-muted" : "bg-muted/30"}`}
            >
              <header className="px-1">
                <p className="flex items-center justify-between text-sm font-medium">
                  <span>{column.name}</span>
                  <span className="text-xs text-muted-foreground">{column.count}</span>
                </p>
                {column.valued ? (
                  <p className="text-xs text-muted-foreground">
                    {column.category === "open" ? t("columnWeighted", { total: money(column.totalVnd), weighted: money(column.weightedVnd) }) : money(column.totalVnd)}
                    {column.valued < column.count ? ` · ${t("valuedOf", { valued: column.valued, count: column.count })}` : ""}
                  </p>
                ) : null}
              </header>
              <ul className="flex flex-col gap-2">
                {column.cards.map((card) => (
                  <li
                    key={card.id}
                    draggable={card.canMove}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragging(card.id);
                    }}
                    onDragEnd={() => setDragging(null)}
                    className={`rounded-lg border bg-background p-2 text-sm shadow-xs ${card.canMove ? "cursor-grab" : ""} ${dragging === card.id ? "opacity-50" : ""}`}
                  >
                    <Link href={`/crm/deals/${card.id}`} className="font-medium hover:underline">
                      {card.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {card.accountName} · <span className="font-mono">{card.code}</span>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {card.value ? <span className="tabular-nums">{money(card.value.totalVnd)}</span> : null}
                      {card.expectedCloseOn ? <Badge variant="outline">{date(card.expectedCloseOn)}</Badge> : null}
                      {card.stale ? <Badge variant="warning">{t("stale")}</Badge> : null}
                      {card.ownerName ? <span className="text-muted-foreground">{card.ownerName}</span> : null}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
