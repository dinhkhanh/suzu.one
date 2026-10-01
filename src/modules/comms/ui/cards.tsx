// Server-rendered pieces shared by the home feed and the comms pages. A body or a message is a
// note (Markdown, rendered by RichText), never HTML.
import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/modules/platform/rich-text/ui/rich-text";
import type { AnnouncementCard, KudosCard } from "../service";

export async function AnnouncementList({ cards, empty }: { cards: AnnouncementCard[]; empty: string }) {
  const t = await getTranslations("comms");
  const format = await getFormatter();
  if (cards.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {cards.map((card) => (
        <li key={card.id} className="flex flex-col gap-1 p-3">
          <div className="flex flex-wrap items-center gap-2">
            {card.read ? null : <span aria-label={t("list.unread")} className="size-2 rounded-full bg-primary" />}
            <Link href={`/announcements/${card.id}`} className={`text-sm hover:underline ${card.read ? "" : "font-semibold"}`}>
              {card.title}
            </Link>
            {card.pinned ? <Badge variant="secondary">{t("list.pinned")}</Badge> : null}
            {card.mustAcknowledge ? <Badge variant={card.acknowledged ? "outline" : "destructive"}>{card.acknowledged ? t("list.acknowledged") : t("list.mustAcknowledge")}</Badge> : null}
          </div>
          <p className="text-sm text-muted-foreground">{card.excerpt}</p>
          <p className="text-xs text-muted-foreground">
            {card.authorName} · {format.dateTime(card.publishAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Ho_Chi_Minh" })}
          </p>
        </li>
      ))}
    </ul>
  );
}

export async function KudosList({ cards, empty, action }: { cards: KudosCard[]; empty: string; action?: (card: KudosCard) => ReactNode }) {
  const t = await getTranslations("comms");
  const format = await getFormatter();
  const locale = await getLocale();
  if (cards.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {cards.map((card) => (
        <li key={card.id} className="flex flex-col gap-1 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>{t.rich("kudos.line", { from: card.fromName, to: card.toName, b: (chunks) => <strong className="font-semibold">{chunks}</strong> })}</span>
            <Badge variant="secondary">{(locale === "en" ? card.valueNameEn : card.valueNameVi) ?? card.valueKey}</Badge>
          </div>
          <RichText text={card.message} className="break-words" />
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            {format.dateTime(card.createdAt, { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" })}
            {action?.(card)}
          </p>
        </li>
      ))}
    </ul>
  );
}
